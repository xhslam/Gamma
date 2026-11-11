import Foundation
import Darwin

struct OwnedProcess: Equatable {
    let pid: pid_t
    let startedSeconds: Int
    let startedMicroseconds: Int32
}
func processTable() throws -> [kinfo_proc] {
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    for _ in 0..<4 {
        var size = 0
        try require(sysctl(&mib, 4, nil, &size, nil, 0) == 0, "停止屏障无法枚举进程")
        var rows = [kinfo_proc](repeating: kinfo_proc(), count: size / MemoryLayout<kinfo_proc>.stride + 64)
        size = rows.count * MemoryLayout<kinfo_proc>.stride
        let result = rows.withUnsafeMutableBytes { sysctl(&mib, 4, $0.baseAddress, &size, nil, 0) }
        if result == 0 { return Array(rows.prefix(size / MemoryLayout<kinfo_proc>.stride)) }
        if errno != ENOMEM { break }
    }
    throw ComponentError.rejected("停止屏障进程枚举失败")
}
func fingerprint(_ row: kinfo_proc) -> OwnedProcess {
    OwnedProcess(pid: row.kp_proc.p_pid, startedSeconds: row.kp_proc.p_starttime.tv_sec, startedMicroseconds: row.kp_proc.p_starttime.tv_usec)
}

final class EngineJob {
    private let condition = NSCondition()
    private var stopRequested = false
    private var completed = false
    private var stopError: String?
    private var owned: [pid_t: OwnedProcess] = [:]
    private var pid: pid_t = 0
    private var reaped = false
    private var waitStatus: Int32 = 0

    func terminationConfirmed() -> Bool {
        condition.lock(); defer { condition.unlock() }
        return completed && stopError == nil
    }
    func stopAndWait() throws {
        condition.lock()
        stopRequested = true
        while !completed { condition.wait() }
        // 执行线程已经结束；在锁内重新核验保留的执行者，避免并发重试互相修改 owned。
        if stopError != nil {
            do { try stopTree(); stopError = nil }
            catch { stopError = String(describing: error) }
        }
        let error = stopError
        condition.unlock()
        if let error { throw ComponentError.rejected(error) }
    }
    private func shouldStop() -> Bool {
        condition.lock(); defer { condition.unlock() }
        return stopRequested
    }
    private func collect() throws -> [kinfo_proc] {
        let rows = try processTable()
        var parents = Set(rows.compactMap { row in owned[row.kp_proc.p_pid] == fingerprint(row) ? row.kp_proc.p_pid : nil })
        if !reaped { parents.insert(pid) }
        var changed = true
        while changed {
            changed = false
            for row in rows where row.kp_eproc.e_ucred.cr_uid == getuid() {
                let id = row.kp_proc.p_pid
                if (parents.contains(row.kp_eproc.e_ppid) || (!reaped && row.kp_eproc.e_pgid == pid)) && id > 1 && id != getpid() {
                    if owned[id] == nil { owned[id] = fingerprint(row); parents.insert(id); changed = true }
                }
            }
        }
        return rows.filter { row in owned[row.kp_proc.p_pid] == fingerprint(row) && row.kp_proc.p_stat != SZOMB }
    }
    private func reap() {
        guard !reaped && pid > 0 else { return }
        let result = waitpid(pid, &waitStatus, WNOHANG)
        if result == pid { reaped = true }
    }
    private func stopTree() throws {
        guard pid > 0 else { return }
        // 即使后续进程枚举失败，也先停止尚未 reap 的自有进程组；仍然不虚报 ACK。
        if !reaped { kill(-pid, SIGKILL) }
        let deadline = Date().addingTimeInterval(8)
        repeat {
            let alive = try collect()
            // 使用单独 spawn process group；并核验每个已观察后代的启动时间，避免杀死重用 PID。
            if !reaped { kill(-pid, SIGKILL) }
            for row in alive { kill(row.kp_proc.p_pid, SIGKILL) }
            reap()
            if reaped && alive.isEmpty { return }
            usleep(10000)
        } while Date() < deadline
        throw ComponentError.rejected("真实执行者停止未确认；不得重放")
    }

