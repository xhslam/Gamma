import AppKit
import ScreenCaptureKit
import ApplicationServices
import Carbon
import Darwin
import CryptoKit

func processIdentity(_ pid: pid_t) throws -> String {
    var info = proc_bsdinfo()
    let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    guard count == MemoryLayout<proc_bsdinfo>.size, info.pbi_uid == getuid(), info.pbi_pid == UInt32(pid) else { throw NativeFailure("process-identity", "进程身份或用户不可信") }
    return "\(pid):\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
}
struct WindowMetadata {
    let id: UInt32, pid: pid_t, bounds: CGRect, layer: Int, alpha: Double, onScreen: Bool
    init?(_ dictionary: NSDictionary) {
        guard let id = dictionary[kCGWindowNumber] as? NSNumber, let pid = dictionary[kCGWindowOwnerPID] as? NSNumber,
              let layer = dictionary[kCGWindowLayer] as? NSNumber, let alpha = dictionary[kCGWindowAlpha] as? NSNumber,
              let onScreen = dictionary[kCGWindowIsOnscreen] as? NSNumber,
              let raw = dictionary[kCGWindowBounds] as? NSDictionary,
              let x = raw["X"] as? NSNumber, let y = raw["Y"] as? NSNumber,
              let width = raw["Width"] as? NSNumber, let height = raw["Height"] as? NSNumber else { return nil }
        self.id = id.uint32Value; self.pid = pid.int32Value; self.layer = layer.intValue
        self.alpha = alpha.doubleValue; self.onScreen = onScreen.boolValue
        self.bounds = CGRect(x: x.doubleValue, y: y.doubleValue, width: width.doubleValue, height: height.doubleValue)
        guard self.alpha.isFinite, self.alpha >= 0, self.alpha <= 1,
              [self.bounds.origin.x, self.bounds.origin.y, self.bounds.width, self.bounds.height].allSatisfy(\.isFinite) else { return nil }
    }
}
// 纯函数：离线验证遮挡、几何及CG→AX反向唯一映射，不访问任何真实桌面。
func validateWindowStack(_ raw: [NSDictionary], target: Target, requireFrontmost: Bool) throws {
    guard raw.count <= 2048 else { throw NativeFailure("window-metadata", "窗口列表超过预算") }
    var seenTarget = false, mappingCount = 0
    for item in raw {
        // 缺失元数据时拒绝，包含半透明窗口，不以视觉透明度猜测遮挡。
        guard let window = WindowMetadata(item) else { throw NativeFailure("window-metadata", "窗口元数据不完整") }
        if window.pid == target.pid, window.bounds == target.bounds.cg, window.layer == 0 { mappingCount += 1 }
        if window.id == target.windowId {
            guard !seenTarget, window.pid == target.pid, window.bounds == target.bounds.cg, window.layer == 0,
                  window.onScreen, window.alpha == 1 else { throw NativeFailure("target-changed", "窗口移动、缩放或身份变化") }
            seenTarget = true; continue
        }
        if requireFrontmost, !seenTarget, window.onScreen, window.bounds.intersects(target.bounds.cg) {
            throw NativeFailure("occluded", "目标被其他窗口覆盖；保守拒绝，包括透明或未知覆盖")
        }
    }
    guard seenTarget else { throw NativeFailure("target-gone", "目标窗口已不在屏幕上") }
    guard mappingCount == 1 else { throw NativeFailure("ambiguous-window", "CG窗口到AX窗口的反向映射不唯一") }
}
// 主屏ID而不是SC列表顺序决定捕获范围；每次执行前重核几何。
func validateDisplay(_ display: DisplayResult?) throws {
    guard let d = display, let id = d.displayId, id == CGMainDisplayID(), CGDisplayIsActive(id) != 0 else { throw NativeFailure("display-changed", "主显示器已变化，请重新截图") }
    let r = CGDisplayBounds(id)
    guard r.origin.x == d.originX, r.origin.y == d.originY, r.width == d.ptWidth, r.height == d.ptHeight else { throw NativeFailure("display-changed", "显示器缩放或布局已变化") }
}
func isGammaPID(_ pid: pid_t) -> Bool {
    if pid == getpid() || pid == getppid() { return true }
    if let parentBundle = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier,
       let targetBundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier,
       parentBundle == targetBundle {
        return true
    }
    if let targetBundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier,
       targetBundle == "com.gamma.app" {
        return true
    }
    return false
}
func appIdentity(_ pid: pid_t) throws -> AppIdentity {
    guard let app = NSRunningApplication(processIdentifier: pid), let bundle = app.bundleIdentifier, !bundle.isEmpty else { throw NativeFailure("unknown-application", "无法识别实际目标应用") }
    return AppIdentity(name: app.localizedName ?? bundle, bundleId: bundle, pid: pid, processIdentity: try processIdentity(pid))
}
func currentApplication() throws -> AppIdentity {
    guard let app = NSWorkspace.shared.frontmostApplication else { throw NativeFailure("unknown-application", "无法识别前台应用") }
    return try appIdentity(app.processIdentifier)
}
func resolveApplication(_ name: String) throws -> (URL, ResolvedApp) {
    guard !name.isEmpty, name.utf8.count <= 512, !name.contains("/"), !name.contains("\\"), !name.unicodeScalars.contains(where: { $0.value < 32 }) else { throw NativeFailure("invalid-application", "应用名称或标识无效") }
    let aliases = ["notes": "com.apple.Notes", "备忘录": "com.apple.Notes", "safari": "com.apple.Safari", "finder": "com.apple.finder", "访达": "com.apple.finder", "mail": "com.apple.mail", "邮件": "com.apple.mail", "calendar": "com.apple.iCal", "日历": "com.apple.iCal", "calculator": "com.apple.calculator", "计算器": "com.apple.calculator", "messages": "com.apple.MobileSMS", "信息": "com.apple.MobileSMS", "terminal": "com.apple.Terminal", "终端": "com.apple.Terminal", "system settings": "com.apple.systempreferences", "系统设置": "com.apple.systempreferences"]
    let identifier = aliases[name.lowercased()] ?? name
    var urls: [URL] = []
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier) { urls = [url] }
    if urls.isEmpty {
        let base = name.hasSuffix(".app") ? String(name.dropLast(4)) : name
        for directory in ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities"] {
            let url = URL(fileURLWithPath: directory).appendingPathComponent(base + ".app")
            if FileManager.default.fileExists(atPath: url.path) { urls.append(url) }
        }
    }
    guard Set(urls.map { $0.resolvingSymlinksInPath().path }).count == 1, let url = urls.first?.resolvingSymlinksInPath(), let bundle = Bundle(url: url), let bundleId = bundle.bundleIdentifier, !bundleId.isEmpty else { throw NativeFailure("application-not-found", "未找到唯一且具有Bundle ID的应用") }
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).filter { $0.bundleURL?.resolvingSymlinksInPath() == url }
    let validRunning = running.filter { app in
        guard !app.isTerminated else { return false }
        return (try? processIdentity(app.processIdentifier)) != nil
    }
    guard validRunning.count <= 1 else { throw NativeFailure("ambiguous-application", "存在多个目标应用进程") }
    let pid = validRunning.first?.processIdentifier
    let processIdent = pid.flatMap { try? processIdentity($0) }
    return (url, ResolvedApp(appName: bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? url.deletingPathExtension().lastPathComponent, bundleId: bundleId, pid: pid, processIdentity: processIdent))
}
func listApplications() -> AppListResult {
    let apps = NSWorkspace.shared.runningApplications.filter {
        $0.activationPolicy == .regular && !isGammaPID($0.processIdentifier) && !$0.isTerminated && (try? processIdentity($0.processIdentifier)) != nil
    }
        .sorted { ($0.bundleIdentifier ?? "", $0.processIdentifier) < ($1.bundleIdentifier ?? "", $1.processIdentifier) }
        .prefix(256).compactMap { app -> ListedApp? in
            guard let bundle = app.bundleIdentifier, !bundle.isEmpty, bundle.utf8.count <= 512 else { return nil }
            return ListedApp(appName: String((app.localizedName ?? bundle).prefix(256)), bundleId: bundle, pid: app.processIdentifier, isRunning: true)
        }
    return AppListResult(apps: apps)
}

