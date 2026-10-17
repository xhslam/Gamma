import AppKit

/// 独立于renderer和模型的停止入口；不激活目标，不参与工具截图。
final class NativeUI: NSObject {
    var onStop: (String) -> Void = { _ in }
    private var stopPanel: NSPanel?
    private var statusLabel: NSTextField?
    var hasVisibleStop: Bool { stopPanel?.isVisible == true }
    func showStop(avoiding target: CGRect) {
        if stopPanel == nil {
            let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 330, height: 94), styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.title = "Gamma 桌面操作 · 主显示器"
            panel.level = .statusBar; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let label = NSTextField(labelWithString: "已就绪 · 人工输入将暂停")
            label.frame = NSRect(x: 12, y: 58, width: 306, height: 22)
            label.lineBreakMode = .byTruncatingTail; panel.contentView?.addSubview(label); statusLabel = label
            let button = NSButton(title: "立即停止（⌃⌥Esc）", target: self, action: #selector(stopClicked))
            button.frame = NSRect(x: 12, y: 12, width: 306, height: 34); panel.contentView?.addSubview(button)
            if let screen = NSScreen.main { panel.setFrameTopLeftPoint(NSPoint(x: screen.visibleFrame.minX + 10, y: screen.visibleFrame.maxY - 10)) }
            stopPanel = panel
        }
        stopPanel?.orderFrontRegardless()
    }
    func setStatus(_ text: String) { statusLabel?.stringValue = String(text.prefix(160)); stopPanel?.orderFrontRegardless() }
    @objc private func stopClicked() { onStop("用户点击独立原生停止按钮") }
    func hideStop() { stopPanel?.orderOut(nil) }
    func cancelAll() { /* 授权UI归父进程所有；原生保留暂停状态与停止入口。 */ }
}
