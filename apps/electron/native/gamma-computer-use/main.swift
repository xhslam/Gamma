import AppKit
import Foundation
import Darwin

final class ComponentDelegate: NSObject, NSApplicationDelegate {
    var service: DesktopService?
    var signals: [DispatchSourceSignal] = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let instance = try DesktopService()
            try instance.start()
            service = instance
            for value in [SIGTERM, SIGINT] {
                signal(value, SIG_IGN)
                let source = DispatchSource.makeSignalSource(signal: value, queue: .global())
                source.setEventHandler { [weak self] in
                    self?.service?.shutdown()
                    exit(0)
                }
                source.resume()
                signals.append(source)
            }
        } catch {
            FileHandle.standardError.write(Data("gammaComputerUse：\(error)\n".utf8))
            exit(70)
        }
    }
    func applicationWillTerminate(_ notification: Notification) { service?.shutdown() }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.first == "--client" || arguments.first == "--ping" || arguments.first == "--stop-session" {
    do { exit(try runClient(arguments)) }
    catch {
        FileHandle.standardError.write(Data("gammaComputerUse transport：\(error)\n".utf8))
        exit(70)
    }
} else if arguments.isEmpty || arguments.allSatisfy({ $0.hasPrefix("-psn_") }) {
    let app = NSApplication.shared
    let delegate = ComponentDelegate()
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
} else {
    FileHandle.standardError.write(Data("用法：gammaComputerUse [--ping | --client <CLI命令...> | --stop-session <64hex>]\n".utf8))
    exit(64)
}