func axRect(_ element: AXUIElement) -> CGRect? {
    var rawPosition: CFTypeRef?, rawSize: CFTypeRef?
    AXUIElementSetMessagingTimeout(element, 0.08)
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &rawPosition) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &rawSize) == .success,
          let rawPosition, let rawSize,
          CFGetTypeID(rawPosition) == AXValueGetTypeID(), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(rawPosition, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(rawSize, to: AXValue.self), .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}

func accessibilityWindows() -> [Target] {
    var results: [Target] = []
    var seenPids = Set<pid_t>()
    var apps: [NSRunningApplication] = []
    if let front = NSWorkspace.shared.frontmostApplication, front.activationPolicy == .regular, !isGammaPID(front.processIdentifier) {
        apps.append(front)
        seenPids.insert(front.processIdentifier)
    }
    for app in NSWorkspace.shared.runningApplications {
        guard app.activationPolicy == .regular, !isGammaPID(app.processIdentifier), !seenPids.contains(app.processIdentifier) else { continue }
        apps.append(app)
        seenPids.insert(app.processIdentifier)
    }
    for app in apps.prefix(32) {
        let pid = app.processIdentifier
        guard let bundle = app.bundleIdentifier, let ident = try? processIdentity(pid) else { continue }
        let axApp = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(axApp, 0.08)
        var rawWindows: CFTypeRef?
        let copyRes = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &rawWindows)
        let axWinList = (copyRes == .success ? rawWindows as? [AXUIElement] : nil) ?? []
        var appTargets: [Target] = []
        for axWin in axWinList.prefix(16) {
            guard let frame = axRect(axWin), frame.width > 1, frame.height > 1, frame.width.isFinite, frame.height.isFinite else { continue }
            var wid: CGWindowID = 0
            _ = _AXUIElementGetWindow(axWin, &wid)
            if wid == 0 { wid = UInt32(bitPattern: pid) }
            var titleRef: CFTypeRef?
            _ = AXUIElementCopyAttributeValue(axWin, kAXTitleAttribute as CFString, &titleRef)
            let title = (titleRef as? String) ?? ""
            appTargets.append(Target(windowId: wid, pid: pid, processIdentity: ident, bundleId: bundle, title: title, bounds: Rect(frame)))
        }
        if appTargets.isEmpty {
            var focusedWinRef: CFTypeRef?
            if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focusedWinRef) == .success,
               let focusedWin = focusedWinRef {
                let axWin = unsafeBitCast(focusedWin, to: AXUIElement.self)
                if let frame = axRect(axWin), frame.width > 1, frame.height > 1, frame.width.isFinite, frame.height.isFinite {
                    var wid: CGWindowID = 0
                    _ = _AXUIElementGetWindow(axWin, &wid)
                    if wid == 0 { wid = UInt32(bitPattern: pid) }
                    var titleRef: CFTypeRef?
                    _ = AXUIElementCopyAttributeValue(axWin, kAXTitleAttribute as CFString, &titleRef)
                    let title = (titleRef as? String) ?? ""
                    appTargets.append(Target(windowId: wid, pid: pid, processIdentity: ident, bundleId: bundle, title: title, bounds: Rect(frame)))
                }
            }
        }
        results.append(contentsOf: appTargets)
    }
    return results
}

