// 单独编译的测试入口；不包含在应用中，不为生产 IPC 添加任何测试旁路。
import Foundation
import Darwin

@main struct BehaviorTests {
    static func rejected(_ body: () throws -> Void) -> Bool {
        do { try body(); return false } catch { return true }
    }
    static func main() throws {
        if CommandLine.arguments.contains("--fixture") {
            // 创建真实后代，测试停止 ACK 是否等待其退出。
            let descendant = Process()
            descendant.executableURL = URL(fileURLWithPath: "/bin/sleep")
            descendant.arguments = ["600"]
            try descendant.run()
            try writeAll(STDOUT_FILENO, Data("\(getpid()) \(descendant.processIdentifier)\n".utf8))
            while true { pause() }
        }
        if CommandLine.arguments.contains("--output-fixture") {
            let block = Data(repeating: 65, count: 1024 * 1024)
            for _ in 0..<25 { try writeAll(STDOUT_FILENO, block) }
            exit(0)
        }
        var scenarios = [String]()
        func check(_ condition: Bool, _ text: String) throws {
            try require(condition, "BDD 失败：\(text)")
            scenarios.append(text)
        }
        let root = try systemTemporaryDirectory() + "/gamma-ad-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try FileManager.default.createDirectory(atPath: root + "/state", withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(atPath: root) }
        let session = String(repeating: "a", count: 64)
        try validateRoot(root, session: session)
        try check(true, "Given 合规临时 root/state When 校验 Then 接受真实 0700 目录")
        try check(rejected { try validateRoot(root, session: "../invalid") }, "Given 非 64hex session Then 拒绝")
        chmod(root, 0o755)
        try check(rejected { try validateRoot(root, session: session) }, "Given 非私有 root Then 拒绝")
        chmod(root, 0o700)
        try FileManager.default.createSymbolicLink(atPath: root + "/state/link", withDestinationPath: "/tmp")
        try check(rejected { try validateRoot(root, session: session) }, "Given state 含 symlink Then 拒绝")
        try FileManager.default.removeItem(atPath: root + "/state/link")
        try validateArguments(["type", "hello world\n你好"])
        try check(true, "Given 原生结构化 CLI 参数 Then 保留完整文本")
        for args in [["/bin/sh", "-c", "id"], ["batch", "[]"], ["status", "--session=evil"], ["status", "--trace", "/tmp/out"], ["launch", "Terminal", "--env=X=Y"], ["screenshot", "/tmp/out.png"]] {
            try check(rejected { try validateArguments(args) }, "Given 非法 CLI \(args.first!) Then 拒绝")
        }
        for args in [["--headed", "snapshot"], ["--headed", "screenshot", "--app", "Finder"], ["skills", "list"], ["skills", "get", "desktop"], ["skills", "path", "desktop"], ["session", "list"], ["session", "start"], ["session", "end"], ["trace", "show"], ["cursor-overlay", "status"], ["cursor-overlay", "disable"]] {
            try validateArguments(args)
            try check(true, "Given 既有合法参数 \(args.joined(separator: " ")) Then 接受")
        }
        for args in [["key-down"], ["mouse-down"], ["session", "gc"], ["trace", "export"], ["cursor-overlay", "enable"], ["--headed", "screenshot", "/tmp/out.png"]] {
            try check(rejected { try validateArguments(args) }, "Given 禁用命令或危险子命令 Then 拒绝 \(args.joined(separator: " "))")
        }
        var buffer = ClientOutputBuffer()
        let errorEnvelope = Data("{\"ok\":false,\"error\":{\"code\":\"PERM_DENIED\"}}\n".utf8)
        buffer.append(errorEnvelope)
        try check(rejected { _ = try buffer.finish(Reply(kind: "error", exitCode: 70)) }, "Given 无最终 exit ACK Then 不释放部分 stdout")
        try check(try buffer.finish(Reply(kind: "exit", exitCode: 1)) == errorEnvelope, "Given 原生错误退出但存在最终 ACK Then 原样交付错误 envelope")
        let maliciousRequest = Data("{\"version\":1,\"operation\":\"ping\",\"executable\":\"/bin/sh\",\"env\":{}}".utf8)
        try check(rejected { _ = try JSONDecoder().decode(Request.self, from: maliciousRequest) }, "Given IPC 额外 executable/env 字段 Then 明确拒绝")
        let engine = CommandLine.arguments[1]
        var stdout = Data()
        let exitCode = try EngineJob().execute(executable: engine, arguments: ["version"], root: root, session: session, connection: -1) { kind, bytes in
            if kind == "stdout" { stdout.append(bytes) }
        }
        try check(exitCode == 0 && String(data: stdout, encoding: .utf8)?.contains("1.0.2") == true, "Given 固定引擎 version When 执行 Then 完整输出与正常退出码")

        func stoppedScenario(disconnect: Bool) throws {
            let job = EngineJob()
            let ready = DispatchSemaphore(value: 0)
            let finished = DispatchSemaphore(value: 0)
            var pids: [Int32] = []
            var sockets: [Int32] = [-1, -1]
            if disconnect { try require(socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0, "socketpair 失败") }
            defer { for fd in sockets where fd >= 0 { close(fd) } }
            let connection = sockets[0]
            DispatchQueue.global().async {
                defer { finished.signal() }
                do {
                    _ = try job.execute(executable: CommandLine.arguments[0], arguments: ["--fixture"], root: root, session: session, connection: connection) { _, data in
                        pids = (String(data: data, encoding: .utf8) ?? "").split(whereSeparator: \.isWhitespace).compactMap { Int32($0) }
                        ready.signal()
                    }
                } catch { /* 取消/断连必须失败，不得重放。 */ }
            }
            try require(ready.wait(timeout: .now() + 5) == .success, "fixture 未启动")
            if disconnect { close(sockets[1]); sockets[1] = -1 }
            else { try job.stopAndWait() }
            try require(finished.wait(timeout: .now() + 10) == .success, "停止屏障未完成")
            let rows = try processTable()
            try check(pids.count == 2 && !rows.contains { pids.contains($0.kp_proc.p_pid) && $0.kp_proc.p_stat != SZOMB }, disconnect ? "Given 代理断连 Then 真实引擎和后代均已停止" : "Given 活跃引擎及后代 When stopAndWait ACK Then 均已停止")
        }
        try stoppedScenario(disconnect: false)
        try stoppedScenario(disconnect: true)
        let oversized = rejected {
            _ = try EngineJob().execute(executable: CommandLine.arguments[0], arguments: ["--output-fixture"], root: root, session: session, connection: -1) { _, _ in }
        }
        try check(oversized, "Given 输出超过24MiB Then 停止引擎并失败")
        let peerRejected = rejected { try authenticatePeer(STDIN_FILENO, requireGammaParent: true) }
        try check(peerRejected, "Given 非 Unix 授权代理 Then 身份验证失败")
        print(String(data: try JSONEncoder().encode(scenarios), encoding: .utf8)!)
    }
}
