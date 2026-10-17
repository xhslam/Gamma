import AppKit
import ScreenCaptureKit
import ApplicationServices
import Carbon
import Darwin

func processIdentity(_ pid: pid_t) throws -> String {
    var info = proc_bsdinfo()
    let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    guard count == MemoryLayout<proc_bsdinfo>.size, info.pbi_uid == getuid(), info.pbi_pid == UInt32(pid) else { throw NativeFailure("process-identity", "进程身份或用户不可信") }
    return "\(pid):\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
}
// 这只是已知敏感/执行型应用的拒绝规则，不是任意GUI脚本执行面的OS沙箱。
func forbiddenTargetBundle(_ bundle: String) -> Bool {
    let prefixes = ["com.gamma", "com.proma", "cool.proma", "com.apple.loginwindow", "com.apple.systemuiserver", "com.apple.controlcenter", "com.apple.notificationcenterui", "com.apple.securityagent", "com.apple.terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "dev.warp.", "org.alacritty", "net.kovidgoyal.kitty", "com.apple.scripteditor", "com.apple.automator", "com.apple.shortcuts", "com.microsoft.vscode", "com.todesktop.230313mzl4w4u92", "dev.zed.zed", "com.sublimetext", "com.agilebits.onepassword", "com.1password", "com.bitwarden", "org.keepassxc", "com.apple.passwords", "com.apple.keychainaccess", "com.apple.systempreferences"]
    return prefixes.contains { bundle.lowercased().hasPrefix($0) }
}
func allowedApplication(_ pid: pid_t, bundle: String) -> Bool {
    guard pid != getpid(), let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular,
          !bundle.isEmpty, app.bundleIdentifier == bundle else { return false }
    return !forbiddenTargetBundle(bundle) &&
        !(app.bundleURL?.path.contains("/Gamma.app/") ?? false) && app.bundleURL?.lastPathComponent != "Gamma.app"
}
func targetForWindow(_ window: SCWindow) throws -> Target {
    guard let owner = window.owningApplication, allowedApplication(owner.processID, bundle: owner.bundleIdentifier),
          window.windowLayer == 0, window.isOnScreen, let title = window.title, !title.isEmpty,
          title.utf8.count <= 4096, Rect(window.frame).valid else { throw NativeFailure("unsafe-target", "只支持明确的普通应用单窗口") }
    return Target(windowId: window.windowID, pid: owner.processID, processIdentity: try processIdentity(owner.processID), bundleId: owner.bundleIdentifier, title: title, bounds: Rect(window.frame))
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
        if window.pid == target.pid, window.bounds == target.bounds.cg, window.layer == 0 {
            guard let title = item[kCGWindowName] as? String else { throw NativeFailure("ambiguous-window", "同进程同几何窗口缺少标题，无法唯一映射") }
            if title == target.title { mappingCount += 1 }
        }
        if window.id == target.windowId {
            guard !seenTarget, window.pid == target.pid, window.bounds == target.bounds.cg, window.layer == 0,
                  window.onScreen, window.alpha == 1, item[kCGWindowName] as? String == target.title else { throw NativeFailure("target-changed", "窗口移动、缩放或身份变化") }
            seenTarget = true; continue
        }
        if requireFrontmost, !seenTarget, window.onScreen, window.bounds.intersects(target.bounds.cg) {
            throw NativeFailure("occluded", "目标被其他窗口覆盖；保守拒绝，包括透明或未知覆盖")
        }
    }
    guard seenTarget else { throw NativeFailure("target-gone", "目标窗口已不在屏幕上") }
    guard mappingCount == 1 else { throw NativeFailure("ambiguous-window", "CG窗口到AX窗口的反向映射不唯一") }
}
func validateDesktop(_ target: Target, requireFrontmost: Bool) throws {
    guard try processIdentity(target.pid) == target.processIdentity, allowedApplication(target.pid, bundle: target.bundleId) else { throw NativeFailure("target-changed", "目标进程身份已变化") }
    guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [NSDictionary] else { throw NativeFailure("window-metadata", "无法有界验证窗口列表") }
    try validateWindowStack(raw, target: target, requireFrontmost: requireFrontmost)
    if requireFrontmost {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid else { throw NativeFailure("not-frontmost", "目标必须已由用户置于前台；不会自动提窗") }
        guard !IsSecureEventInputEnabled() else { throw NativeFailure("secure-input", "系统安全输入已开启") }
        // 有修饰键或物理按键按住时不注入，避免继承快捷键/拖拽状态。
        guard CGEventSource.flagsState(.combinedSessionState).intersection([.maskShift, .maskControl, .maskAlternate, .maskCommand, .maskAlphaShift]).isEmpty,
              !(0..<128).contains(where: { CGEventSource.keyState(.combinedSessionState, key: CGKeyCode($0)) }),
              !CGEventSource.buttonState(.combinedSessionState, button: .left),
              !CGEventSource.buttonState(.combinedSessionState, button: .right),
              !CGEventSource.buttonState(.combinedSessionState, button: .center) else { throw NativeFailure("input-held", "存在按住的键或鼠标按钮") }
    }
}

