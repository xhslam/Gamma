import Foundation
import Darwin

private struct SessionState {
    let root: String
    var job: EngineJob?
    var stopped: Bool
}
final class DesktopService {
    private let lock = NSLock()
    private var sessions: [String: SessionState] = [:]
    private var shuttingDown = false
    private var listener: Int32 = -1
    private var lockFD: Int32 = -1
    private let stoppedDirectory = socketDirectory + "/stopped"
    private let connections = DispatchSemaphore(value: 32)
    private func wasStopped(_ session: String) -> Bool {
        // lstat 不跟随 symlink；任何已有条目均按已停止处理，失败关闭。
        var info = stat()
        return lstat(stoppedDirectory + "/" + session, &info) == 0 || errno != ENOENT
    }
    private func persistStop(_ session: String) throws {
        let fd = Darwin.open(stoppedDirectory + "/" + session, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        if fd < 0 { try require(errno == EEXIST, "无法持久化停止屏障"); return }
        defer { close(fd) }
        try require(fsync(fd) == 0, "停止屏障同步失败")
        let directory = Darwin.open(stoppedDirectory, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        try require(directory >= 0, "停止屏障目录打开失败")
        defer { close(directory) }
        try require(fsync(directory) == 0, "停止屏障目录同步失败")
    }
    let identity: String
    let engine: String
    let engineVersion: String

    init() throws {
        identity = try ownIdentity()
        engine = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/agent-desktop/agent-desktop").path
        let manifest = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/agent-desktop/.source-build.json")
        let data = try Data(contentsOf: manifest)
        struct Manifest: Decodable { let version: String }
        engineVersion = try JSONDecoder().decode(Manifest.self, from: data).version
        _ = try diskHash(engine)
    }
    func start() throws {
        if mkdir(socketDirectory, 0o700) != 0 { try require(errno == EEXIST, "IPC 私有目录创建失败") }
        try validatePrivateDirectory(socketDirectory)
        if mkdir(stoppedDirectory, 0o700) != 0 { try require(errno == EEXIST, "停止屏障目录创建失败") }
        try validatePrivateDirectory(stoppedDirectory)
        lockFD = Darwin.open(socketDirectory + "/service.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        try require(lockFD >= 0, "IPC 锁创建失败")
        var info = stat()
        try require(fstat(lockFD, &info) == 0 && info.st_uid == getuid() && info.st_mode & 0o777 == 0o600 && info.st_mode & S_IFMT == S_IFREG && info.st_nlink == 1, "IPC 锁身份无效")
        try require(flock(lockFD, LOCK_EX | LOCK_NB) == 0, "独立组件已在运行")
        if lstat(socketPath, &info) == 0 {
            try require(info.st_uid == getuid() && info.st_mode & S_IFMT == S_IFSOCK, "IPC 已有路径身份无效")
            try require(unlink(socketPath) == 0, "旧 socket 清理失败")
        }
        listener = socket(AF_UNIX, SOCK_STREAM, 0)
        try require(listener >= 0, "IPC socket 创建失败")
        configureSocket(listener)
        let oldMask = umask(0o177)
        let bound = withSocketAddress { Darwin.bind(listener, $0, $1) }
        umask(oldMask)
        try require(bound == 0 && chmod(socketPath, 0o600) == 0 && listen(listener, 16) == 0, "IPC 监听失败")
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            while true {
                let fd = accept(listener, nil, nil)
                if fd < 0 { if errno == EINTR { continue }; break }
                if connections.wait(timeout: .now()) != .success { close(fd); continue }
                configureSocket(fd, seconds: 2)
                DispatchQueue.global(qos: .userInitiated).async { [self] in
                    defer { connections.signal() }
                    handle(fd)
                }
            }
        }
    }
    private func begin(_ request: Request) throws -> (String, String) {
        guard let root = request.root, let session = request.session else { throw ComponentError.rejected("缺少会话身份") }
        try validateRoot(root, session: session)
        return (root, session)
    }
    private func handle(_ fd: Int32) {
        defer { close(fd) }
        do {
            try authenticatePeer(fd, requireGammaParent: true)
            let request = try receiveFrame(fd, as: Request.self, limit: 512 * 1024)
            try require(request.version == protocolVersion, "IPC 协议不兼容")
            switch request.operation {
            case "ping":
                try require(request.root == nil && request.session == nil && request.arguments == nil, "握手不接受执行参数")
                try sendFrame(fd, Reply(kind: "hello", version: protocolVersion, component: componentVersion, engine: engineVersion, identity: identity))
            case "stop":
                guard let root = request.root, let session = request.session else { throw ComponentError.rejected("缺少停止会话身份") }
                try require(isSession(session) && request.arguments == nil, "停止会话参数无效")
                lock.lock()
                let knownRoot = sessions[session]?.root
                lock.unlock()
                // 已绑定的活动会话即使目录被宿主移除，也仍然必须能够停止。
                if let knownRoot { try require(knownRoot == root, "会话 root 不匹配") }
                else { try validateRoot(root, session: session) }
                lock.lock()
                if let existing = sessions[session], existing.root != root { lock.unlock(); throw ComponentError.rejected("会话 root 不匹配") }
                if sessions[session] == nil && sessions.count >= 4096 { lock.unlock(); throw ComponentError.rejected("会话容量已满") }
                let job = sessions[session]?.job
                sessions[session] = SessionState(root: root, job: job, stopped: true)
                lock.unlock()
                try job?.stopAndWait()
                lock.lock()
                if let job, sessions[session]?.job === job, job.terminationConfirmed() { sessions[session]?.job = nil }
                lock.unlock()
                try persistStop(session)
                try sendFrame(fd, Reply(kind: "stopped", exitCode: 0))
            case "execute":
                let (root, session) = try begin(request)
                guard let arguments = request.arguments else { throw ComponentError.rejected("缺少 CLI 参数") }
                try validateArguments(arguments)
                try require(!wasStopped(session), "会话已永久停止；不得重放")
                let job = EngineJob()
                lock.lock()
                if shuttingDown { lock.unlock(); throw ComponentError.rejected("组件正在停止；不得重放") }
                if let existing = sessions[session] {
                    if existing.root != root || existing.stopped || existing.job != nil {
                        lock.unlock(); throw ComponentError.rejected("会话已停止、root 不匹配或正在执行；不得重放")
                    }
                } else if sessions.count >= 4096 { lock.unlock(); throw ComponentError.rejected("会话容量已满") }
                sessions[session] = SessionState(root: root, job: job, stopped: false)
                lock.unlock()
                var succeeded = false
                defer {
                    lock.lock()
                    // 屏障失败时保留失败对象；之后的 stop 不得把丢失执行者误报为成功。
                    if job.terminationConfirmed() { sessions[session]?.job = nil }
                    if !succeeded { sessions[session]?.stopped = true }
                    lock.unlock()
                    if !succeeded { try? persistStop(session) }
                }
                let code = try job.execute(executable: engine, arguments: arguments, root: root, session: session, connection: fd) { kind, data in
                    try sendFrame(fd, Reply(kind: kind, bytes: data))
                }
                try sendFrame(fd, Reply(kind: "exit", exitCode: code))
                succeeded = true
            default: throw ComponentError.rejected("不支持的 IPC 操作")
            }
        } catch {
            // 仅传输错误；绝不构造或改写原生引擎的 delivery/retry envelope。
            try? sendFrame(fd, Reply(kind: "error", exitCode: 70, message: String(describing: error)))
        }
    }
    func shutdown() {
        if listener >= 0 { Darwin.shutdown(listener, SHUT_RDWR); close(listener); listener = -1 }
        lock.lock()
        shuttingDown = true
        let jobs = sessions.values.compactMap(\.job)
        let identifiers = Array(sessions.keys)
        for key in identifiers { sessions[key]?.stopped = true }
        lock.unlock()
        for job in jobs { try? job.stopAndWait() }
        for session in identifiers { try? persistStop(session) }
        unlink(socketPath)
        if lockFD >= 0 { close(lockFD); lockFD = -1 }
    }
}

func runClient(_ arguments: [String]) throws -> Int32 {
    _ = try ownIdentity()
    try validatePrivateDirectory(socketDirectory)
    let info = try fileInfo(socketPath)
    try require(info.st_uid == getuid() && info.st_mode & S_IFMT == S_IFSOCK && info.st_mode & 0o777 == 0o600, "IPC socket 身份无效")
    let request: Request
    if arguments == ["--ping"] {
        request = Request(version: protocolVersion, operation: "ping", root: nil, session: nil, arguments: nil)
    } else {
        let root = FileManager.default.currentDirectoryPath
        let environment = ProcessInfo.processInfo.environment
        try require(environment["AGENT_DESKTOP_HOME"] == root + "/state", "AGENT_DESKTOP_HOME 必须对应当前 cwd/state")
        let session: String
        if arguments.first == "--stop-session", arguments.count == 2 {
            session = arguments[1]
            try require(environment["AGENT_DESKTOP_SESSION"] == nil || environment["AGENT_DESKTOP_SESSION"] == session, "停止会话与环境不一致")
            request = Request(version: protocolVersion, operation: "stop", root: root, session: session, arguments: nil)
        } else {
            try require(arguments.first == "--client", "客户端参数无效")
            guard let value = environment["AGENT_DESKTOP_SESSION"] else { throw ComponentError.rejected("缺少 AGENT_DESKTOP_SESSION") }
            session = value
            let args = Array(arguments.dropFirst())
            try validateArguments(args)
            request = Request(version: protocolVersion, operation: "execute", root: root, session: session, arguments: args)
        }
        try validateRoot(root, session: session)
    }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    try require(fd >= 0, "客户端 socket 创建失败")
    defer { close(fd) }
    configureSocket(fd)
    try require(withSocketAddress { connect(fd, $0, $1) } == 0, "独立组件未启动；请由 Gamma 使用 LaunchServices 打开组件，不得重放已投递操作")
    try authenticatePeer(fd, requireGammaParent: false)
    try sendFrame(fd, request)
    var total = 0
    var bufferedStdout = ClientOutputBuffer()
    while true {
        let reply = try receiveFrame(fd, as: Reply.self)
        switch reply.kind {
        case "stdout", "stderr":
            guard let data = reply.bytes else { throw ComponentError.rejected("IPC 输出帧无效") }
            total += data.count
            try require(total <= maxOutput, "IPC 输出超限")
            if reply.kind == "stdout" { bufferedStdout.append(data) }
            else { try writeAll(STDERR_FILENO, data) }
        case "hello":
            try require(request.operation == "ping" && reply.version == protocolVersion && reply.component == componentVersion, "握手协议或组件版本不兼容")
            try writeAll(STDOUT_FILENO, JSONEncoder().encode(reply) + Data([10]))
            return 0
        case "stopped":
            try require(request.operation == "stop", "意外的停止 ACK")
            try writeAll(STDOUT_FILENO, JSONEncoder().encode(reply) + Data([10]))
            return 0
        case "exit":
            try require(request.operation == "execute", "意外的执行 ACK")
            // ACK 证明完整输出已交付；原生成功/失败由未修改的 envelope 表达。
            try writeAll(STDOUT_FILENO, bufferedStdout.finish(reply))
            return 0
        case "error": throw ComponentError.rejected(reply.message ?? "组件执行失败；不得重放")
        default: throw ComponentError.rejected("未知 IPC 回复；不得重放")
        }
    }
}
