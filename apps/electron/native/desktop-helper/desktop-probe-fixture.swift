import AppKit
import Foundation

// 仅用于合成数据的人工监督测试目标，不包含桌面控制、截图或权限申请。
// 本次只编译，不启动。后续运行会显示两个同标题窗口，不能据此宣称 AX/捕获链路已验证。
private struct FixtureWindow: Encodable {
    let fixtureID: String
    let windowNumber: Int
}
private struct FixtureEvent: Encodable {
    let kind: String
    var pid: Int?
    var windows: [FixtureWindow]?
    var cell: String?
    var count: Int?
    var windowNumber: Int?
}

@MainActor
private final class FixtureDelegate: NSObject, NSApplicationDelegate {
    private var windows: [NSWindow] = []
    private var labels: [String: NSTextField] = [:]
    private var clickCounts: [String: Int] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        makeWindow(id: "A", origin: CGPoint(x: 160, y: 180))
        makeWindow(id: "B", origin: CGPoint(x: 240, y: 240))
        windows.forEach { $0.orderFront(nil) }
        windows.first?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        emit(FixtureEvent(kind: "ready", pid: Int(ProcessInfo.processInfo.processIdentifier),
                          windows: windows.map { FixtureWindow(fixtureID: $0.identifier?.rawValue ?? "", windowNumber: $0.windowNumber) }))
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    private func emit(_ event: FixtureEvent) {
        // 只记录本进程合成 fixture 的事件，不读取其他应用和用户内容。
        guard let output = try? JSONEncoder().encode(event) else { return }
        FileHandle.standardOutput.write(output)
        FileHandle.standardOutput.write(Data([10]))
    }
    private func makeWindow(id: String, origin: CGPoint) {
        let window = NSWindow(contentRect: CGRect(origin: origin, size: CGSize(width: 640, height: 480)),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Gamma Phase 0 Fixture"
        window.identifier = NSUserInterfaceItemIdentifier("gamma.probe.window.\(id)")
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        guard let view = window.contentView else { return }
        let label = NSTextField(labelWithString: "窗口 \(id) · 点击计数 0 · 仅合成数据")
        label.frame = CGRect(x: 20, y: 434, width: 600, height: 24)
        label.setAccessibilityIdentifier("gamma.probe.\(id).status")
        view.addSubview(label)
        labels[id] = label
        clickCounts[id] = 0
        for row in 0..<4 {
            for column in 0..<6 {
                let button = NSButton(title: "\(id) \(column),\(row)", target: self, action: #selector(gridClicked(_:)))
                button.identifier = NSUserInterfaceItemIdentifier("\(id):\(column):\(row)")
                button.setAccessibilityIdentifier("gamma.probe.\(id).cell.\(column).\(row)")
                button.frame = CGRect(x: CGFloat(20 + column * 100), y: CGFloat(335 - row * 65), width: 88, height: 52)
                button.bezelStyle = .regularSquare
                view.addSubview(button)
            }
        }
        let text = NSTextField(string: "合成测试文本 ABC 中文 🙂")
        text.frame = CGRect(x: 20, y: 80, width: 600, height: 28)
        text.setAccessibilityIdentifier("gamma.probe.\(id).text")
        view.addSubview(text)
        let sheet = NSButton(title: "打开测试 sheet", target: self, action: #selector(openSheet(_:)))
        sheet.frame = CGRect(x: 20, y: 24, width: 180, height: 32)
        sheet.setAccessibilityIdentifier("gamma.probe.\(id).sheet")
        view.addSubview(sheet)
        windows.append(window)
    }
    @objc private func gridClicked(_ sender: NSButton) {
        guard let identifier = sender.identifier?.rawValue, let id = identifier.split(separator: ":").first.map(String.init) else { return }
        clickCounts[id, default: 0] += 1
        labels[id]?.stringValue = "窗口 \(id) · 点击计数 \(clickCounts[id, default: 0]) · 最近格 \(identifier)"
        emit(FixtureEvent(kind: "grid-clicked", cell: identifier, count: clickCounts[id, default: 0]))
    }
    @objc private func openSheet(_ sender: NSButton) {
        guard let window = sender.window else { return }
        let alert = NSAlert()
        alert.messageText = "仅用于验证模态状态失效的测试 sheet"
        alert.informativeText = "不保存文件，不联网，不访问其他应用。"
        alert.addButton(withTitle: "关闭测试 sheet")
        emit(FixtureEvent(kind: "sheet-opened", windowNumber: window.windowNumber))
        alert.beginSheetModal(for: window)
    }
}

@main
private struct FixtureMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = FixtureDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