func captureDisplay(targetWidth: Int = 1280, completion: @escaping (Result<(Data, DisplayResult, Int, Int), Error>) -> Void) {
    if #available(macOS 14.2, *) {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            guard error == nil, let content, let display = content.displays.first else {
                completion(.failure(NativeFailure("capture-failed", "无法读取显示器内容")))
                return
            }
            let bounds = CGDisplayBounds(display.displayID)
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let scale = Double(targetWidth) / Double(display.width)
            let targetHeight = max(2, Int((Double(display.height) * scale).rounded()))

            let config = SCStreamConfiguration()
            config.width = targetWidth
            config.height = targetHeight
            config.showsCursor = false
            config.capturesAudio = false
            config.scalesToFit = true

            SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
                guard error == nil, let image else {
                    completion(.failure(NativeFailure("capture-failed", "屏幕截图捕获失败")))
                    return
                }
                let rep = NSBitmapImageRep(cgImage: image)
                guard let png = rep.representation(using: .png, properties: [:]), png.count <= 8 * 1024 * 1024 else {
                    completion(.failure(NativeFailure("capture-too-large", "截图数据过大")))
                    return
                }
                let displayResult = DisplayResult(
                    originX: bounds.origin.x,
                    originY: bounds.origin.y,
                    ptWidth: bounds.width,
                    ptHeight: bounds.height,
                    scaledWidth: image.width,
                    scaledHeight: image.height
                )
                completion(.success((png, displayResult, image.width, image.height)))
            }
        }
    } else {
        completion(.failure(NativeFailure("unsupported-os", "需要 macOS 14.2+")))
    }
}

let HELPER_EVENT_TAG: Int64 = 0x47414D41

