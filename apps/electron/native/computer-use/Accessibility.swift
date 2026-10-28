import Foundation
import AppKit
import ApplicationServices
import CryptoKit

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ outIdentifier: UnsafeMutablePointer<CGWindowID>) -> AXError

struct AXTree {
    let text: String, digest: String, root: AXUIElement
    let refs: [String: AXUIElement]
}
struct AXScrollBinding {
    let element: AXUIElement
    let current: Double, minimum: Double, maximum: Double, destination: Double
    let viewport: Double, content: Double
    func matches(_ other: AXScrollBinding) -> Bool {
        CFEqual(element, other.element) && current == other.current && minimum == other.minimum && maximum == other.maximum
            && destination == other.destination && viewport == other.viewport && content == other.content
    }
}
/// 与AX句柄无关的有界序列化器，离线测试可验证refs不会污染布局摘要。
struct AXObservationBuffer {
    private var lines: [String] = [], canonical: [String] = []
    private(set) var bytes = 0
    var count: Int { lines.count }
    var text: String { lines.joined(separator: "\n") }
    var digest: String { SHA256.hash(data: Data(canonical.joined(separator: "\n").utf8)).map { String(format: "%02x", $0) }.joined() }
    mutating func append(entry: String, content: String = "", ref: String? = nil) -> Bool {
        let line = ref.map { "ref=\($0) \(entry)" } ?? entry
        guard count < 256, bytes + line.utf8.count + 1 <= 32_700 else { return false }
        lines.append(line); bytes += line.utf8.count + 1
        canonical.append(entry + " content=" + SHA256.hash(data: Data(content.utf8)).map { String(format: "%02x", $0) }.joined())
        return true
    }
}

