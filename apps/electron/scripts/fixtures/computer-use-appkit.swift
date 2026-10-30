import AppKit
import Foundation

// 仅供显式本机验收使用，不随产品分发。两个窗口同PID、同几何，状态只上报本轮loopback服务器。
struct FixtureState: Encodable {
    let source: String
    var clicks = 0, text = "", key = "", scrollY = 0
    var selectionStart = 0, selectionEnd = 0, ticks = 0
    let moved = false
    let pid = ProcessInfo.processInfo.processIdentifier
    enum CodingKeys: String, CodingKey { case source, clicks, text, key, scrollY, selectionStart, selectionEnd, ticks, moved, pid }
}
final class FixtureInput: NSTextView {
    var recordKey: (String) -> Void = { _ in }
    override func keyDown(with event: NSEvent) {
        super.keyDown(with: event)
        let name: String
        switch event.keyCode {
        case 123: name = "ArrowLeft"
        case 48: name = "Tab"
        case 36: name = "Enter"
        default: name = event.charactersIgnoringModifiers ?? ""
        }
        recordKey(name)
    }
}
final class FixtureDelegate: NSObject, NSApplicationDelegate {
    let endpoint: URL, title: String
    var windows: [String: NSWindow] = [:], inputs: [String: FixtureInput] = [:], states: [String: FixtureState] = [:]
    var timer: Timer?
    init(endpoint: URL, token: String) { self.endpoint = endpoint; title = "Gamma Native Acceptance \(token)" }
    func applicationDidFinishLaunching(_ notification: Notification) {
        for name in ["B", "A"] {
            let window = NSWindow(contentRect: NSRect(x: 320, y: 180, width: 700, height: 500), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "\(title) [\(name)]"; window.isReleasedWhenClosed = false
            guard let content = window.contentView else { continue }
            let label = NSTextField(labelWithString: "原生 AppKit \(name)：同PID与同尺寸窗口验收")
            label.frame = NSRect(x: 30, y: 420, width: 640, height: 30); content.addSubview(label)
            let scroll = NSScrollView(frame: NSRect(x: 30, y: 240, width: 640, height: 150))
            let input = FixtureInput(frame: NSRect(x: 0, y: 0, width: 640, height: 150))
            input.font = NSFont.systemFont(ofSize: 24); input.isRichText = false; input.isAutomaticQuoteSubstitutionEnabled = false
            input.setAccessibilityLabel("原生输入框\(name)")
            input.recordKey = { [weak self] key in self?.states[name]?.key = key }
            scroll.documentView = input; scroll.hasVerticalScroller = true; content.addSubview(scroll)
            let button = NSButton(title: "原生计数按钮\(name)", target: self, action: #selector(clicked(_:)))
            button.frame = NSRect(x: 30, y: 150, width: 260, height: 50); button.identifier = NSUserInterfaceItemIdentifier(name); content.addSubview(button)
            inputs[name] = input; states[name] = FixtureState(source: "native-\(name)"); windows[name] = window
            window.makeFirstResponder(input); window.orderFront(nil)
        }
        windows["A"]?.makeKeyAndOrderFront(nil); NSApp.activate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in self?.report() }
        report()
    }
    @objc func clicked(_ sender: NSButton) {
        guard let name = sender.identifier?.rawValue else { return }
        states[name]?.clicks += 1; report()
    }
    func report() {
        for name in ["A", "B"] {
            guard let input = inputs[name], var state = states[name] else { continue }
            state.text = input.string
            let range = input.selectedRange(); state.selectionStart = range.location; state.selectionEnd = range.location + range.length
            state.ticks += 1; states[name] = state
            guard let data = try? JSONEncoder().encode(state) else { continue }
            var request = URLRequest(url: endpoint); request.httpMethod = "POST"; request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            URLSession.shared.dataTask(with: request).resume()
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let arguments = CommandLine.arguments
if arguments.count != 3 || arguments[1].range(of: "^[a-f0-9-]{36}$", options: .regularExpression) == nil { exit(2) }
guard let endpoint = URL(string: arguments[2]), endpoint.scheme == "http", endpoint.host == "127.0.0.1", endpoint.path == "/state/\(arguments[1])" else { exit(2) }
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = FixtureDelegate(endpoint: endpoint, token: arguments[1])
application.delegate = delegate
application.run()