func openApplication(named name: String) -> Bool {
    let ws = NSWorkspace.shared
    if name.contains(".") {
        if let url = ws.urlForApplication(withBundleIdentifier: name) {
            let conf = NSWorkspace.OpenConfiguration()
            conf.activates = true
            ws.openApplication(at: url, configuration: conf, completionHandler: nil)
            return true
        }
    }
    let map: [String: String] = [
        "notes": "com.apple.Notes",
        "备忘录": "com.apple.Notes",
        "safari": "com.apple.Safari",
        "finder": "com.apple.finder",
        "访达": "com.apple.finder",
        "mail": "com.apple.mail",
        "邮件": "com.apple.mail",
        "calendar": "com.apple.iCal",
        "日历": "com.apple.iCal",
        "calculator": "com.apple.calculator",
        "计算器": "com.apple.calculator",
        "messages": "com.apple.MobileSMS",
        "信息": "com.apple.MobileSMS",
        "terminal": "com.apple.Terminal",
        "终端": "com.apple.Terminal",
        "system settings": "com.apple.systempreferences",
        "系统设置": "com.apple.systempreferences"
    ]
    if let bundleId = map[name.lowercased()],
       let url = ws.urlForApplication(withBundleIdentifier: bundleId) {
        let conf = NSWorkspace.OpenConfiguration()
        conf.activates = true
        ws.openApplication(at: url, configuration: conf, completionHandler: nil)
        return true
    }
    for candidateDir in ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities"] {
        let appUrl = URL(fileURLWithPath: "\(candidateDir)/\(name).app")
        if FileManager.default.fileExists(atPath: appUrl.path) {
            let conf = NSWorkspace.OpenConfiguration()
            conf.activates = true
            ws.openApplication(at: appUrl, configuration: conf, completionHandler: nil)
            return true
        }
    }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    proc.arguments = ["-a", name]
    do {
        try proc.run()
        proc.waitUntilExit()
        return proc.terminationStatus == 0
    } catch {
        return false
    }
}