    func execute(executable: String, arguments: [String], root: String, session: String, connection: Int32, output: (String, Data) throws -> Void) throws -> Int32 {
        var pipesOut: [Int32] = [0, 0]
        var pipesErr: [Int32] = [0, 0]
        var failure: Error?
        defer {
            condition.lock()
            stopError = failure.map(String.init(describing:))
            completed = true
            condition.broadcast()
            condition.unlock()
        }
        do {
            try require(!shouldStop(), "会话已停止")
            try require(pipe(&pipesOut) == 0, "stdout pipe 创建失败")
            try require(pipe(&pipesErr) == 0, "stderr pipe 创建失败")
            defer { for fd in pipesOut + pipesErr where fd > 0 { close(fd) } }
            for fd in pipesOut + pipesErr { _ = fcntl(fd, F_SETFD, FD_CLOEXEC) }
            var actions: posix_spawn_file_actions_t?
            var attributes: posix_spawnattr_t?
            posix_spawn_file_actions_init(&actions)
            posix_spawnattr_init(&attributes)
            defer { posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes) }
            posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0)
            posix_spawn_file_actions_adddup2(&actions, pipesOut[1], STDOUT_FILENO)
            posix_spawn_file_actions_adddup2(&actions, pipesErr[1], STDERR_FILENO)
            posix_spawn_file_actions_addchdir_np(&actions, root)
            posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
            posix_spawnattr_setpgroup(&attributes, 0)
            let argv = ([executable] + arguments).map { (value: String) in value.withCString { strdup($0) } } + [nil]
            // 不继承代理、Gamma 或 launchd 的动态链接器和工具环境。
            let environment = ["PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOME=\(NSHomeDirectory())", "LANG=en_US.UTF-8", "TMPDIR=\(try systemTemporaryDirectory())/", "AGENT_DESKTOP_HOME=\(root)/state", "AGENT_DESKTOP_SESSION=\(session)", "AGENT_DESKTOP_NO_UPDATE_NOTIFIER=1"].map { (value: String) in value.withCString { strdup($0) } } + [nil]
            defer { for value in argv + environment { free(value) } }
            var mutableArgv = argv
            var mutableEnvironment = environment
            let result = posix_spawn(&pid, executable, &actions, &attributes, &mutableArgv, &mutableEnvironment)
            try require(result == 0, "引擎启动失败：\(result)")
            close(pipesOut[1]); pipesOut[1] = -1
            close(pipesErr[1]); pipesErr[1] = -1
            for fd in [pipesOut[0], pipesErr[0]] { _ = fcntl(fd, F_SETFL, O_NONBLOCK) }
            var open = [true, true]
            let started = Date()
            var total = 0
            while !reaped || open.contains(true) {
                try require(!shouldStop(), "会话已停止；投递状态未知，不得重放")
                try require(Date().timeIntervalSince(started) < 120, "引擎超时；投递状态未知，不得重放")
                _ = try collect()
                if connection >= 0 {
                    var peek: UInt8 = 0
                    let count = recv(connection, &peek, 1, MSG_PEEK | MSG_DONTWAIT)
                    try require(count != 0 && !(count < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR), "代理断连；执行已停止，不得重放")
                    try require(count <= 0, "执行连接不允许额外请求")
                }
                for (index, fd) in [pipesOut[0], pipesErr[0]].enumerated() where open[index] {
                    var bytes = [UInt8](repeating: 0, count: 32768)
                    let size = Darwin.read(fd, &bytes, bytes.count)
                    if size > 0 {
                        total += size
                        try require(total <= maxOutput, "引擎输出超过 24 MiB；不得重放")
                        try output(index == 0 ? "stdout" : "stderr", Data(bytes.prefix(size)))
                    } else if size == 0 { open[index] = false }
                    else if errno != EAGAIN && errno != EINTR { throw ComponentError.rejected("引擎输出读取失败") }
                }
                reap()
                usleep(10000)
            }
            try stopTree() // 正常退出也必须回收所有残留后代。
            if waitStatus & 0x7f == 0 { return (waitStatus >> 8) & 0xff }
            return 128 + (waitStatus & 0x7f)
        } catch {
            do { try stopTree() } catch let barrier { failure = barrier; throw barrier }
            throw error
        }
    }
}
