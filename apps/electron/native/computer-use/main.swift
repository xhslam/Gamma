import Foundation
import AppKit
import Darwin

// 日志自检在初始化 AppKit、Engine 或任何权限检查之前完成并退出。
if CommandLine.arguments == [CommandLine.arguments[0], "--logger-probe"] {
    writeNativeLoggerReady()
    exit(0)
}

// 必须在访问NSApplication/权限/窗口/监听API之前分流离线自测。
if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
    do {
        let count = try runSelfTests()
        print("{\"selfTest\":true,\"passed\":\(count),\"desktopAPIsInvoked\":false}")
        exit(0)
    } catch {
        fputs("离线安全自测失败：\((error as? NativeFailure)?.message ?? "未知错误")\n", stderr); exit(1)
    }
}
guard CommandLine.arguments.count == 1 else { fputs("仅支持stdio协议、--self-test 或 --logger-probe\n", stderr); exit(64) }
writeNativeLoggerReady()
signal(SIGPIPE, SIG_IGN)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let engine = Engine()
final class AppDelegate: NSObject, NSApplicationDelegate {
    let engine: Engine
    init(_ engine: Engine) { self.engine = engine }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { engine.stop("helper退出"); return .terminateNow }
}
let delegate = AppDelegate(engine)
app.delegate = delegate
engine.start()
let input = JSONLReader(onLine: { engine.handle($0) }, onEnd: {
    engine.stop("stdin结束或超出输入预算")
    // 不等待可能挂起的AX调用，也不等待stdout背压；进程退出会释放flock。
    DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) { _exit(0) }
})
input.start()
var sources: [DispatchSourceSignal] = []
for value in [SIGTERM, SIGINT, SIGHUP] {
    signal(value, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: value, queue: DispatchQueue.global())
    source.setEventHandler { engine.stop("helper收到退出信号"); _exit(0) }
    source.resume(); sources.append(source)
}
app.run()
engine.stop("主RunLoop退出")