func desktopWindows() throws -> [Target] {
    var windows: [Target] = []
    if let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [NSDictionary], raw.count <= 2048 {
        for item in raw {
            guard let w = WindowMetadata(item) else { continue }
            guard w.onScreen, w.alpha > 0, w.bounds.width > 1, w.bounds.height > 1, !isGammaPID(w.pid), let app = NSRunningApplication(processIdentifier: w.pid), app.activationPolicy == .regular, let bundle = app.bundleIdentifier else { continue }
            guard let ident = try? processIdentity(w.pid) else { continue }
            windows.append(Target(windowId: w.id, pid: w.pid, processIdentity: ident, bundleId: bundle, title: item[kCGWindowName] as? String ?? "", bounds: Rect(w.bounds)))
        }
    }
    if windows.isEmpty {
        windows = accessibilityWindows()
    }
    return windows
}
func windowAt(_ point: CGPoint) throws -> Target {
    guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [NSDictionary], raw.count <= 2048 else { throw NativeFailure("window-metadata", "无法核验实际点击窗口") }
    for item in raw {
        guard let w = WindowMetadata(item) else { throw NativeFailure("window-metadata", "窗口元数据不完整") }
        guard w.onScreen, w.alpha > 0, w.bounds.contains(point) else { continue }
        // 不穿透Gamma/系统弹窗/透明遮挡去授权后面的应用。
        guard !isGammaPID(w.pid), let app = NSRunningApplication(processIdentifier: w.pid), app.activationPolicy == .regular, let bundle = app.bundleIdentifier else { throw NativeFailure("untrusted-surface", "落点属于Gamma或无法授权的系统界面") }
        return Target(windowId: w.id, pid: w.pid, processIdentity: try processIdentity(w.pid), bundleId: bundle, title: item[kCGWindowName] as? String ?? "", bounds: Rect(w.bounds))
    }
    throw NativeFailure("unknown-target", "落点没有可验证的应用窗口")
}
func gammaUIContains(_ point: CGPoint) -> Bool {
    guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [NSDictionary] else { return false }
    for item in raw {
        guard let w = WindowMetadata(item) else { continue }
        guard w.onScreen, w.alpha > 0.05, w.bounds.contains(point) else { continue }
        if isGammaPID(w.pid) { return true }
        if let app = NSRunningApplication(processIdentifier: w.pid), app.activationPolicy == .regular {
            return false
        }
    }
    return false
}
func captureDimensions(width: Double, height: Double, maxEdge: Int = 1280) -> (Int, Int) {
    guard width.isFinite, height.isFinite, width > 0, height > 0 else { return (2, 2) }
    let edge = max(2, min(1920, maxEdge))
    let scale = Double(edge) / max(width, height)
    return (max(2, min(edge, Int((width * scale).rounded()))), max(2, min(edge, Int((height * scale).rounded()))))
}
// 读取显示器几何不捕获像素，也不要求屏幕录制。
func accessibilityDisplay() throws -> DisplayResult {
    let id = CGMainDisplayID(), bounds = CGDisplayBounds(id)
    guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 1, bounds.height > 1,
          bounds.width <= 32768, bounds.height <= 32768 else { throw NativeFailure("display-changed", "主显示器几何不可用") }
    let result = DisplayResult(displayId: id, originX: bounds.origin.x, originY: bounds.origin.y,
                               ptWidth: bounds.width, ptHeight: bounds.height,
                               scaledWidth: Int(bounds.width.rounded()), scaledHeight: Int(bounds.height.rounded()))
    try validateDisplay(result); return result
}
// 默认滚动只落在已验证焦点窗口可见区域，不猜测主屏中心。
func defaultScrollPoint(elementBounds: Rect?, windowBounds: Rect, display: DisplayResult?) throws -> CGPoint {
    guard let display else { throw NativeFailure("display-changed", "缺少已观察显示器") }
    let screen = CGRect(x: display.originX, y: display.originY, width: display.ptWidth, height: display.ptHeight)
    let visibleWindow = windowBounds.cg.intersection(screen)
    let preferred = elementBounds?.cg.intersection(visibleWindow) ?? visibleWindow
    guard !preferred.isNull, preferred.width > 1, preferred.height > 1 else {
        writeNativeComputerUseLog(
            location: "Desktop.swift:defaultScrollPoint",
            rawError: "滚动焦点没有可验证的主屏可见区域",
            errorCode: "unsafe-focus"
        )
        throw NativeFailure("unsafe-focus", "滚动焦点没有可验证的主屏可见区域")
    }
    return CGPoint(x: preferred.midX, y: preferred.midY)
}
func validateVisualAction(_ action: Action, snapshot: Snapshot) throws {
    let pixel = ["click", "double_click", "triple_click", "right_click", "middle_click", "mouse_move", "move", "drag", "left_click_drag"].contains(action.kind)
    guard snapshot.hasImage || (!pixel && !(action.kind == "scroll" && (action.x != nil || action.y != nil))) else {
        throw NativeFailure("screen-capture-required", "当前是辅助功能观察；像素坐标操作需要启用屏幕录制并重新观察")
    }
}
func captureDisplay(targetWidth: Int = 1280, completion: @escaping (Result<(Data, DisplayResult, Int, Int), Error>) -> Void) {
    guard CGPreflightScreenCaptureAccess() else { completion(.failure(NativeFailure("permission-required", "屏幕录制权限未授予或已撤销", permission: "screen"))); return }
    if #available(macOS 14.2, *) {
        let displayID = CGMainDisplayID()
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            guard error == nil, let content, let display = content.displays.first(where: { $0.displayID == displayID }) else { completion(.failure(NativeFailure("capture-failed", "无法读取主显示器"))); return }
            let bounds = CGDisplayBounds(displayID)
            let excluded = content.applications.filter { isGammaPID($0.processID) }
            let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
            let config = SCStreamConfiguration()
            let (width, height) = captureDimensions(width: bounds.width, height: bounds.height, maxEdge: targetWidth)
            config.width = width; config.height = height
            config.showsCursor = false; config.capturesAudio = false; config.scalesToFit = true
            SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
                guard error == nil, let image else { completion(.failure(NativeFailure("capture-failed", "主屏截图失败"))); return }
                var result = DisplayResult(originX: bounds.origin.x, originY: bounds.origin.y, ptWidth: bounds.width, ptHeight: bounds.height, scaledWidth: image.width, scaledHeight: image.height)
                result.displayId = displayID
                do { try validateDisplay(result) } catch { completion(.failure(error)); return }
                guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]), png.count <= 8 * 1024 * 1024 else { completion(.failure(NativeFailure("capture-too-large", "截图超过预算"))); return }
                completion(.success((png, result, image.width, image.height)))
            }
        }
    } else { completion(.failure(NativeFailure("unsupported-os", "需要macOS14.2+"))) }
}

