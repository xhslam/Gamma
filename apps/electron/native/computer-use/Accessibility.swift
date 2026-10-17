import Foundation
import ApplicationServices
import CryptoKit

struct AXTree {
    let text: String, digest: String, root: AXUIElement
    let refs: [String: AXUIElement]
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
        if error == .attributeUnsupported || error == .noValue { return nil }
        guard error == .success else { throw NativeFailure("ax-read", "AX属性读取失败") }
        return result
    }
    private func string(_ element: AXUIElement, _ name: String) throws -> String? {
        guard let raw = try value(element, name) else { return nil }
        return raw as? String
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
        guard AXUIElementCopyAttributeValues(app, kAXWindowsAttribute as CFString, 0, 129, &raw) == .success, let windows = raw as? [AXUIElement], windows.count <= 128 else { throw NativeFailure("ax-window", "无法有界映射AX窗口") }
        var matches: [AXUIElement] = []
        for window in windows {
            var pid: pid_t = 0
            guard AXUIElementGetPid(window, &pid) == .success, pid == target.pid,
                  try string(window, kAXTitleAttribute) == target.title,
                  let frame = try rect(window), frame == target.bounds.cg else { continue }
            matches.append(window)
        }
        guard matches.count == 1 else { throw NativeFailure("ambiguous-window", "AX窗口与CG窗口不是唯一PID、标题、几何匹配") }
        return matches[0]
    }
    func read(_ target: Target, allowSurfaces: Bool = false) throws -> AXTree {
        let root = try matchedWindow(target)
        ends = ProcessInfo.processInfo.systemUptime + 1.2
        var lines: [String] = [], canonical: [String] = [], refs: [String: AXUIElement] = [:]
        var seen: [AXUIElement] = [], totalBytes = 0
        func visit(_ element: AXUIElement, depth: Int) throws {
            try budget()
            guard depth <= 8, seen.count < 96, totalBytes < 28_000, !seen.contains(where: { CFEqual($0, element) }) else { return }
            seen.append(element)
            let role = try string(element, kAXRoleAttribute) ?? "unknown"
            let subrole = try string(element, kAXSubroleAttribute) ?? ""
            guard allowSurfaces || !isUnscopedAXSurface(role: role, subrole: subrole, depth: depth) else { throw NativeFailure("unscoped-surface", "附属窗口、sheet、菜单或弹出面板不继承所选窗口授权") }
            let secure = role == "unknown" || role == kAXSecureTextFieldSubrole || subrole == kAXSecureTextFieldSubrole || subrole.localizedCaseInsensitiveContains("secure") || subrole.localizedCaseInsensitiveContains("password")
            let frame = try rect(element)
            // 不读取AXValue：安全控件的标题/描述也可能包含敏感提示，整个子树略过。
            let title = secure ? "[安全或未知控件：已隐藏]" : String((try string(element, kAXTitleAttribute) ?? "").prefix(160))
            let geometry = frame.map { "\($0.origin.x),\($0.origin.y),\($0.width),\($0.height)" } ?? "unknown"
            let entry = "\(depth) \(role) \(subrole) frame=\(geometry) title=\(title)"
            canonical.append(entry)
            let ref = UUID().uuidString
            let line = "ref=\(ref) \(entry)"
            if totalBytes + line.utf8.count + 1 <= 28_000 { lines.append(line); totalBytes += line.utf8.count + 1 }
            if !secure { refs[ref] = element }
            guard !secure, depth < 8, seen.count < 96 else { return }
            // CopyAttributeValues限制返回量，避免先拷贝不受限数组。
            var children: CFArray?
            let result = AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, 96 - seen.count, &children)
            if result == .cannotComplete { throw NativeFailure("ax-timeout", "AX子树读取超时") }
            if result == .success, let items = children as? [AXUIElement] {
                for child in items { try visit(child, depth: depth + 1) }
            }
        }
        try visit(root, depth: 0)
        let digest = SHA256.hash(data: Data(canonical.joined(separator: "\n").utf8)).map { String(format: "%02x", $0) }.joined()
        return AXTree(text: lines.joined(separator: "\n"), digest: digest, root: root, refs: refs)
    }
    func validateElement(_ element: AXUIElement, target: Target, root: AXUIElement) throws {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        var node = element
        for _ in 0..<12 {
            var pid: pid_t = 0
            guard AXUIElementGetPid(node, &pid) == .success, pid == target.pid,
                  let role = try string(node, kAXRoleAttribute), role != "unknown" else { throw NativeFailure("unsafe-element", "AX元素身份不明") }
            let subrole = try string(node, kAXSubroleAttribute) ?? ""
            guard role != kAXSecureTextFieldSubrole, subrole != kAXSecureTextFieldSubrole,
                  !subrole.localizedCaseInsensitiveContains("secure"), !subrole.localizedCaseInsensitiveContains("password") else { throw NativeFailure("secure-field", "拒绝安全字段及其子元素") }
            if CFEqual(node, root) { return }
            guard let parent = try value(node, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
            node = unsafeBitCast(parent, to: AXUIElement.self)
        }
        throw NativeFailure("unsafe-element", "元素无法有界关联到当前窗口")
    }
    func focusedText(_ target: Target, root: AXUIElement) throws {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        let app = AXUIElementCreateApplication(target.pid)
        guard let raw = try value(app, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { throw NativeFailure("unsafe-focus", "无法确认输入焦点") }
        let element = unsafeBitCast(raw, to: AXUIElement.self)
        try validateElement(element, target: target, root: root)
        let role = try string(element, kAXRoleAttribute)
        guard role == kAXTextFieldRole || role == kAXTextAreaRole else { throw NativeFailure("unsafe-focus", "仅允许明确的非安全文本控件输入") }
    }
    func focusedElement() throws -> AXUIElement {
        ends = ProcessInfo.processInfo.systemUptime + 0.8
        let system = AXUIElementCreateSystemWide()
        guard let raw = try value(system, kAXFocusedUIElementAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { throw NativeFailure("unsafe-focus", "无法识别实际焦点控件") }
        return unsafeBitCast(raw, to: AXUIElement.self)
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
        let secure = role == nil || role == kAXSecureTextFieldSubrole || subrole?.localizedCaseInsensitiveContains("secure") == true || subrole?.localizedCaseInsensitiveContains("password") == true
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
        guard let raw = try value(app, kAXFocusedWindowAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { throw NativeFailure("unsafe-focus", "无法识别实际焦点窗口") }
        let root = unsafeBitCast(raw, to: AXUIElement.self)
        let title = try string(root, kAXTitleAttribute) ?? ""
        guard let frame = try rect(root) else { throw NativeFailure("unsafe-focus", "无法读取焦点窗口几何") }
        let matches = windows.filter { $0.pid == pid && $0.title == title && $0.bounds.cg == frame }
        guard matches.count == 1 else { throw NativeFailure("ambiguous-window", "焦点窗口无法唯一关联CG窗口") }
        return matches[0]
    }
    func performAX(_ action: Action, element: AXUIElement, target: Target, root: AXUIElement, beforeDispatch: () throws -> Void) throws -> AXError {
        try validateElement(element, target: target, root: root)
        if action.kind == "axPress" {
            var actions: CFArray?
            guard AXUIElementCopyActionNames(element, &actions) == .success,
                  (actions as? [String])?.contains(kAXPressAction) == true else { throw NativeFailure("unsupported-action", "元素不支持AXPress") }
            try beforeDispatch()
            return AXUIElementPerformAction(element, kAXPressAction as CFString)
        }
        let role = try string(element, kAXRoleAttribute)
        guard role == kAXTextFieldRole || role == kAXTextAreaRole else { throw NativeFailure("unsafe-element", "仅允许设置非安全文本控件") }
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue else { throw NativeFailure("unsupported-action", "元素值不可设置") }
        try beforeDispatch()
        return AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, (action.text ?? "") as CFString)
    }
}
