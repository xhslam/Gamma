import AppKit
import ApplicationServices
import Carbon

final class Engine {
    let gate = SafetyGate()
    let writer = ProtocolWriter()
    let ui = NativeUI()
    let owner = OwnerLock()
    let dispatcher = EventDispatcher()
    private let preview = DesktopPreview()
    let worker = DispatchQueue(label: "com.gamma.computer-use.worker", qos: .userInitiated)
    private let ax = AccessibilityWorker()
    private let readWindows: () throws -> [Target]
    private let prepareAction: (PerformParams, Snapshot, AccessibilityWorker) throws -> PreparedAction
    init(readWindows: @escaping () throws -> [Target] = desktopWindows,
         prepareAction: @escaping (PerformParams, Snapshot, AccessibilityWorker) throws -> PreparedAction = { try bindAction($0, snapshot: $1, ax: $2) }) {
        self.readWindows = readWindows; self.prepareAction = prepareAction
    }
    private lazy var monitor = SafetyMonitor(gate: gate) { [weak self] reason in self?.stop(reason) }
    // 只在串行worker读写，stop通过fence立即使其失效，不等待AX返回。
    private var prepared: PreparedAction?
    private let mutex = NSLock()
    private var workCount = 0
    private var outstanding = Set<String>()
    private var mainTimer: Timer?
    private var isExecutingAction: Bool {
        mutex.lock(); defer { mutex.unlock() }
        return workCount > 0
    }
    func start() {
        ui.onStop = { [weak self] reason in self?.stop(reason) }
        writer.onBrokenPipe = { [weak self] in self?.stop("stdio断开或背压超限"); _exit(0) }
        mainTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self else { return }; self.monitor.heartbeat()
            if self.gate.expired { self.stop("授权已过期") }
            else if self.isExecutingAction && !self.ui.hasVisibleStop { self.stop("独立原生停止按钮不可见") }
        }
    }
    @discardableResult func stop(_ reason: String) -> Bool {
        let active = gate.stop(); preview.stop(); dispatcher.releaseAll()
        mutex.lock(); if workCount == 0 { owner.release() }; mutex.unlock()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard !self.gate.isActive else { return }
            self.ui.cancelAll()
        }
        worker.async { [weak self] in if self?.gate.isActive == false { self?.prepared = nil } }
        if active { writer.emit(StoppedEvent(reason: String(reason.prefix(200)))) }
        return active
    }
    private func startWork(_ token: UInt64) throws {
        // 先在主线程建立独立停止入口，再令 watchdog 将本次工作视为活动。
        try gate.startWork(token)
        let begin = { [self] in
            ui.setStatus("正在准备桌面操作")
            mutex.lock(); workCount += 1; mutex.unlock()
        }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
    }
    private func hideStopIfIdle() {
        DispatchQueue.main.async { [self] in
            if shouldHideStopPanel(leaseActive: gate.isActive, workActive: isExecutingAction, confirming: gate.isConfirming) {
                ui.hideStop()
            } else if gate.isActive && !isExecutingAction && !gate.isConfirming {
                ui.setStatus("等待下一步 · 人工输入将暂停")
            }
        }
    }
    private func endWork() { gate.endWork(); mutex.lock(); workCount -= 1; if !gate.isActive && workCount == 0 { owner.release() }; mutex.unlock(); hideStopIfIdle() }
    private func done(_ id: String) { mutex.lock(); outstanding.remove(id); mutex.unlock() }
    private func failure(_ id: String, _ error: Error) { writer.failure(id, error); done(id) }
    private func success<T: Encodable>(_ id: String, _ value: T) { writer.success(id, value); done(id) }
    private func state(_ text: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.gate.isActive else { return }
            self.ui.setStatus(text)
        }
    }
    private func status() -> Status {
        let permissions = Permissions(accessibility: AXIsProcessTrusted(), screen: CGPreflightScreenCaptureAccess(), listen: CGPreflightListenEventAccess(), post: CGPreflightPostEventAccess())
        let supported: Bool
        if #available(macOS 14.0, *) { supported = true } else { supported = false }
        return Status(supported: supported, permissions: permissions, message: "基础桌面操作只需要系统辅助功能授权；屏幕录制可选，未开启时使用AX文字与控件。开启后可提供主屏截图和实时预览，图像可能发送给当前模型；排除Gamma窗口、不捕获音频。保留原生停止与人工接管。")
    }
    func handle(_ data: Data) {
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: data)
            guard !envelope.id.isEmpty, envelope.id.utf8.count <= 128, envelope.method.utf8.count <= 64 else { throw NativeFailure("invalid-request", "请求标识无效") }
        } catch { writer.failure("", NativeFailure("invalid-request", "请求必须包含有界id、method与params对象")); return }
        if envelope.method == "stop" {
            stop("父进程请求停止"); writer.success(envelope.id, StoppedResult()); return
        }
        mutex.lock(); let accepted = !outstanding.contains(envelope.id) && outstanding.count < 16
        if accepted { outstanding.insert(envelope.id) }; mutex.unlock()
        guard accepted else { writer.failure(envelope.id, NativeFailure("busy", "重复请求或队列已满")); return }
        do {
            switch envelope.method {
            case "status": success(envelope.id, status())
            case "requestPermission":
                let p = try JSONDecoder().decode(Request<PermissionParams>.self, from: data).params
                guard ["accessibility", "screen"].contains(p.permission), !gate.isActive || p.permission == "screen" else { throw NativeFailure("busy", "只需辅助功能；屏幕录制可在运行中按需开启") }
                DispatchQueue.main.async { [self] in
                    guard !gate.isActive || p.permission == "screen" else { failure(envelope.id, NativeFailure("busy", "控制已经开始")); return }
                    if p.permission == "screen" {
                        do { try gate.setScreenPermissionWaiting(true) }
                        catch { failure(envelope.id, error); return }
                        worker.async { [self] in prepared = nil }
                    }
                    defer { if p.permission == "screen" { _ = try? gate.setScreenPermissionWaiting(false) } }
                    switch p.permission {
                    case "accessibility": _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
                    case "screen": _ = CGRequestScreenCaptureAccess()
                    default: break
                    }
                    success(envelope.id, status())
                }
            case "listApps":
                DispatchQueue.main.async { [self] in success(envelope.id, listApplications()) }
            case "resolveApp":
                let p = try JSONDecoder().decode(Request<ResolveAppParams>.self, from: data).params
                worker.async { [self] in do { success(envelope.id, try resolveApplication(p.appName).1) } catch { failure(envelope.id, error) } }
            case "select": try select(envelope.id, JSONDecoder().decode(Request<LeaseParams>.self, from: data).params)
            case "previewFrame":
                let p = try JSONDecoder().decode(Request<PreviewParams>.self, from: data).params
                let (_, token) = try gate.current(BoundParams(leaseId: p.leaseId, epoch: p.epoch))
                success(envelope.id, try preview.read(p, token: token, gate: gate))
            case "observe", "screenshot":
                let p = try JSONDecoder().decode(Request<ObserveParams>.self, from: data).params
                let (_, token) = try gate.current(BoundParams(leaseId: p.leaseId, epoch: p.epoch)); try startWork(token); observe(envelope.id, p: p, token: token)
            case "listWindows":
                let p = try JSONDecoder().decode(Request<BoundParams>.self, from: data).params
                try withWork(envelope.id, p) { [self] token in
                    let windows = try readWindows(); try gate.checkDispatch(token)
                    success(envelope.id, WindowListResult(windows: windows))
                }
            case "prepare":
                let p = try JSONDecoder().decode(Request<PerformParams>.self, from: data).params
                try withWork(envelope.id, BoundParams(leaseId: p.leaseId, epoch: p.epoch)) { [self] token in
                    let snapshot = try gate.inspect(p)
                    do {
                        let binding = try prepareAction(p, snapshot, ax)
                        try gate.checkDispatch(token); try gate.bindPreparation(binding.id, request: p, token: token); prepared = binding
                        state("已准备 · \(binding.appName) · \(p.action.kind)")
                        success(envelope.id, PreparationResult(preparationId: binding.id, appName: binding.appName, bundleId: binding.bundleId, context: binding.context))
                    } catch {
                        if p.action.kind == "key" {
                            let actualFocus = try? ax.focusedElement()
                            writeNativeComputerUseLog(
                                location: "Engine.swift:case_prepare:key_failed",
                                action: "key",
                                rawError: (error as? NativeFailure)?.message ?? error.localizedDescription,
                                errorCode: (error as? NativeFailure)?.code ?? "prepare-failed",
                                focusedElement: describeAXElementInfo(actualFocus)
                            )
                        }
                        throw error
                    }
                }
            case "confirmation":
                let p = try JSONDecoder().decode(Request<ConfirmationParams>.self, from: data).params
                try withWork(envelope.id, BoundParams(leaseId: p.leaseId, epoch: p.epoch)) { [self] token in try confirmation(envelope.id, p, token: token) }
            case "perform":
                let p = try JSONDecoder().decode(Request<PerformParams>.self, from: data).params
                do { try withWork(envelope.id, BoundParams(leaseId: p.leaseId, epoch: p.epoch)) { [self] _ in perform(envelope.id, p) } }
                catch { success(envelope.id, Receipt(actionId: p.actionId, outcome: "not-dispatched", message: "原生授权、监听或执行状态已失效，未投递本次动作", errorCode: (error as? NativeFailure)?.code ?? "native-failure", permission: (error as? NativeFailure)?.permission)) }
            default: throw NativeFailure("unknown-method", "不支持的原生方法")
            }
        } catch { failure(envelope.id, error) }
    }
    private func withWork(_ id: String, _ p: BoundParams, _ body: @escaping (UInt64) throws -> Void) throws {
        let (_, token) = try gate.current(p); try startWork(token)
        worker.async { [self] in
            defer { endWork() }
            do { try gate.check(token); try body(token) } catch { failure(id, error) }
        }
    }
    private func select(_ id: String, _ p: LeaseParams) throws {
        let current = status()
        guard current.supported else { throw NativeFailure("unsupported-os", "需要macOS14+") }
        let permissions = current.permissions
        guard hasRequiredComputerPermissions(permissions) else { throw NativeFailure("permission-required", "请在系统辅助功能中允许Gamma控制电脑", permission: "accessibility") }
        let token = try gate.begin(p)
        do { try owner.acquire(); try startWork(token) } catch { stop("无法取得独占控制权"); throw error }
        worker.async { [self] in
            defer { endWork() }
            do {
                try gate.check(token); try monitor.start()
                try gate.finishSelection(nil, token: token); try gate.checkDispatch(token)
                success(id, Selected())
            } catch { stop("桌面初始化失败"); failure(id, error) }
        }
    }
    private func observe(_ id: String, p: ObserveParams, token: UInt64) {
        worker.async { [self] in
            do {
                try gate.checkDispatch(token); gate.invalidateObservation(); prepared = nil
                state("正在读取前台应用与控件")
                let before = try desktopDigest()
                let observedApp = try currentApplication()
                let observedWindow: Target?
                let observedTree: AXTree?
                let observedLayout: String
                if !isGammaPID(observedApp.pid), let window = try? ax.windowForFocused(observedApp.pid, windows: desktopWindows()), let tree = try? ax.read(window, allowSurfaces: true) {
                    observedWindow = window; observedLayout = tree.digest; observedTree = tree
                } else { observedWindow = nil; observedLayout = ""; observedTree = nil }
                let capture: (@escaping (Result<(Data, DisplayResult, Int, Int), Error>) -> Void) -> Void = { completion in
                    if p.includeImage != false && CGPreflightScreenCaptureAccess() { captureDisplay(completion: completion) }
                    else { completion(.failure(NativeFailure("visual-unavailable", "使用辅助功能观察"))) }
                }
                capture { [self] result in
                    worker.async { [self] in
                        defer {
                            endWork()
                            hideStopIfIdle()
                        }
                        do {
                            try gate.checkDispatch(token)
                            let display: DisplayResult, width: Int, height: Int, image: ImageResult?
                            if case .success(let (png, capturedDisplay, capturedWidth, capturedHeight)) = result {
                                display = capturedDisplay; width = capturedWidth; height = capturedHeight
                                image = ImageResult(data: png.base64EncodedString(), width: width, height: height)
                            } else {
                                display = try accessibilityDisplay(); width = display.scaledWidth; height = display.scaledHeight; image = nil
                            }
                            guard before == (try desktopDigest()) else { throw NativeFailure("desktop-changed", "观察期间窗口布局改变，请重新观察") }
                            let app = try currentApplication()
                            guard app == observedApp else { throw NativeFailure("focus-changed", "观察期间前台应用改变") }
                            if let window = observedWindow {
                                guard try ax.read(window, allowSurfaces: true).digest == observedLayout else { throw NativeFailure("observation-layout-changed", "观察期间目标布局改变") }
                            }
                            let snapshot = Snapshot(id: UUID().uuidString, epoch: p.epoch, fence: token, created: ProcessInfo.processInfo.systemUptime, target: observedWindow, width: width, height: height, axDigest: observedLayout, display: display, desktopDigest: before, axRefs: observedTree?.refs ?? [:], axRoot: observedTree?.root, hasImage: image != nil)
                            try gate.save(snapshot); try gate.checkDispatch(token)
                            success(id, ObservationResult(observationId: snapshot.id, epoch: p.epoch, image: image, width: width, height: height, display: display, ax: observedTree?.text ?? "[当前前台窗口没有可安全读取的AX树；不可使用AX引用]", targetApp: app))
                        } catch { gate.invalidateObservation(); failure(id, error) }
                    }
                }
            } catch {
                endWork()
                hideStopIfIdle()
                failure(id, error)
            }
        }
    }
    private func confirmation(_ id: String, _ p: ConfirmationParams, token: UInt64) throws {
        guard let binding = prepared, binding.id == p.preparationId else { throw NativeFailure("preparation-required", "动作准备已失效") }
        if p.waiting {
            try verifyBinding(binding, ax: ax)
            try gate.setConfirmation(binding.id, waiting: true, token: token)
            state("等待确认 · \(binding.appName) · 仅允许Gamma界面交互")
        } else {
            guard gate.isConfirming else { throw NativeFailure("revoked", "没有等待中的确认") }
            do {
                if let original = binding.returnApp {
                    guard try processIdentity(original.pid) == original.processIdentity else { throw NativeFailure("target-changed", "授权前应用已退出") }
                    let front = try currentApplication()
                    var activationAccepted: Bool?
                    if front.pid != original.pid {
                        guard isGammaPID(front.pid) else { throw NativeFailure("focus-changed", "用户已切换到其他应用，不自动恢复") }
                        try gate.check(token)
                        DispatchQueue.main.sync {
                            if (try? self.gate.check(token)) != nil { activationAccepted = NSRunningApplication(processIdentifier: original.pid)?.activate(options: []) }
                        }
                    }
                    var lastFront = front
                    do {
                        try waitForDesktopReadiness(checkFence: { try self.gate.check(token) }, checkDesktop: {
                            lastFront = try currentApplication()
                            guard lastFront == original else { throw NativeFailure("not-frontmost", "等待原应用焦点恢复") }
                        })
                    } catch {
                        writeNativeComputerUseLog(location: "Engine.swift:confirmation:restore", action: binding.request.action.kind,
                            rawError: "确认后原应用焦点恢复失败，动作未投递", errorCode: (error as? NativeFailure)?.code ?? "native-failure",
                            targetApp: ["pid": original.pid, "bundleId": original.bundleId, "activationRequested": activationAccepted != nil, "activationAccepted": activationAccepted ?? false],
                            frontmostApp: ["pid": lastFront.pid, "bundleId": lastFront.bundleId])
                        throw error
                    }
                }
                try verifyBinding(binding, ax: ax)
                try gate.setConfirmation(binding.id, waiting: false, token: token)
                state("确认完成 · \(binding.appName) · 执行前将再次核验")
            } catch {
                _ = try? gate.setConfirmation(binding.id, waiting: false, token: token)
                prepared = nil; gate.invalidateObservation(); state("确认后上下文改变或等待超时 · 请重新观察"); throw error
            }
        }
        success(id, ConfirmationResult(waiting: p.waiting))
    }
    private func perform(_ id: String, _ p: PerformParams) {
        let bindingSnapshot = prepared
        var dispatched = false
        defer {
            prepared = nil
            hideStopIfIdle()
        }
        do {
            guard let binding = prepared, binding.id == p.preparationId, samePreparedRequest(binding.request, p) else { throw NativeFailure("preparation-required", "必须使用同一动作、actionId和preparationId") }
            _ = try gate.inspect(p); try verifyBinding(binding, ax: ax)
            try validateInputEnvironment()
            let snapshot = try gate.prepare(p)
            let ticket = try gate.approve(p, snapshot: snapshot)
            let intentStr: String
            switch p.action.kind {
            case "click", "left_click": intentStr = "点击"
            case "double_click": intentStr = "双击"
            case "triple_click": intentStr = "三击"
            case "right_click": intentStr = "右键点击"
            case "middle_click": intentStr = "中键点击"
            case "mouse_move", "move": intentStr = "移动鼠标"
            case "paste": intentStr = "粘贴文本"
            case "type":
                let textSample = (p.action.text ?? "").prefix(12)
                intentStr = textSample.isEmpty ? "输入文本" : "输入“\(textSample)”"
            case "key":
                intentStr = p.action.key != nil ? "按下 \(p.action.key!)" : "按下按键"
            case "scroll": intentStr = "滚动"
            case "drag", "left_click_drag": intentStr = "拖拽"
            case "wait": intentStr = "等待"
            case "open_app": intentStr = "打开应用"
            case "focus_window": intentStr = "切换窗口"
            default: intentStr = p.action.kind
            }
            let targetName = binding.appName.isEmpty ? "系统" : binding.appName
            state("正在操作 \(targetName)：\(intentStr)")
            if p.action.kind == "open_app" {
                guard let url = binding.resolvedURL else { throw NativeFailure("invalid-application", "没有已绑定的应用路径") }
                dispatched = true // 已排队的异步系统写请求，失败时保守按未知处理。
                let completion = DispatchSemaphore(value: 0)
                let result = LaunchOutcome()
                DispatchQueue.main.async { [self] in
                    do {
                        try gate.claimAX(ticket); try gate.checkDispatch(snapshot.fence)
                        let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = true
                        result.markRequested()
                        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
                            result.finish(success: error == nil && app?.bundleIdentifier == binding.bundleId); completion.signal()
                        }
                    } catch { result.finish(success: false); completion.signal() }
                }
                let deadline = ProcessInfo.processInfo.systemUptime + 3
                while completion.wait(timeout: .now() + 0.04) != .success {
                    try gate.checkDispatch(snapshot.fence)
                    guard ProcessInfo.processInfo.systemUptime < deadline else { throw NativeFailure("launch-unknown", "应用启动结果未知，禁止自动重试") }
                }
                guard result.success else { throw NativeFailure("app-open-failed", "应用未能确认启动") }
            } else if p.action.kind == "focus_window" {
                guard let window = binding.window, let element = binding.element else { throw NativeFailure("target-gone", "目标窗口已失效") }
                try verifyBinding(binding, ax: ax)
                try gate.claimAX(ticket); try gate.checkDispatch(snapshot.fence); dispatched = true
                guard AXUIElementPerformAction(element, kAXRaiseAction as CFString) == .success else { throw NativeFailure("focus-unknown", "提窗结果无法确认") }
                try gate.checkDispatch(snapshot.fence)
                DispatchQueue.main.sync { [self] in if (try? self.gate.checkDispatch(snapshot.fence)) != nil { _ = NSRunningApplication(processIdentifier: window.pid)?.activate(options: []) } }
            } else if let scroll = binding.axScroll {
                guard p.action.kind == "scroll", let window = binding.window, let root = snapshot.axRoot else { throw NativeFailure("stale-element-ref", "滚动引用已失效") }
                let result = try ax.performScroll(scroll, target: window, root: root, beforeDispatch: { [self] in
                    try verifyBinding(binding, ax: ax)
                    try validateInputEnvironment(); try validateDisplay(snapshot.display)
                    try gate.claimAX(ticket); try gate.checkDispatch(snapshot.fence)
                    dispatched = true
                })
                guard result == .success else { throw NativeFailure(result == .cannotComplete ? "ax-timeout" : "ax-write-unknown", "AX滚动结果无法确认，已暂停且禁止重试") }
            } else if p.action.kind.hasPrefix("ax") || p.action.kind == "paste" {
                guard let element = binding.element, let window = binding.window, let root = snapshot.axRoot else { throw NativeFailure("stale-element-ref", "AX引用或根窗口已失效") }
                let result = try ax.performAX(p.action, element: element, target: window, root: root, expectedInsertion: binding.insertionState, beforeDispatch: { [self] in
                    try verifyBinding(binding, ax: ax)
                    try validateInputEnvironment(); try validateDisplay(snapshot.display)
                    try gate.claimAX(ticket); try gate.checkDispatch(snapshot.fence)
                    dispatched = true
                })
                guard result == .success else { throw NativeFailure(result == .cannotComplete ? "ax-timeout" : "ax-write-unknown", "AX写操作结果无法确认，已暂停且禁止重试") }
            } else if p.action.kind == "wait" {
                // 仅消费动作；有界且可取消的等待由父TS负责，wait同样检查bundle约束。
                try verifyBinding(binding, ax: ax)
                try gate.claimAX(ticket); try gate.checkDispatch(snapshot.fence)
            } else {
                var first = true
                try dispatcher.post(p.action, snapshot: snapshot, expectedPID: binding.app?.pid, scrollPoint: binding.scrollPoint, validate: { [self] in
                    if first { try verifyBinding(binding, ax: ax) }
                    try gate.checkDispatch(snapshot.fence); try validateDisplay(snapshot.display)
                    guard !IsSecureEventInputEnabled(), AXIsProcessTrusted() else { throw NativeFailure("secure-input", "辅助功能权限撤销或系统安全输入已开启") }
                    if let app = binding.app {
                        guard try processIdentity(app.pid) == app.processIdentity else { throw NativeFailure("target-changed", "目标进程已变化") }
                        if ["type", "key"].contains(p.action.kind) {
                            let frontApp = NSWorkspace.shared.frontmostApplication
                            let actualFocus = try? ax.focusedElement()
                            let focusMatches = (binding.window == nil && frontApp?.processIdentifier == app.pid) || (binding.element != nil && actualFocus != nil && CFEqual(actualFocus!, binding.element!))
                            guard frontApp?.processIdentifier == app.pid, focusMatches else {
                                writeNativeComputerUseLog(
                                    location: "Engine.swift:perform:validate_focus",
                                    action: p.action.kind,
                                    rawError: "输入期间焦点控件已改变",
                                    errorCode: "focus-changed",
                                    targetApp: ["pid": app.pid, "name": binding.appName, "bundleId": binding.bundleId],
                                    frontmostApp: frontApp != nil ? ["pid": frontApp!.processIdentifier, "name": frontApp!.localizedName as Any, "bundleId": frontApp!.bundleIdentifier as Any] : nil,
                                    focusedElement: describeAXElementInfo(actualFocus)
                                )
                                throw NativeFailure("focus-changed", "输入期间焦点控件已改变")
                            }
                        }
                    }
                }, commit: { [self] dispatch in
                    if first { try gate.commitDispatch(ticket, dispatch); first = false }
                    else { try gate.continueDispatch(snapshot.fence, dispatch) }
                    dispatched = true
                })
            }
            if p.action.kind != "wait" && p.action.kind != "open_app" {
                // 只读CG窗口元数据收敛，不重建AX refs，也不重发动作。
                var previous = ""
                do {
                    try waitForDesktopReadiness(checkFence: { [self] in try gate.checkDispatch(snapshot.fence) }, checkDesktop: {
                        let signature = try desktopDigest() + currentApplication().processIdentity
                        defer { previous = signature }
                        guard signature == previous else { throw NativeFailure("not-frontmost", "动作后的桌面仍在收敛") }
                    })
                } catch let failure as NativeFailure where failure.code == "desktop-not-ready" {
                    throw NativeFailure("post-action-not-settled", "动作已投递，但800ms内桌面未稳定；已暂停，禁止重试")
                }
            }
            success(id, Receipt(actionId: p.actionId, outcome: "dispatched-unverified", message: "已投递，请用新的观察验证结果；不要自动重试"))
        } catch {
            gate.invalidateObservation()
            let detail = (error as? NativeFailure)?.message ?? "原生安全检查拒绝动作"
            let errCode = (error as? NativeFailure)?.code ?? "native-failure"
            if p.action.kind == "key" {
                let actualFocus = try? ax.focusedElement()
                writeNativeComputerUseLog(
                    location: "Engine.swift:perform:key_failed",
                    action: "key",
                    rawError: detail,
                    errorCode: errCode,
                    targetApp: bindingSnapshot != nil ? ["name": bindingSnapshot!.appName, "bundleId": bindingSnapshot!.bundleId] : nil,
                    focusedElement: describeAXElementInfo(actualFocus)
                )
            }
            success(id, Receipt(actionId: p.actionId, outcome: dispatched ? "unknown" : "not-dispatched", message: detail, errorCode: errCode, permission: (error as? NativeFailure)?.permission))
            if dispatched { stop("动作可能部分执行，已暂停，禁止自动重试") }
        }
    }
}

/// NSWorkspace完成回调可能跨队列，结果只经短锁传递。
private final class LaunchOutcome {
    private let lock = NSLock()
    private var didRequest = false
    private var didSucceed = false
    var requested: Bool { lock.lock(); defer { lock.unlock() }; return didRequest }
    var success: Bool { lock.lock(); defer { lock.unlock() }; return didSucceed }
    func markRequested() { lock.lock(); didRequest = true; lock.unlock() }
    func finish(success: Bool) { lock.lock(); didSucceed = success; lock.unlock() }
}