// 标记只用于过滤本helper已投递事件，不声称隔离同用户恶意AX程序。
let HELPER_EVENT_TAG = Int64.random(in: 1...Int64.max)
func isOwnEvent(tag: Int64, sourcePID: Int64, expectedTag: Int64 = HELPER_EVENT_TAG, expectedPID: Int64 = Int64(getpid())) -> Bool { tag == expectedTag && sourcePID == expectedPID }
func validateInputEnvironment() throws {
    guard AXIsProcessTrusted() else { throw NativeFailure("permission-required", "请在系统辅助功能中允许Gamma控制电脑", permission: "accessibility") }
    guard !IsSecureEventInputEnabled() else { throw NativeFailure("secure-input", "系统安全输入禁止注入，未投递动作") }
    guard CGEventSource.flagsState(.combinedSessionState).intersection([.maskShift, .maskControl, .maskAlternate, .maskCommand]).isEmpty,
          !(0..<128).contains(where: { CGEventSource.keyState(.combinedSessionState, key: CGKeyCode($0)) }),
          ![CGMouseButton.left, .right, .center].contains(where: { CGEventSource.buttonState(.combinedSessionState, button: $0) }) else { throw NativeFailure("input-held", "存在按住的物理按键或鼠标按钮") }
}
struct MouseStep { let type: CGEventType; let point: CGPoint; let button: CGMouseButton; let clickState: Int64 }
func mouseSteps(_ action: Action, snapshot: Snapshot) throws -> [MouseStep] {
    guard let x = action.x, let y = action.y else { throw NativeFailure("invalid-coordinate", "缺少坐标") }
    let end = try snapshot.point(x: x, y: y)
    if ["move", "mouse_move"].contains(action.kind) { return [MouseStep(type: .mouseMoved, point: end, button: .left, clickState: 0)] }
    if ["drag", "left_click_drag"].contains(action.kind) {
        guard let sx = action.startX, let sy = action.startY else { throw NativeFailure("invalid-coordinate", "缺少拖拽起点") }
        let start = try snapshot.point(x: sx, y: sy)
        var steps = [MouseStep(type: .leftMouseDown, point: start, button: .left, clickState: 1)]
        for i in 1...20 { let t = Double(i) / 20; steps.append(MouseStep(type: .leftMouseDragged, point: CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t), button: .left, clickState: 1)) }
        steps.append(MouseStep(type: .leftMouseUp, point: end, button: .left, clickState: 1)); return steps
    }
    let button: CGMouseButton = action.kind == "right_click" || action.button == "right" ? .right : action.kind == "middle_click" || action.button == "middle" ? .center : .left
    let count = action.kind == "double_click" ? 2 : action.kind == "triple_click" ? 3 : action.clickCount ?? 1
    guard (1...3).contains(count) else { throw NativeFailure("invalid-action", "点击次数必须为1到3") }
    return (1...count).flatMap { n in [MouseStep(type: button == .left ? .leftMouseDown : button == .right ? .rightMouseDown : .otherMouseDown, point: end, button: button, clickState: Int64(n)), MouseStep(type: button == .left ? .leftMouseUp : button == .right ? .rightMouseUp : .otherMouseUp, point: end, button: button, clickState: Int64(n))] }
}
// CG Unicode事件采用小批UTF16，不拆开代理对，不写系统剪贴板。
func unicodeEventChunks(_ text: String) -> [[UInt16]] {
    var result: [[UInt16]] = [], chunk: [UInt16] = []
    for scalar in text.unicodeScalars {
        let units = Array(String(scalar).utf16)
        if chunk.count + units.count > 20 { result.append(chunk); chunk = [] }
        chunk.append(contentsOf: units)
    }
    if !chunk.isEmpty { result.append(chunk) }; return result
}
final class EventDispatcher {
    private let lock = NSLock()
    private var release: CGEvent?
    private func tag(_ event: CGEvent) { event.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG) }
    private func post(_ event: CGEvent, release nextRelease: CGEvent?, validate: () throws -> Void, commit: (() -> Void) throws -> Void) throws {
        try validate()
        lock.lock(); defer { lock.unlock() }
        try commit { release = nextRelease; tag(event); event.post(tap: .cgSessionEventTap) }
    }
    func post(_ action: Action, snapshot: Snapshot, expectedPID: pid_t? = nil, scrollPoint: CGPoint? = nil, validate: () throws -> Void, commit: (() -> Void) throws -> Void) throws {
        let source = CGEventSource(stateID: .privateState); source?.localEventsSuppressionInterval = 0
        defer { releaseAll() }
        if ["click", "double_click", "triple_click", "right_click", "middle_click", "mouse_move", "move", "drag", "left_click_drag"].contains(action.kind) {
            let steps = try mouseSteps(action, snapshot: snapshot)
            for (index, step) in steps.enumerated() {
                if let expectedPID { guard try windowAt(step.point).pid == expectedPID else { throw NativeFailure("target-changed", "鼠标事件实际接收应用已变化") } }
                guard let event = CGEvent(mouseEventSource: source, mouseType: step.type, mouseCursorPosition: step.point, mouseButton: step.button) else { throw NativeFailure("event-create", "无法构造鼠标事件") }
                event.setIntegerValueField(.mouseEventClickState, value: step.clickState)
                let isHeld = [.leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged].contains(step.type)
                let upType: CGEventType = step.button == .left ? .leftMouseUp : step.button == .right ? .rightMouseUp : .otherMouseUp
                let up = isHeld ? CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: step.point, mouseButton: step.button) : nil
                if let up { tag(up) }
                try post(event, release: up, validate: validate, commit: commit)
                if index + 1 < steps.count { Thread.sleep(forTimeInterval: 0.012) }
            }
        } else if action.kind == "scroll" {
            guard let delta = action.deltaY,
                  let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: -Int32(delta.rounded()), wheel2: 0, wheel3: 0) else { throw NativeFailure("event-create", "无法构造滚动") }
            if let x = action.x, let y = action.y { event.location = try snapshot.point(x: x, y: y) }
            else if let scrollPoint { event.location = scrollPoint }
            else {
                writeNativeComputerUseLog(
                    location: "Desktop.swift:EventDispatcher.post:scroll",
                    action: "scroll",
                    rawError: "滚动缺少已验证焦点落点",
                    errorCode: "unsafe-focus"
                )
                throw NativeFailure("unsafe-focus", "滚动缺少已验证焦点落点")
            }
            if let expectedPID { guard try windowAt(event.location).pid == expectedPID else { throw NativeFailure("target-changed", "滚动目标应用已改变") } }
            try post(event, release: nil, validate: validate, commit: commit)
        } else {
            let code: CGKeyCode, flags: CGEventFlags
            if action.kind == "key" {
                do {
                    (code, flags) = try parseKeyCombination(action.key ?? "")
                } catch {
                    writeNativeComputerUseLog(
                        location: "Desktop.swift:EventDispatcher.post:parseKeyCombination",
                        action: "key",
                        rawError: (error as? NativeFailure)?.message ?? error.localizedDescription,
                        errorCode: (error as? NativeFailure)?.code ?? "invalid-action"
                    )
                    throw error
                }
            }
            else if action.kind == "type" { code = 0; flags = [] }
            else { throw NativeFailure("unsupported-action", "此动作不属于输入事件") }
            let chunks = action.kind == "type" ? unicodeEventChunks(action.text ?? "") : [[]]
            for units in chunks {
                guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true), let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { throw NativeFailure("event-create", "无法构造键盘事件") }
                down.flags = flags; up.flags = flags
                if action.kind == "type" {
                    guard !units.isEmpty else { throw NativeFailure("invalid-action", "文本不能为空") }
                    units.withUnsafeBufferPointer { ptr in down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: ptr.baseAddress!); up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: ptr.baseAddress!) }
                }
                tag(up)
                try post(down, release: up, validate: validate, commit: commit)
                try post(up, release: nil, validate: validate, commit: commit)
            }
        }
    }
    func releaseAll() { lock.lock(); defer { lock.unlock() }; release?.post(tap: .cgSessionEventTap); release = nil }
}

