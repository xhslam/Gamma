import AppKit
import ScreenCaptureKit
import ApplicationServices
import Carbon

private final class WindowWatchContext {
    let gate: SafetyGate
    let token: UInt64
    let stopped: (String) -> Void
    init(gate: SafetyGate, token: UInt64, stopped: @escaping (String) -> Void) {
        self.gate = gate; self.token = token; self.stopped = stopped
    }
}
final class WindowWatcher {
    private var observer: AXObserver?
    private let context: WindowWatchContext
    init(root: AXUIElement, target: Target, gate: SafetyGate, token: UInt64, stopped: @escaping (String) -> Void) throws {
        context = WindowWatchContext(gate: gate, token: token, stopped: stopped)
        let callback: AXObserverCallback = { _, _, _, rawContext in
            guard let rawContext else { return }
            let context = Unmanaged<WindowWatchContext>.fromOpaque(rawContext).takeUnretainedValue()
            guard (try? context.gate.check(context.token)) != nil else { return }
            context.stopped("所选窗口或AX布局发生变化")
        }
        var observer: AXObserver?
        guard AXObserverCreate(target.pid, callback, &observer) == .success, let observer else { throw NativeFailure("ax-monitor", "无法监听目标窗口变化") }
        self.observer = observer
        AXUIElementSetMessagingTimeout(root, 0.08)
        for notification in [kAXWindowMovedNotification, kAXWindowResizedNotification, kAXUIElementDestroyedNotification] {
            guard AXObserverAddNotification(observer, root, notification as CFString, Unmanaged.passUnretained(context).toOpaque()) == .success else { throw NativeFailure("ax-monitor", "目标不支持必要的窗口失效通知") }
        }
        for notification in [kAXValueChangedNotification, kAXTitleChangedNotification, "AXLayoutChanged", "AXChildrenChanged"] {
            _ = AXObserverAddNotification(observer, root, notification as CFString, Unmanaged.passUnretained(context).toOpaque())
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
    }
    deinit {
        // 回调只在main RunLoop执行；保留context直到同一队列移除source，避免worker释放与回调竞争。
        if let observer {
            let context = self.context
            DispatchQueue.main.async {
                CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
                withExtendedLifetime(context) {}
            }
        }
    }
}

final class Engine {
    let gate = SafetyGate()
    let writer = ProtocolWriter()
    let ui = NativeUI()
    let owner = OwnerLock()
    let dispatcher = EventDispatcher()
    let worker = DispatchQueue(label: "com.gamma.computer-use.ax-worker", qos: .userInitiated)
    private let ax = AccessibilityWorker()
    private lazy var monitor = SafetyMonitor(gate: gate) { [weak self] reason in self?.stop(reason) }
    // 仅worker读写以下两项；stop不等待它们释放。
    private var tree: AXTree?
    private var watcher: WindowWatcher?
    private let mutex = NSLock()
    private var workCount = 0
    private var outstanding = Set<String>()
    private var mainTimer: Timer?
    func start() {
        ui.onStop = { [weak self] reason in self?.stop(reason) }
        writer.onBrokenPipe = { [weak self] in self?.stop("stdio断开或背压超过上限"); _exit(0) }
        mainTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self else { return }; self.monitor.heartbeat()
            if self.gate.expired { self.stop("授权已过期") }
            else if self.gate.monitorsInput && !self.ui.hasVisibleStop { self.stop("独立原生停止按钮不可见") }
        }
    }
    @discardableResult func stop(_ reason: String) -> Bool {
        // 不访问AXworker、不等待Pi、不等待主RunLoop；先撤权再异步关闭UI。
        let active = gate.stop(); dispatcher.releaseAll()
        mutex.lock(); if workCount == 0 { owner.release() }; mutex.unlock()
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.gate.isActive else { return }
            self.ui.cancelAll(); self.ui.hideStop()
        }
        worker.async { [weak self] in
            guard let self, !self.gate.isActive else { return }
            self.watcher = nil; self.tree = nil
        }
        if active { writer.emit(StoppedEvent(reason: String(reason.prefix(200)))) }
        return active
    }
    private func startWork(_ token: UInt64) throws {
        try gate.startWork(token)
        mutex.lock(); workCount += 1; mutex.unlock()
    }
    private func endWork() {
        gate.endWork()
        mutex.lock(); workCount -= 1; if !gate.isActive && workCount == 0 { owner.release() }; mutex.unlock()
    }
    private func done(_ id: String) { mutex.lock(); outstanding.remove(id); mutex.unlock() }
    private func failure(_ id: String, _ error: Error) { writer.failure(id, error); done(id) }
    private func success<T: Encodable>(_ id: String, _ value: T) { writer.success(id, value); done(id) }
    private func status() -> Status {
        let permissions = Permissions(accessibility: AXIsProcessTrusted(), screen: CGPreflightScreenCaptureAccess(), listen: CGPreflightListenEventAccess(), post: CGPreflightPostEventAccess())
        let supported: Bool
        if #available(macOS 14.2, *) { supported = true } else { supported = false }
        return Status(supported: supported, permissions: permissions, message: "单窗口原生控制；每个写动作需本地Touch ID，无法认证时拒绝。所有CG输入（包括自身）锁存停止，下一次需重新选择。macOS14.0/14.1不提供可验证的子窗口排除，因此拒绝捕获。")
    }
    func handle(_ data: Data) {
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: data)
            guard !envelope.id.isEmpty, envelope.id.utf8.count <= 128, envelope.method.utf8.count <= 64 else { throw NativeFailure("invalid-request", "请求标识或方法无效") }
        } catch { writer.failure("", NativeFailure("invalid-request", "请求必须为有界JSON对象，包含id、method和params对象")); return }
        // stop永远绕过队列/重复ID限制；AX挂起或16个请求占满也不能阻止撤权。
        if envelope.method == "stop" {
            do {
                _ = try JSONDecoder().decode(Request<StopParams>.self, from: data)
                stop("父进程请求停止"); writer.success(envelope.id, StoppedResult())
            } catch { writer.failure(envelope.id, NativeFailure("invalid-request", "停止参数无效")) }
            return
        }
        mutex.lock()
        let accepted = !outstanding.contains(envelope.id) && outstanding.count < 16
        if accepted { outstanding.insert(envelope.id) }; mutex.unlock()
        guard accepted else { writer.failure(envelope.id, NativeFailure("busy", "重复请求ID或请求队列已满")); return }
        do {
            switch envelope.method {
            case "status": success(envelope.id, status())
            case "requestPermission":
                let p = try JSONDecoder().decode(Request<PermissionParams>.self, from: data).params
                guard ["accessibility", "screen", "listen", "post"].contains(p.permission) else { throw NativeFailure("invalid-permission", "未知权限") }
                guard !gate.isActive else { throw NativeFailure("busy", "请先停止控制再更改权限") }
                DispatchQueue.main.async { [self] in
                    guard !gate.isActive else { failure(envelope.id, NativeFailure("busy", "控制已开始，拒绝迟到的权限申请")); return }
                    switch p.permission {
                    case "accessibility": _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
                    case "screen": _ = CGRequestScreenCaptureAccess()
                    case "listen": _ = CGRequestListenEventAccess()
                    case "post": _ = CGRequestPostEventAccess()
                    default: break
                    }
                    success(envelope.id, status())
                }
            case "select":
                let p = try JSONDecoder().decode(Request<LeaseParams>.self, from: data).params
                try select(envelope.id, p)
            case "observe", "screenshot":
                let p = try JSONDecoder().decode(Request<BoundParams>.self, from: data).params
                let (target, token) = try gate.current(p)
                try startWork(token)
                observe(envelope.id, p: p, target: target, token: token)
            case "openApp":
                let p = try JSONDecoder().decode(Request<OpenAppParams>.self, from: data).params
                let ok = openApplication(named: p.appName)
                success(envelope.id, OpenAppResult(success: ok, appName: p.appName))
            case "perform":
                let p = try JSONDecoder().decode(Request<PerformParams>.self, from: data).params
                do {
                    let (target, token) = try gate.current(BoundParams(leaseId: p.leaseId, epoch: p.epoch))
                    try startWork(token)
                    do { let s = try gate.prepare(p); perform(envelope.id, p: p, target: target, snapshot: s) }
                    catch { endWork(); throw error }
                } catch { reject(envelope.id, p: p, error: error) }
            default: throw NativeFailure("unknown-method", "不支持的方法")
            }
        } catch { failure(envelope.id, error) }
    }
    private func select(_ id: String, _ p: LeaseParams) throws {
        let current = status()
        guard current.supported else { throw NativeFailure("unsupported-os", "需要macOS14.2+") }
        let token = try gate.begin(p)
        do { try owner.acquire(); try startWork(token) }
        catch { stop("无法取得独占桌面控制权"); throw error }
        worker.async { [self] in
            defer { endWork() }
            do {
                try gate.check(token)
                try monitor.start()
                DispatchQueue.main.sync { [self] in
                    self.ui.showStop(avoiding: CGRect.zero)
                }
                try gate.finishSelection(nil, token: token)
                try gate.check(token)
                let dummy = Target(windowId: 0, pid: 0, processIdentity: "desktop", bundleId: "com.apple.dock", title: "Desktop", bounds: Rect(CGRect(x: 0, y: 0, width: 1440, height: 900)))
                success(id, Selected(target: dummy))
            } catch { stop("桌面初始化失败"); failure(id, error) }
        }
    }
    private func observe(_ id: String, p: BoundParams, target: Target?, token: UInt64) {
        worker.async { [self] in
            do {
                try gate.check(token)
                captureDisplay(targetWidth: 1280) { [self] result in
                    worker.async { [self] in
                        defer { endWork() }
                        do {
                            try gate.check(token)
                            let (png, display, width, height) = try result.get()
                            let observationId = UUID().uuidString
                            let snapshot = Snapshot(id: observationId, epoch: p.epoch, fence: token, created: ProcessInfo.processInfo.systemUptime, target: target, width: width, height: height, axDigest: "", display: display)
                            try gate.save(snapshot)
                            try gate.check(token)
                            success(id, ObservationResult(observationId: observationId, epoch: p.epoch, image: ImageResult(data: png.base64EncodedString(), width: width, height: height), display: display, ax: ""))
                        } catch { stop("观察捕获失败"); failure(id, error) }
                    }
                }
            } catch { endWork(); stop("观察检查失败"); failure(id, error) }
        }
    }
    private func perform(_ id: String, p: PerformParams, target: Target?, snapshot: Snapshot) {
        worker.async { [self] in
            defer { endWork() }
            do {
                try gate.check(snapshot.fence)
                let action = p.action
                if let x = action.x, let y = action.y { _ = try snapshot.point(x: x, y: y) }
                let permit = try gate.approve(p, snapshot: snapshot)
                if action.kind == "open_app" {
                    guard let app = action.appName, openApplication(named: app) else {
                        throw NativeFailure("app-failed", "打开应用失败")
                    }
                } else if action.kind == "wait" {
                    // wait is a no-op at event dispatch level
                } else {
                    guard CGPreflightPostEventAccess() else { throw NativeFailure("permission-required", "发布事件权限已撤销") }
                    try dispatcher.post(action, snapshot: snapshot, validate: {
                        try self.gate.check(snapshot.fence)
                    }, commit: { [self] dispatch in
                        try self.gate.commitDispatch(permit, dispatch)
                    })
                }
                success(id, Receipt(actionId: p.actionId, outcome: "dispatched-unverified", message: "动作已执行"))
            } catch {
                reject(id, p: p, error: error)
            }
        }
    }
    private func reject(_ id: String, p: PerformParams, error: Error) {
        let message = (error as? NativeFailure)?.message ?? "原生安全门拒绝动作"
        success(id, Receipt(actionId: p.actionId, outcome: "rejected", message: message))
    }
}