final class EventDispatcher {
    private let lock = NSLock()
    private var release: CGEvent?
    func post(_ action: Action, snapshot: Snapshot, validate: () throws -> Void, commit: (() -> Void) throws -> Void) throws {
        let source = CGEventSource(stateID: .privateState)
        source?.localEventsSuppressionInterval = 0
        let down: CGEvent, up: CGEvent?
        switch action.kind {
        case "click", "double_click", "triple_click", "right_click", "middle_click", "mouse_move":
            let point = try snapshot.point(x: action.x!, y: action.y!)
            if action.kind == "mouse_move" {
                guard let m = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else { throw NativeFailure("event-create", "无法构造移动") }
                m.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                down = m; up = nil
            } else {
                let isRight = action.kind == "right_click"
                let isMiddle = action.kind == "middle_click"
                let mouseButton: CGMouseButton = isRight ? .right : isMiddle ? .center : .left
                let downType: CGEventType = isRight ? .rightMouseDown : isMiddle ? .otherMouseDown : .leftMouseDown
                let upType: CGEventType = isRight ? .rightMouseUp : isMiddle ? .otherMouseUp : .leftMouseUp
                guard let d = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: mouseButton),
                      let u = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: mouseButton) else { throw NativeFailure("event-create", "无法构造点击") }
                let clicks: Int64 = action.kind == "double_click" ? 2 : action.kind == "triple_click" ? 3 : 1
                d.setIntegerValueField(.mouseEventClickState, value: clicks)
                u.setIntegerValueField(.mouseEventClickState, value: clicks)
                d.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                u.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                down = d; up = u
            }
        case "drag", "left_click_drag":
            let start = try snapshot.point(x: action.startX ?? action.x!, y: action.startY ?? action.y!)
            let end = try snapshot.point(x: action.x!, y: action.y!)
            guard let d = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left),
                  let u = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left) else { throw NativeFailure("event-create", "无法构造拖拽") }
            d.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
            u.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
            down = d; up = u
        case "type":
            let text = action.text ?? ""
            let hasNonAscii = text.unicodeScalars.contains { $0.value > 127 }
            if hasNonAscii {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                let vCode: CGKeyCode = 9 // 'v'
                guard let d = CGEvent(keyboardEventSource: source, virtualKey: vCode, keyDown: true),
                      let u = CGEvent(keyboardEventSource: source, virtualKey: vCode, keyDown: false) else { throw NativeFailure("event-create", "无法构造粘贴事件") }
                d.flags = .maskCommand
                u.flags = .maskCommand
                d.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                u.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                down = d; up = u
            } else {
                guard let d = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                      let u = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { throw NativeFailure("event-create", "无法构造按键") }
                let units = Array(text.utf16)
                guard !units.isEmpty else { throw NativeFailure("invalid-action", "输入不能为空") }
                units.withUnsafeBufferPointer { buffer in
                    d.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress!)
                    u.keyboardSetUnicodeString(stringLength: units.count, unicodeString: buffer.baseAddress!)
                }
                d.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                u.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
                down = d; up = u
            }
        case "key":
            let (code, flags) = try parseKeyCombination(action.key ?? "")
            guard let d = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
                  let u = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { throw NativeFailure("event-create", "无法构造按键") }
            d.flags = flags
            u.flags = flags
            d.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
            u.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
            down = d; up = u
        case "scroll":
            let point = try snapshot.point(x: action.x!, y: action.y!)
            guard let d = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: -Int32(action.deltaY!.rounded()), wheel2: 0, wheel3: 0) else { throw NativeFailure("event-create", "无法构造滚动") }
            d.location = point
            d.setIntegerValueField(.eventSourceUserData, value: HELPER_EVENT_TAG)
            down = d; up = nil
        case "open_app":
            guard let name = action.appName, openApplication(named: name) else { throw NativeFailure("app-open-failed", "打开应用失败") }
            return
        case "wait":
            return
        default: throw NativeFailure("unsupported-action", "不支持的动作：\(action.kind)")
        }
        try validate()
        lock.lock(); defer { lock.unlock() }
        try commit {
            release = up
            down.post(tap: .cgSessionEventTap)
            up?.post(tap: .cgSessionEventTap)
            release = nil
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
        if event.getIntegerValueField(.eventSourceUserData) == HELPER_EVENT_TAG {
            return
        }
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            gate.setListenerHealthy(false); onStop("安全监听已失活")
            return
        }
        guard gate.monitorsInput else { return }
        if type == .keyDown, event.getIntegerValueField(.keyboardEventKeycode) == 53,
           event.flags.contains([.maskControl, .maskAlternate]) { onStop("紧急停止快捷键"); return }
        onStop("检测到用户操作，桌面控制已暂停")
    }
    func start() throws {
        mutex.lock(); let already = started; mutex.unlock()
        guard !already else {
            guard let tap, CGEvent.tapIsEnabled(tap: tap) else { throw NativeFailure("listen-disabled", "监听失活；需重启helper") }
            gate.setListenerHealthy(true); return
        }
        let semaphore = DispatchSemaphore(value: 0)
        let thread = Thread { [self] in
            let events: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
            let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
            let callback: CGEventTapCallBack = { _, type, event, context in
                if let context { Unmanaged<SafetyMonitor>.fromOpaque(context).takeUnretainedValue().received(type, event) }
                return Unmanaged.passUnretained(event)
            }
            tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque())
            guard let tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { semaphore.signal(); return }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            mutex.lock(); started = true; mutex.unlock()
            gate.setListenerHealthy(CGEvent.tapIsEnabled(tap: tap)); semaphore.signal()
            let timer = Timer(timeInterval: 0.1, repeats: true) { [self] _ in
                guard gate.isActive else { return }
                mutex.lock(); let staleUI = ProcessInfo.processInfo.systemUptime - uiHeartbeat > 2; mutex.unlock()
                if getppid() != parentPID { onStop("父进程已退出"); _exit(0) }
                else if gate.expired { onStop("授权已过期") }
                else if !CGEvent.tapIsEnabled(tap: tap) { gate.setListenerHealthy(false); onStop("安全监听失活") }
                else if staleUI { onStop("本地停止UI无响应") }
                else if IsSecureEventInputEnabled() { onStop("系统安全输入已开启") }
            }
            RunLoop.current.add(timer, forMode: .common)
            CFRunLoopRun()
        }
        thread.name = "Gamma Computer Use 安全监听"; thread.start()
        guard semaphore.wait(timeout: .now() + 2) == .success else { throw NativeFailure("listen-timeout", "安全监听启动超时") }
        mutex.lock(); let success = started; mutex.unlock()
        guard success else { throw NativeFailure("listen-denied", "无法建立独立安全监听") }
    }
}