final class SafetyMonitor {
    let gate: SafetyGate
    let onStop: (String) -> Void
    private let mutex = NSLock()
    private var uiHeartbeat = ProcessInfo.processInfo.systemUptime
    private var tap: CFMachPort?
    private var started = false
    private let parentPID = getppid()
    init(gate: SafetyGate, onStop: @escaping (String) -> Void) { self.gate = gate; self.onStop = onStop }
    func heartbeat() { mutex.lock(); uiHeartbeat = ProcessInfo.processInfo.systemUptime; mutex.unlock() }
    private func received(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { gate.setListenerHealthy(false); onStop("安全监听已失活"); return }
        if isOwnEvent(tag: event.getIntegerValueField(.eventSourceUserData), sourcePID: event.getIntegerValueField(.eventSourceUnixProcessID)) { return }
        guard gate.monitorsInput else { return }
        if type == .keyDown, event.getIntegerValueField(.keyboardEventKeycode) == 53, event.flags.contains([.maskControl, .maskAlternate]) { onStop("紧急停止快捷键"); return }
        if gate.isScreenPermissionWaiting { return }

        // 无论是否处于二次确认阶段，用户在 Gamma 自身界面内的键盘或鼠标操作均为正常交互，不判定为接管外部桌面
        let isKeyboard = [.keyDown, .keyUp, .flagsChanged].contains(type)
        if isKeyboard, let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier, isGammaPID(pid) { return }
        if !isKeyboard, gammaUIContains(event.location) { return }

        // 过滤非接管被动事件：纯光标位移、按键松开、鼠标按键抬起、修饰键单独切换、动量滚动不构成外部桌面接管
        let passiveEvents: [CGEventType] = [.mouseMoved, .keyUp, .flagsChanged, .leftMouseUp, .rightMouseUp, .otherMouseUp]
        if passiveEvents.contains(type) { return }
        if type == .scrollWheel && event.getIntegerValueField(.scrollWheelEventMomentumPhase) != 0 { return }

        onStop("检测到用户操作，桌面控制已暂停")
    }
    func start() throws {
        mutex.lock(); let already = started; mutex.unlock()
        if already {
            guard let tap, CGEvent.tapIsEnabled(tap: tap) else { throw NativeFailure("listen-disabled", "监听失活；需重启helper") }
            gate.setListenerHealthy(true); return
        }
        let semaphore = DispatchSemaphore(value: 0)
        let thread = Thread { [self] in
            let events: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
            let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
            let callback: CGEventTapCallBack = { _, type, event, context in
                if let context { Unmanaged<SafetyMonitor>.fromOpaque(context).takeUnretainedValue().received(type, event) }
                return Unmanaged.passUnretained(event)
            }
            // 修改型tap由辅助功能授权；回调原样归还事件，不吞键、不要求额外输入监听。
            tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque())
            guard let tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { semaphore.signal(); return }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes); CGEvent.tapEnable(tap: tap, enable: true)
            mutex.lock(); started = true; mutex.unlock(); gate.setListenerHealthy(CGEvent.tapIsEnabled(tap: tap)); semaphore.signal()
            let timer = Timer(timeInterval: 0.1, repeats: true) { [self] _ in
                mutex.lock(); let staleUI = ProcessInfo.processInfo.systemUptime - uiHeartbeat > 2; mutex.unlock()
                if getppid() != parentPID { onStop("父进程已退出"); _exit(0) }
                guard gate.isActive else { return }
                if gate.expired { onStop("授权已过期") }
                else if !CGEvent.tapIsEnabled(tap: tap) { gate.setListenerHealthy(false); onStop("安全监听失活") }
                else if staleUI && !gate.isScreenPermissionWaiting { onStop("本地停止UI无响应") }
                else if IsSecureEventInputEnabled() && !gate.isScreenPermissionWaiting { onStop("系统安全输入已开启") }
            }
            RunLoop.current.add(timer, forMode: .common); CFRunLoopRun()
        }
        thread.name = "Gamma Computer Use安全监听"; thread.start()
        guard semaphore.wait(timeout: .now() + 2) == .success else { throw NativeFailure("listen-timeout", "安全监听启动超时") }
        mutex.lock(); let success = started; mutex.unlock()
        guard success else { throw NativeFailure("listen-denied", "无法建立独立安全监听") }
    }
}

