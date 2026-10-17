import AppKit
import ScreenCaptureKit
import LocalAuthentication

final class NativeUI: NSObject, NSWindowDelegate, SCContentSharingPickerObserver {
    var onStop: (String) -> Void = { _ in }
    private var stopPanel: NSPanel?
    private var panel: NSPanel?
    private var choose: ((Result<SCWindow, Error>) -> Void)?
    private var chosenWindows: [SCWindow] = []
    private var menu: NSPopUpButton?
    private var approve: ((Bool) -> Void)?
    private var auth: LAContext?
    private var approvalTimer: Timer?
    private var pickerRegistered = false
    var hasVisibleStop: Bool { stopPanel?.isVisible == true }
    func showStop(avoiding target: CGRect) {
        if stopPanel == nil {
            let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 280, height: 64), styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
            p.title = "Gamma 原生桌面控制"; p.level = .statusBar
            p.isFloatingPanel = true; p.hidesOnDeactivate = false
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let button = NSButton(title: "立即停止（⌃⌥Esc）", target: self, action: #selector(stopClicked))
            button.frame = NSRect(x: 12, y: 12, width: 256, height: 34)
            p.contentView?.addSubview(button)
            if let screen = NSScreen.main { p.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.minX + 10, y: screen.visibleFrame.maxY - 10)) }
            stopPanel = p
        }
        if let p = stopPanel {
            // 优先把停止面板放在所选窗口外；没有空间时仍显示，坐标动作会因遮挡保守拒绝。
            var positioned = false
            for screen in NSScreen.screens where !positioned {
                let area = screen.visibleFrame
                let frames = [NSRect(x: area.minX + 8, y: area.maxY - p.frame.height - 8, width: p.frame.width, height: p.frame.height),
                              NSRect(x: area.maxX - p.frame.width - 8, y: area.minY + 8, width: p.frame.width, height: p.frame.height)]
                // AppKit原点在下方，CG原点在主屏上方。
                let mainHeight = NSScreen.screens.first?.frame.height ?? 0
                if let frame = frames.first(where: { f in !CGRect(x: f.minX, y: mainHeight - f.maxY, width: f.width, height: f.height).intersects(target) }) {
                    p.setFrame(frame, display: false); positioned = true
                }
            }
            p.orderFrontRegardless()
        }
    }
    @objc private func stopClicked() { onStop("用户点击独立原生停止按钮") }
    func hideStop() { stopPanel?.orderOut(nil) }
    func cancelAll() {
        auth?.invalidate(); auth = nil; approvalTimer?.invalidate(); approvalTimer = nil
        let a = approve; approve = nil
        let c = choose; choose = nil
        panel?.orderOut(nil); panel = nil; chosenWindows = []; menu = nil
        if pickerRegistered { SCContentSharingPicker.shared.isActive = false; SCContentSharingPicker.shared.remove(self); pickerRegistered = false }
        a?(false); c?(.failure(NativeFailure("cancelled", "原生选择已取消")))
    }
    func select(_ windows: [SCWindow], completion: @escaping (Result<SCWindow, Error>) -> Void) {
        choose = completion
        if #available(macOS 15.2, *) {
            var configuration = SCContentSharingPickerConfiguration()
            configuration.allowedPickerModes = [.singleWindow]
            configuration.allowsChangingSelectedContent = false
            configuration.excludedBundleIDs = NSWorkspace.shared.runningApplications.compactMap { app in
                guard let bundle = app.bundleIdentifier else { return nil }
                return allowedApplication(app.processIdentifier, bundle: bundle) ? nil : bundle
            }
            let picker = SCContentSharingPicker.shared
            picker.defaultConfiguration = configuration; picker.maximumStreamCount = 1
            picker.add(self); pickerRegistered = true; picker.isActive = true
            picker.present(using: .window)
        } else {
            // 14/15.0/15.1不存在公开Picker窗口identity，直接让用户选择SCWindow；绝不按filter矩形猜测。
            chosenWindows = windows
            let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 680, height: 190), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
            p.title = "明确选择一个允许观察和操作的窗口"; p.delegate = self
            let label = NSTextField(wrappingLabelWithString: "仅共享所选窗口。不共享桌面或音频；每次写动作仍需独立本地生物认证。请选择应用、PID与窗口编号均明确的项目。")
            label.frame = NSRect(x: 20, y: 112, width: 640, height: 56); p.contentView?.addSubview(label)
            let menu = NSPopUpButton(frame: NSRect(x: 20, y: 70, width: 640, height: 30))
            menu.addItem(withTitle: "请选择窗口…")
            for window in windows {
                let app = window.owningApplication
                menu.addItem(withTitle: "\(app?.applicationName ?? "应用") · PID \(app?.processID ?? 0) · #\(window.windowID) · \(String((window.title ?? "").prefix(140)))")
            }
            p.contentView?.addSubview(menu); self.menu = menu
            let cancel = NSButton(title: "取消", target: self, action: #selector(cancelClicked)); cancel.frame = NSRect(x: 460, y: 20, width: 90, height: 32)
            let select = NSButton(title: "选择此窗口", target: self, action: #selector(selectClicked)); select.frame = NSRect(x: 550, y: 20, width: 110, height: 32)
            p.contentView?.addSubview(cancel); p.contentView?.addSubview(select)
            panel = p; p.isFloatingPanel = true; p.level = .statusBar; p.hidesOnDeactivate = false
            p.center(); p.orderFrontRegardless()
        }
    }
    @objc private func selectClicked() {
        guard let index = menu?.indexOfSelectedItem, index > 0, index <= chosenWindows.count else { return }
        finishSelection(.success(chosenWindows[index - 1]))
    }
    @objc private func cancelClicked() { onStop("用户取消原生确认或窗口选择") }
    func windowWillClose(_ notification: Notification) { onStop("用户关闭原生确认或窗口选择") }
    private func finishSelection(_ result: Result<SCWindow, Error>) {
        let completion = choose; choose = nil; panel?.orderOut(nil); panel = nil; menu = nil; chosenWindows = []
        if pickerRegistered { SCContentSharingPicker.shared.isActive = false; SCContentSharingPicker.shared.remove(self); pickerRegistered = false }
        completion?(result)
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) { DispatchQueue.main.async { self.onStop("用户取消系统窗口选择") } }
    func contentSharingPickerStartDidFailWithError(_ error: Error) { DispatchQueue.main.async { self.finishSelection(.failure(NativeFailure("picker-failed", "系统窗口选择器失败"))) } }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        DispatchQueue.main.async {
            guard self.choose != nil else { return }
            if #available(macOS 15.2, *), filter.style == .window, filter.includedWindows.count == 1, filter.includedDisplays.isEmpty {
                self.finishSelection(.success(filter.includedWindows[0]))
            } else { self.finishSelection(.failure(NativeFailure("ambiguous-selection", "系统选择必须明确包含且仅包含一个窗口"))) }
        }
    }
    func confirm(_ request: PerformParams, target: Target, completion: @escaping (Bool) -> Void) {
        guard approve == nil, choose == nil else { completion(false); return }
        let context = LAContext()
        context.touchIDAuthenticationAllowableReuseDuration = 0
        context.localizedCancelTitle = "取消并停止"
        var error: NSError?
        // 没有公开API可认证CG鼠标事件的物理来源。不能把伪造的native按钮点击当成本地可信批准。
        // 使用每动作独立Touch ID认证；无生物认证设备明确拒绝，不降级为RPC批准或PID/tag信任。
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { completion(false); return }
        let data = (try? JSONEncoder().encode(request.action)) ?? Data()
        let detail = "目标：\(target.bundleId) · PID \(target.pid) · 窗口 #\(target.windowId)\n标题：\(target.title)\n动作ID：\(request.actionId)\n代际：\(request.epoch)\n\n\(String(data: data, encoding: .utf8) ?? "")\n\n此动作可能改变焦点、页面内容或触发应用副作用。不会自动提窗；坐标/键盘投递后会撤销本次授权。只有本次生物认证可批准这一个不可变动作。移动鼠标、键盘输入、取消或超时均会停止；请核对后使用Touch ID。"
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 680, height: 360), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
        p.title = "核对单次动作后使用 Touch ID"; p.delegate = self; p.level = .statusBar
        p.isFloatingPanel = true; p.hidesOnDeactivate = false; p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let scroll = NSScrollView(frame: NSRect(x: 16, y: 56, width: 648, height: 288)); scroll.hasVerticalScroller = true
        let text = NSTextView(frame: scroll.bounds); text.isEditable = false; text.isSelectable = false; text.font = .systemFont(ofSize: 13); text.string = detail
        text.isVerticallyResizable = true; text.isHorizontallyResizable = false
        text.textContainer?.widthTracksTextView = true
        text.maxSize = NSSize(width: 648, height: CGFloat.greatestFiniteMagnitude)
        text.sizeToFit()
        scroll.documentView = text; p.contentView?.addSubview(scroll)
        let cancel = NSButton(title: "取消并停止", target: self, action: #selector(cancelClicked)); cancel.frame = NSRect(x: 530, y: 12, width: 134, height: 32); p.contentView?.addSubview(cancel)
        approve = completion; auth = context; panel = p; p.center(); p.orderFrontRegardless()
        approvalTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in self?.onStop("本地单次确认超时") }
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "批准一次Gamma桌面动作：\(target.bundleId) #\(target.windowId)，\(String(data: data, encoding: .utf8) ?? request.action.kind)。仅此一次，不可重放。") { [weak self] accepted, _ in
            DispatchQueue.main.async {
                guard let self, self.auth === context else { return }
                self.auth = nil; self.approvalTimer?.invalidate(); self.approvalTimer = nil
                let completion = self.approve; self.approve = nil
                self.panel?.orderOut(nil); self.panel = nil
                // worker按真实窗口/焦点状态有界收敛；主线程不猜测认证面板退场时长。
                completion?(accepted)
            }
        }
    }
}