final class AccessibilityWorker {
    // 仅从串行worker调用；每次访问都有单元素超时、总节点/深度/时间预算。
    private var ends: TimeInterval = 0
    private func budget() throws {
        guard ProcessInfo.processInfo.systemUptime < ends else { throw NativeFailure("ax-timeout", "AX读取超过预算") }
    }
    private func value(_ element: AXUIElement, _ name: String) throws -> CFTypeRef? {
        try budget(); AXUIElementSetMessagingTimeout(element, 0.08)
        var result: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, name as CFString, &result)
        if error == .cannotComplete { throw NativeFailure("ax-timeout", "AX目标无响应") }
        if error == .apiDisabled { throw NativeFailure("permission-required", "辅助功能权限未就绪或已被撤回", permission: "accessibility") }
        if error == .success { return result }
        return nil
    }
    private func string(_ element: AXUIElement, _ name: String) throws -> String? {
        guard let raw = try value(element, name) else { return nil }
        if let str = raw as? String { return str }
        if CFGetTypeID(raw) == CFAttributedStringGetTypeID() {
            let attr = unsafeBitCast(raw, to: CFAttributedString.self)
            return (CFAttributedStringGetString(attr) as String)
        }
        return nil
    }
    private func rect(_ element: AXUIElement) throws -> CGRect? {
        guard let rawPosition = try value(element, kAXPositionAttribute), let rawSize = try value(element, kAXSizeAttribute),
              CFGetTypeID(rawPosition) == AXValueGetTypeID(), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(unsafeBitCast(rawPosition, to: AXValue.self), .cgPoint, &point),
              AXValueGetValue(unsafeBitCast(rawSize, to: AXValue.self), .cgSize, &size) else { return nil }
        return CGRect(origin: point, size: size)
    }
    func matchedWindow(_ target: Target) throws -> AXUIElement {
        ends = ProcessInfo.processInfo.systemUptime + 1.0
        let app = AXUIElementCreateApplication(target.pid)
        AXUIElementSetMessagingTimeout(app, 0.08)
        var raw: CFArray?
        var matches: [AXUIElement] = []
        if AXUIElementCopyAttributeValues(app, kAXWindowsAttribute as CFString, 0, 129, &raw) == .success, let windows = raw as? [AXUIElement], windows.count <= 128 {
            for window in windows {
                var pid: pid_t = 0
                guard AXUIElementGetPid(window, &pid) == .success, pid == target.pid else { continue }
                var wid: CGWindowID = 0
                if _AXUIElementGetWindow(window, &wid) == .success, wid != 0, wid == target.windowId {
                    return window
                }
                if let frame = try? rect(window), frame == target.bounds.cg {
                    matches.append(window)
                }
            }
        }
        if matches.count == 1 { return matches[0] }
        if let focusedRaw = try? value(app, kAXFocusedWindowAttribute), CFGetTypeID(focusedRaw) == AXUIElementGetTypeID() {
            let focusedWin = unsafeBitCast(focusedRaw, to: AXUIElement.self)
            var pid: pid_t = 0
            if AXUIElementGetPid(focusedWin, &pid) == .success, pid == target.pid {
                var wid: CGWindowID = 0
                if _AXUIElementGetWindow(focusedWin, &wid) == .success, wid != 0, wid == target.windowId {
                    return focusedWin
                }
                if let frame = try? rect(focusedWin), frame == target.bounds.cg {
                    return focusedWin
                }
                if matches.isEmpty, let frame = try? rect(focusedWin), frame.width > 1, frame.height > 1 {
                    return focusedWin
                }
            }
        }
        guard matches.count == 1 else { throw NativeFailure("ambiguous-window", "AX窗口与目标窗口不是唯一PID、几何匹配") }
        return matches[0]
    }
    private func actionNames(_ element: AXUIElement) throws -> [String] {
        try budget(); AXUIElementSetMessagingTimeout(element, 0.08)
        var raw: CFArray?
        let result = AXUIElementCopyActionNames(element, &raw)
        if result == .cannotComplete { throw NativeFailure("ax-timeout", "AX动作枚举超时，不重试") }
        if result == .apiDisabled { throw NativeFailure("permission-required", "辅助功能权限未就绪或已被撤回", permission: "accessibility") }
        if result == .success, let names = raw as? [String], names.count <= 64,
           names.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 256 }) {
            return names.sorted()
        }
        return []
    }
    func read(_ target: Target, allowSurfaces: Bool = false) throws -> AXTree {
        let root = try matchedWindow(target)
        ends = ProcessInfo.processInfo.systemUptime + 2.0
        var output = AXObservationBuffer(), refs: [String: AXUIElement] = [:]
        var seen: [AXUIElement] = []
        func field(_ text: String, limit: Int = 256) -> String { String(reflecting: String(text.prefix(limit))) }
        func visit(_ element: AXUIElement, depth: Int) throws {
            try budget()
            guard depth <= 12, seen.count < 256, output.bytes < 32_700, !seen.contains(where: { CFEqual($0, element) }) else { return }
            seen.append(element)
            let role = try string(element, kAXRoleAttribute) ?? "unknown"
            let subrole = try string(element, kAXSubroleAttribute) ?? ""
            guard allowSurfaces || !isUnscopedAXSurface(role: role, subrole: subrole, depth: depth) else { throw NativeFailure("unscoped-surface", "附属窗口、sheet、菜单或弹出面板不继承所选窗口授权") }
            let secure = isHiddenAXControl(role: role, subrole: subrole)
            // 安全/未知控件不读标题、描述、AXValue、动作、几何及子树，也不提供引用。
            if secure {
                let entry = "\(depth) [安全或未知控件：已隐藏]"
                _ = output.append(entry: entry)
                return
            }
            let frame = try rect(element)
            let title = try string(element, kAXTitleAttribute) ?? ""
            let description = try string(element, kAXDescriptionAttribute) ?? ""
            guard title.utf16.count <= 1_048_576, description.utf16.count <= 1_048_576 else { throw NativeFailure("ax-budget", "AX元数据超过读取预算") }
            let names = try actionNames(element)
            var text = ""
            if [kAXTextFieldRole, kAXTextAreaRole, kAXStaticTextRole, kAXComboBoxRole].contains(role) {
                text = try string(element, kAXValueAttribute) ?? ""
                guard text.utf16.count <= 1_048_576 else { throw NativeFailure("ax-budget", "AX文本值超过读取预算") }
            } else if role == kAXScrollBarRole, let position = try value(element, kAXValueAttribute) as? NSNumber, position.doubleValue.isFinite {
                // 位置随最新观察返回，使模型能独立核对滚动结果。
                text = position.stringValue
            }
            let geometry = frame.map { "\($0.origin.x),\($0.origin.y),\($0.width),\($0.height)" } ?? "unknown"
            let entry = "\(depth) role=\(field(role)) subrole=\(field(subrole)) frame=\(geometry) title=\(field(title)) description=\(field(description, limit: 384)) value=\(field(text, limit: 768)) actions=\(field(names.joined(separator: ","), limit: 2048))"
            let ref = UUID().uuidString
            // 摘要不含随机ref，完整文本/动作的哈希也参与核验，避免截断文本变化被忽略。
            let content = String(decoding: try JSONEncoder().encode([title, description, text] + names), as: UTF8.self)
            guard output.append(entry: entry, content: content, ref: ref) else { return }
            refs[ref] = element
            guard depth < 12, seen.count < 256 else { return }
            var children: CFArray?
            let result = AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, 256 - seen.count, &children)
            if result == .cannotComplete { throw NativeFailure("ax-timeout", "AX子树读取超时，不重试") }
            if result == .success, let items = children as? [AXUIElement] {
                for child in items { try visit(child, depth: depth + 1) }
            }
        }
        try visit(root, depth: 0)
        return AXTree(text: output.text, digest: output.digest, root: root, refs: refs)
    }
    func validateElement(_ element: AXUIElement, target: Target, root: AXUIElement) throws {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        var node = element
        for _ in 0..<16 {
            var pid: pid_t = 0
            guard AXUIElementGetPid(node, &pid) == .success, pid == target.pid,
                  let role = try string(node, kAXRoleAttribute) else { throw NativeFailure("unsafe-element", "AX元素身份不明") }
            let subrole = try string(node, kAXSubroleAttribute) ?? ""
            guard !isHiddenAXControl(role: role, subrole: subrole) else { throw NativeFailure("secure-field", "拒绝安全或未知字段及其子元素") }
            if CFEqual(node, root) { return }
            guard let parent = try value(node, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
            node = unsafeBitCast(parent, to: AXUIElement.self)
        }
        throw NativeFailure("unsafe-element", "元素无法有界关联到当前窗口")
    }
    /// 仅沿当前焦点的祖先选择滚动区，不在整页中猜测某个滚动容器。
    func prepareScroll(_ focused: AXUIElement, target: Target, root: AXUIElement, delta: Double) throws -> AXScrollBinding? {
        try validateElement(focused, target: target, root: root)
        func unavailable(_ reason: String) -> AXScrollBinding? {
            writeNativeComputerUseLog(location: "Accessibility.swift:prepareScroll:unavailable", action: "scroll",
                rawError: "AX滚动能力不足，尚未投递", errorCode: "unsupported-action",
                targetApp: ["pid": target.pid, "bundleId": target.bundleId, "capability": reason])
            return nil
        }
        var node = focused
        for _ in 0..<16 {
            if try string(node, kAXRoleAttribute) == kAXScrollAreaRole {
                // WebKit有时不暴露AXContents/AXVerticalScrollBar；只接受该滚动区
                // 真实直属子节点中唯一的垂直滚动条和WebArea，不搜索其他容器。
                var rawChildren: CFArray?
                try budget()
                let childrenResult = AXUIElementCopyAttributeValues(node, kAXChildrenAttribute as CFString, 0, 65, &rawChildren)
                if childrenResult == .cannotComplete { throw NativeFailure("ax-timeout", "AX滚动子节点读取超时") }
                if childrenResult == .apiDisabled { throw NativeFailure("permission-required", "辅助功能权限已撤回", permission: "accessibility") }
                guard childrenResult == .success, let children = rawChildren as? [AXUIElement], children.count <= 64 else { return unavailable("children-unavailable") }
                let bar: AXUIElement
                if let rawBar = try value(node, kAXVerticalScrollBarAttribute), CFGetTypeID(rawBar) == AXUIElementGetTypeID() {
                    bar = unsafeBitCast(rawBar, to: AXUIElement.self)
                } else {
                    var bars: [AXUIElement] = []
                    for child in children where try string(child, kAXRoleAttribute) == kAXScrollBarRole {
                        if try string(child, kAXOrientationAttribute) == kAXVerticalOrientationValue { bars.append(child) }
                    }
                    guard bars.count == 1 else { return unavailable("vertical-scrollbar-not-unique") }
                    bar = bars[0]
                }
                try validateElement(bar, target: target, root: node)
                guard try string(bar, kAXRoleAttribute) == kAXScrollBarRole else { return unavailable("scrollbar-role") }
                guard try string(bar, kAXOrientationAttribute) == kAXVerticalOrientationValue else { return unavailable("scrollbar-orientation") }
                guard try attributeSettable(bar, kAXValueAttribute) else { return unavailable("scrollbar-read-only") }
                guard let current = try value(bar, kAXValueAttribute) as? NSNumber else { return unavailable("scrollbar-value") }
                guard let minimum = try value(bar, kAXMinValueAttribute) as? NSNumber else { return unavailable("scrollbar-minimum") }
                guard let maximum = try value(bar, kAXMaxValueAttribute) as? NSNumber else { return unavailable("scrollbar-maximum") }
                var contents = try value(node, kAXContentsAttribute) as? [AXUIElement] ?? []
                if contents.isEmpty {
                    for child in children where try string(child, kAXRoleAttribute) == "AXWebArea" { contents.append(child) }
                }
                guard contents.count == 1 else { return unavailable("contents-not-unique") }
                try validateElement(contents[0], target: target, root: node)
                guard let viewport = try rect(node), let content = try rect(contents[0]) else { return unavailable("scroll-geometry") }
                // https://github.com/WebKit/WebKit/blob/main/Source/WebCore/accessibility/AccessibilityScrollbar.cpp
                // 兼容只针对Safari原生滚动区的直属WebArea和滚动条，且AXValue必须与几何偏移一致。
                let contentRole = try string(contents[0], kAXRoleAttribute)
                let webKitScrollArea = target.bundleId == "com.apple.Safari"
                    && children.contains(where: { CFEqual($0, bar) })
                    && children.contains(where: { CFEqual($0, contents[0]) })
                    && contentRole == "AXWebArea"
                guard let range = validatedAXScrollRange(current: current.doubleValue, minimum: minimum.doubleValue, maximum: maximum.doubleValue,
                    webKitScrollArea: webKitScrollArea, offset: viewport.minY - content.minY, extent: content.height - viewport.height) else { return unavailable("scroll-range") }
                guard let destination = axScrollDestination(current: current.doubleValue, minimum: range.lowerBound, maximum: range.upperBound,
                          delta: delta, viewport: viewport.height, content: content.height) else {
                    writeNativeComputerUseLog(location: "Accessibility.swift:prepareScroll:metrics", action: "scroll",
                        rawError: "AX滚动参数未通过校验，尚未投递", errorCode: "unsupported-action",
                        targetApp: ["pid": target.pid, "bundleId": target.bundleId, "current": current.doubleValue,
                            "minimum": minimum.doubleValue, "maximum": maximum.doubleValue, "delta": delta,
                            "viewportHeight": viewport.height, "contentHeight": content.height])
                    return unavailable("scroll-metrics")
                }
                return AXScrollBinding(element: bar, current: current.doubleValue, minimum: range.lowerBound, maximum: range.upperBound,
                    destination: destination, viewport: viewport.height, content: content.height)
            }
            if CFEqual(node, root) { return unavailable("no-scroll-area-ancestor") }
            guard let parent = try value(node, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return unavailable("no-scroll-area-ancestor") }
            node = unsafeBitCast(parent, to: AXUIElement.self)
        }
        return unavailable("scroll-area-depth")
    }
    func performScroll(_ binding: AXScrollBinding, target: Target, root: AXUIElement, beforeDispatch: () throws -> Void) throws -> AXError {
        try validateElement(binding.element, target: target, root: root)
        try requireSettable(binding.element, kAXValueAttribute)
        guard let current = try value(binding.element, kAXValueAttribute) as? NSNumber, current.doubleValue == binding.current else {
            throw NativeFailure("target-changed", "滚动位置已改变，未投递动作")
        }
        try beforeDispatch()
        return AXUIElementSetAttributeValue(binding.element, kAXValueAttribute as CFString, NSNumber(value: binding.destination))
    }
    func focusedText(_ target: Target, root: AXUIElement) throws {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        let app = AXUIElementCreateApplication(target.pid)
        guard let raw = try value(app, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else {
            writeNativeComputerUseLog(location: "Accessibility.swift:focusedText:raw_not_ax_element", rawError: "无法确认输入焦点", errorCode: "unsafe-focus", targetApp: ["pid": target.pid, "bundleId": target.bundleId])
            throw NativeFailure("unsafe-focus", "无法确认输入焦点")
        }
        let element = unsafeBitCast(raw, to: AXUIElement.self)
        try validateElement(element, target: target, root: root)
        let role = try string(element, kAXRoleAttribute)
        guard role == kAXTextFieldRole || role == kAXTextAreaRole else {
            writeNativeComputerUseLog(location: "Accessibility.swift:focusedText:not_text_field", rawError: "仅允许明确的非安全文本控件输入", errorCode: "unsafe-focus", targetApp: ["pid": target.pid, "bundleId": target.bundleId], focusedElement: describeAXElementInfo(element))
            throw NativeFailure("unsafe-focus", "仅允许明确的非安全文本控件输入")
        }
    }
    func focusedElement() throws -> AXUIElement {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        let system = AXUIElementCreateSystemWide()
        if let raw = try? value(system, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() {
            return unsafeBitCast(raw, to: AXUIElement.self)
        }
        if let front = NSWorkspace.shared.frontmostApplication {
            let app = AXUIElementCreateApplication(front.processIdentifier)
            if let raw = try? value(app, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() {
                return unsafeBitCast(raw, to: AXUIElement.self)
            }
            if let raw = try? value(app, kAXFocusedWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() {
                return unsafeBitCast(raw, to: AXUIElement.self)
            }
            return app
        }
        writeNativeComputerUseLog(location: "Accessibility.swift:focusedElement:no_focused_element", rawError: "无法识别实际焦点控件", errorCode: "unsafe-focus")
        throw NativeFailure("unsafe-focus", "无法识别实际焦点控件")
    }
    func hitElement(_ point: CGPoint) throws -> AXUIElement {
        let system = AXUIElementCreateSystemWide(); AXUIElementSetMessagingTimeout(system, 0.08)
        var element: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &element) == .success, let element else { throw NativeFailure("unknown-target", "无法识别落点控件") }
        return element
    }
    func elementPID(_ element: AXUIElement) throws -> pid_t {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success, pid > 0 else { throw NativeFailure("unknown-target", "控件进程身份无效") }; return pid
    }
    func context(_ element: AXUIElement) throws -> (ElementContext, Rect?) {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        let role = try string(element, kAXRoleAttribute)
        let subrole = try string(element, kAXSubroleAttribute)
        let secure = isHiddenAXControl(role: role, subrole: subrole)
        // 绝不读取AXValue，安全控件不读取标题/描述。
        let title = secure ? nil : try string(element, kAXTitleAttribute).map { String($0.prefix(256)) }
        let description = secure ? nil : try string(element, kAXDescriptionAttribute).map { String($0.prefix(512)) }
        let isTrustedSearch = try !secure && (role == kAXTextFieldRole || subrole == "AXSearchField") && !hasWebAreaAncestor(element)
        return (ElementContext(role: role, subrole: subrole, title: title, description: description, isSecure: secure, isTrustedSearch: isTrustedSearch), try rect(element).map(Rect.init))
    }
    /** 网页内容位于AXWebArea内；地址栏/浏览器chrome不在该子树中。 */
    private func hasWebAreaAncestor(_ element: AXUIElement) throws -> Bool {
        var node = element
        for _ in 0..<16 {
            if (try string(node, kAXRoleAttribute)) == "AXWebArea" { return true }
            guard let parent = try value(node, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            node = unsafeBitCast(parent, to: AXUIElement.self)
        }
        return false
    }
    func windowForFocused(_ pid: pid_t, windows: [Target]) throws -> Target {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        let app = AXUIElementCreateApplication(pid)
        guard let raw = try value(app, kAXFocusedWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else {
            writeNativeComputerUseLog(location: "Accessibility.swift:windowForFocused:no_focused_window", rawError: "无法识别实际焦点窗口", errorCode: "unsafe-focus", targetApp: ["pid": pid])
            throw NativeFailure("unsafe-focus", "无法识别实际焦点窗口")
        }
        let root = unsafeBitCast(raw, to: AXUIElement.self)
        guard let frame = try rect(root) else {
            writeNativeComputerUseLog(location: "Accessibility.swift:windowForFocused:no_window_frame", rawError: "无法读取焦点窗口几何", errorCode: "unsafe-focus", targetApp: ["pid": pid], focusedElement: describeAXElementInfo(root))
            throw NativeFailure("unsafe-focus", "无法读取焦点窗口几何")
        }
        let matches = windows.filter { $0.pid == pid && $0.bounds.cg == frame }
        if matches.count == 1 { return matches[0] }
        guard let runningApp = NSRunningApplication(processIdentifier: pid),
              let bundle = runningApp.bundleIdentifier,
              let ident = try? processIdentity(pid) else {
            throw NativeFailure("ambiguous-window", "焦点窗口所属应用无效")
        }
        var wid: CGWindowID = 0
        _ = _AXUIElementGetWindow(root, &wid)
        if wid == 0 { wid = UInt32(bitPattern: pid) }
        let title = (try? string(root, kAXTitleAttribute)) ?? ""
        return Target(windowId: wid, pid: pid, processIdentity: ident, bundleId: bundle, title: title, bounds: Rect(frame))
    }
    private func attributeSettable(_ element: AXUIElement, _ attribute: String) throws -> Bool {
        try budget()
        var settable = DarwinBoolean(false)
        let result = AXUIElementIsAttributeSettable(element, attribute as CFString, &settable)
        if result == .cannotComplete { throw NativeFailure("ax-timeout", "AX可写检查超时，不重试") }
        if result == .apiDisabled { throw NativeFailure("permission-required", "辅助功能权限未就绪或已被撤回", permission: "accessibility") }
        if result == .success { return settable.boolValue }
        return false
    }
    private func requireSettable(_ element: AXUIElement, _ attribute: String) throws {
        guard try attributeSettable(element, attribute) else { throw NativeFailure("unsupported-action", "控件不支持设置所需AX属性") }
    }
    func editableText(_ element: AXUIElement, target: Target, root: AXUIElement) throws -> String {
        try validateElement(element, target: target, root: root)
        let role = try string(element, kAXRoleAttribute)
        guard role == kAXTextFieldRole || role == kAXTextAreaRole || role == kAXComboBoxRole else { throw NativeFailure("unsafe-element", "仅允许明确的非安全可编辑文本控件") }
        try requireSettable(element, kAXValueAttribute)
        guard let text = try string(element, kAXValueAttribute), text.utf16.count <= 1_048_576 else { throw NativeFailure("unsafe-element", "无法有界读取可编辑文本") }
        return text
    }
    private func selectedRange(_ element: AXUIElement) throws -> CFRange {
        guard let raw = try value(element, kAXSelectedTextRangeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { throw NativeFailure("invalid-selection", "无法读取可信AX选区；不猜测插入位置") }
        let axValue = unsafeBitCast(raw, to: AXValue.self)
        var range = CFRange(location: -1, length: -1)
        guard AXValueGetType(axValue) == .cfRange, AXValueGetValue(axValue, .cfRange, &range) else { throw NativeFailure("invalid-selection", "AX选区不是有效UTF16范围") }
        return range
    }
    func textInsertionState(_ element: AXUIElement, target: Target, root: AXUIElement) throws -> TextInsertionState {
        let original = try editableText(element, target: target, root: root)
        try requireSettable(element, kAXSelectedTextRangeAttribute)
        let range = try selectedRange(element)
        _ = try replacingSelectedText(original: original, range: range, replacement: "")
        guard CFEqual(try focusedElement(), element),
              let stableValue = try string(element, kAXValueAttribute), original.utf16.elementsEqual(stableValue.utf16) else { throw NativeFailure("focus-changed", "插入前目标焦点或原文不稳定") }
        let stableRange = try selectedRange(element)
        guard stableRange.location == range.location, stableRange.length == range.length else { throw NativeFailure("selection-changed", "读取期间选区已变化，拒绝替换") }
        return TextInsertionState(value: original, location: range.location, length: range.length)
    }
    // prepare、确认后verify及最终dispatch共用同一套实时能力检查。
    func validateAction(_ action: Action, element: AXUIElement, target: Target, root: AXUIElement) throws {
        try validateElement(element, target: target, root: root)
        switch action.kind {
        case "axPress", "axAction":
            _ = try validatedAXActionName(kind: action.kind, secondaryAction: action.secondaryAction, supported: actionNames(element))
        case "axFocus": try requireSettable(element, kAXFocusedAttribute)
        case "axSetValue": _ = try editableText(element, target: target, root: root)
        case "axSelectText":
            let text = try editableText(element, target: target, root: root)
            try requireSettable(element, kAXSelectedTextRangeAttribute)
            _ = try selectedTextRange(value: text, selectionText: action.selectionText ?? "", prefix: action.prefix, suffix: action.suffix, selectionType: action.selectionType ?? "text")
        case "paste":
            try validateInsertionFormat(action.format ?? "text")
            let state = try textInsertionState(element, target: target, root: root)
            _ = try replacingSelectedText(original: state.value, range: state.range, replacement: action.text ?? "")
        default: break
        }
    }
    func performAX(_ action: Action, element: AXUIElement, target: Target, root: AXUIElement, expectedInsertion: TextInsertionState? = nil, beforeDispatch: () throws -> Void) throws -> AXError {
        try validateAction(action, element: element, target: target, root: root)
        let name: String, attribute: String, payload: CFTypeRef?
        switch action.kind {
        case "axPress", "axAction": name = action.kind == "axPress" ? kAXPressAction : action.secondaryAction ?? ""; attribute = ""; payload = nil
        case "axFocus": name = ""; attribute = kAXFocusedAttribute; payload = kCFBooleanTrue
        case "axSetValue": name = ""; attribute = kAXValueAttribute; payload = (action.text ?? "") as CFString
        case "paste":
            // 不使用剪贴板或cmd+v；延迟执行/停止时也没有读取用户原剪贴板的路径。
            guard let expectedInsertion else { throw NativeFailure("preparation-required", "缺少已绑定的原文与可信选区") }
            let current = try textInsertionState(element, target: target, root: root)
            try validateInsertionState(expectedInsertion, current: current)
            let replacement = action.text ?? ""
            let fullValue = try replacingSelectedText(original: current.value, range: current.range, replacement: replacement)
            name = ""
            if try attributeSettable(element, kAXSelectedTextAttribute) {
                attribute = kAXSelectedTextAttribute; payload = replacement as CFString
            } else {
                // SelectedText不可写时只进行一次确定的全文设置，不发送键盘事件、不尝试其他写路径。
                try requireSettable(element, kAXValueAttribute)
                attribute = kAXValueAttribute; payload = fullValue as CFString
            }
        case "axSelectText":
            let text = try editableText(element, target: target, root: root)
            var range = try selectedTextRange(value: text, selectionText: action.selectionText ?? "", prefix: action.prefix, suffix: action.suffix, selectionType: action.selectionType ?? "text")
            guard let value = AXValueCreate(.cfRange, &range) else { throw NativeFailure("invalid-selection", "无法构造UTF16文本范围") }
            name = ""; attribute = kAXSelectedTextRangeAttribute; payload = value
        default: throw NativeFailure("unsupported-action", "不支持的AX写操作")
        }
        try beforeDispatch()
        AXUIElementSetMessagingTimeout(element, 0.08)
        if let payload { return AXUIElementSetAttributeValue(element, attribute as CFString, payload) }
        return AXUIElementPerformAction(element, name as CFString)
    }
}