struct PreparedAction {
    let id: String, request: PerformParams
    let snapshot: Snapshot
    let app: AppIdentity?
    let appName: String, bundleId: String
    let window: Target?
    let element: AXUIElement?
    let context: ElementContext
    let elementBounds: Rect?
    let layoutDigest: String?
    let insertionState: TextInsertionState?
    let returnApp: AppIdentity?
    let returnFocus: AXUIElement?
    let resolvedURL: URL?
    let scrollPoint: CGPoint?
}
func samePreparedRequest(_ prepared: PerformParams, _ incoming: PerformParams) -> Bool {
    prepared.leaseId == incoming.leaseId && prepared.epoch == incoming.epoch && prepared.actionId == incoming.actionId && prepared.action == incoming.action
}
func desktopDigest() throws -> String {
    // 只在helper内保存摘要，不把其他窗口标题作为工具输出或日志传播。
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(desktopWindows())
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
func validateObservedLayout(_ snapshot: Snapshot, window: Target, digest: String) throws {
    guard snapshot.target == window, !snapshot.axDigest.isEmpty, snapshot.axDigest == digest else { throw NativeFailure("observation-layout-changed", "实际目标不属于本次已验证的前台布局；请先聚焦目标窗口并重新观察") }
}
func bindAction(_ request: PerformParams, snapshot: Snapshot, ax: AccessibilityWorker) throws -> PreparedAction {
    try validateVisualAction(request.action, snapshot: snapshot)
    try validateDisplay(snapshot.display)
    guard snapshot.desktopDigest == (try desktopDigest()) else { throw NativeFailure("desktop-changed", "桌面布局已改变，请重新观察") }
    let originalApp = try currentApplication()
    let originalFocus: AXUIElement?
    do { originalFocus = try ax.focusedElement() }
    catch let failure as NativeFailure where failure.code == "ax-timeout" { throw failure }
    catch { originalFocus = nil }
    let action = request.action
    if action.kind == "open_app" {
        guard let bundleId = action.bundleId ?? action.appName else { throw NativeFailure("invalid-application", "缺少已解析的Bundle ID") }
        let (url, result) = try resolveApplication(bundleId)
        guard result.bundleId == bundleId else { throw NativeFailure("target-changed", "解析应用身份已变化") }
        let app = try result.pid.map { try appIdentity($0) }
        return PreparedAction(id: UUID().uuidString, request: request, snapshot: snapshot, app: app, appName: result.appName, bundleId: result.bundleId, window: nil, element: nil, context: ElementContext(role: "AXApplication", subrole: nil, title: nil, description: nil, isSecure: false, isTrustedSearch: false), elementBounds: nil, layoutDigest: nil, insertionState: nil, returnApp: originalApp, returnFocus: originalFocus, resolvedURL: url, scrollPoint: nil)
    }
    if action.kind == "wait" {
        try validateBundleConstraint(action.bundleId, actual: originalApp.bundleId)
        return PreparedAction(id: UUID().uuidString, request: request, snapshot: snapshot, app: originalApp, appName: originalApp.name, bundleId: originalApp.bundleId, window: nil, element: nil, context: ElementContext(role: "AXApplication", subrole: nil, title: nil, description: nil, isSecure: false, isTrustedSearch: false), elementBounds: nil, layoutDigest: nil, insertionState: nil, returnApp: originalApp, returnFocus: originalFocus, resolvedURL: nil, scrollPoint: nil)
    }
    let windows = try desktopWindows()
    let window: Target, element: AXUIElement
    var scrollPoint: CGPoint?
    if action.kind.hasPrefix("ax") || (action.kind == "paste" && action.elementRef != nil) {
        guard let ref = action.elementRef, let stored = snapshot.axRefs[ref], let target = snapshot.target,
              snapshot.axRoot != nil else { throw NativeFailure("stale-element-ref", "elementRef不属于本次观察；请重新观察获取引用") }
        window = target; element = stored
        guard target.pid == originalApp.pid, !isGammaPID(target.pid) else {
            writeNativeComputerUseLog(
                location: "Desktop.swift:bindAction:ax_target_not_frontmost",
                action: action.kind,
                rawError: "AX引用目标不是可授权的前台应用",
                errorCode: "unsafe-focus",
                targetApp: ["pid": target.pid, "bundleId": target.bundleId]
            )
            throw NativeFailure("unsafe-focus", "AX引用目标不是可授权的前台应用")
        }
    } else if action.kind == "focus_window" {
        guard let id = action.windowId, let found = windows.first(where: { $0.windowId == id }) else { throw NativeFailure("target-gone", "目标窗口不在屏幕上") }
        window = found; element = try ax.matchedWindow(found)
    } else if action.kind == "scroll", action.x == nil, action.y == nil {
        window = try ax.windowForFocused(originalApp.pid, windows: windows)
        let focused = try ax.focusedElement()
        guard try ax.elementPID(focused) == originalApp.pid else {
            writeNativeComputerUseLog(
                location: "Desktop.swift:bindAction:scroll_focused_not_original_app",
                action: "scroll",
                rawError: "滚动焦点不属于前台应用",
                errorCode: "unsafe-focus",
                targetApp: ["pid": originalApp.pid, "name": originalApp.name, "bundleId": originalApp.bundleId],
                focusedElement: describeAXElementInfo(focused)
            )
            throw NativeFailure("unsafe-focus", "滚动焦点不属于前台应用")
        }
        let (_, focusedBounds) = try ax.context(focused)
        let point = try defaultScrollPoint(elementBounds: focusedBounds, windowBounds: window.bounds, display: snapshot.display)
        guard try windowAt(point).windowId == window.windowId else { throw NativeFailure("occluded", "默认滚动位置被其他窗口遮挡") }
        element = try ax.hitElement(point); scrollPoint = point
    } else if ["key", "type", "paste"].contains(action.kind) {
        element = try ax.focusedElement()
        let pid = try ax.elementPID(element)
        guard !isGammaPID(pid), pid == originalApp.pid else {
            writeNativeComputerUseLog(
                location: "Desktop.swift:bindAction:key_type_paste",
                action: action.kind,
                rawError: "焦点不属于可授权的前台应用",
                errorCode: "unsafe-focus",
                targetApp: ["pid": originalApp.pid, "name": originalApp.name, "bundleId": originalApp.bundleId],
                focusedElement: describeAXElementInfo(element)
            )
            throw NativeFailure("unsafe-focus", "焦点不属于可授权的前台应用")
        }
        window = try ax.windowForFocused(pid, windows: windows)
    } else {
        guard let x = action.startX ?? action.x, let y = action.startY ?? action.y else { throw NativeFailure("invalid-coordinate", "缺少动作坐标") }
        let point = try snapshot.point(x: x, y: y)
        window = try windowAt(point); element = try ax.hitElement(point)
        guard try ax.elementPID(element) == window.pid else { throw NativeFailure("ambiguous-target", "CG命中窗口与AX控件所属应用不一致") }
        if ["drag", "left_click_drag"].contains(action.kind) {
            for step in try mouseSteps(action, snapshot: snapshot) {
                guard try windowAt(step.point).pid == window.pid else { throw NativeFailure("cross-application-drag", "拖拽路径跨应用，暂不支持") }
            }
        }
    }
    try validateBundleConstraint(action.bundleId, actual: window.bundleId)
    let tree = try ax.read(window, allowSurfaces: true)
    try ax.validateElement(element, target: window, root: tree.root)
    if action.kind.hasPrefix("ax") {
        guard let oldRoot = snapshot.axRoot, CFEqual(oldRoot, tree.root), tree.refs.values.contains(where: { CFEqual($0, element) }) else { throw NativeFailure("stale-element-ref", "观察中的原AX元素已不在当前有界树中") }
    }
    try ax.validateAction(action, element: element, target: window, root: tree.root)
    let insertionState = action.kind == "paste" ? try ax.textInsertionState(element, target: window, root: tree.root) : nil
    let (context, bounds) = try ax.context(element)
    if action.kind != "focus_window" {
        try validateObservedLayout(snapshot, window: window, digest: tree.digest)
    }
    let app = try appIdentity(window.pid)
    try validateBundleConstraint(action.bundleId, actual: app.bundleId)
    return PreparedAction(id: UUID().uuidString, request: request, snapshot: snapshot, app: app, appName: app.name, bundleId: app.bundleId, window: window, element: element, context: context, elementBounds: bounds, layoutDigest: tree.digest, insertionState: insertionState, returnApp: originalApp, returnFocus: originalFocus, resolvedURL: nil, scrollPoint: scrollPoint)
}
func verifyBinding(_ prepared: PreparedAction, ax: AccessibilityWorker) throws {
    let fresh = try bindAction(prepared.request, snapshot: prepared.snapshot, ax: ax)
    guard fresh.app == prepared.app, fresh.bundleId == prepared.bundleId, fresh.window == prepared.window,
          fresh.context == prepared.context, fresh.elementBounds == prepared.elementBounds, fresh.layoutDigest == prepared.layoutDigest, fresh.insertionState == prepared.insertionState,
          fresh.returnApp == prepared.returnApp, fresh.resolvedURL == prepared.resolvedURL, fresh.scrollPoint == prepared.scrollPoint else { throw NativeFailure("target-changed", "目标应用、控件、焦点或布局已改变，未投递动作") }
    if let old = prepared.element, let new = fresh.element, !CFEqual(old, new) { throw NativeFailure("target-changed", "目标控件已替换") }
    if let old = prepared.returnFocus, let new = fresh.returnFocus, !CFEqual(old, new) { throw NativeFailure("focus-changed", "原焦点控件已改变") }
    if (prepared.returnFocus == nil) != (fresh.returnFocus == nil) { throw NativeFailure("focus-changed", "无法确认原焦点一致") }
}
