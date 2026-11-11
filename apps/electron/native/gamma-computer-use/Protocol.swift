import Foundation
import Darwin

let componentVersion = "1.0.0"
let protocolVersion = 1
let maxOutput = 24 * 1024 * 1024
let socketDirectory = "/tmp/gamma-computer-use-\(getuid())"
let socketPath = socketDirectory + "/service.sock"

enum ComponentError: Error, CustomStringConvertible {
    case rejected(String)
    var description: String { switch self { case .rejected(let text): return text } }
}
func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw ComponentError.rejected(message) }
}

struct Request: Codable {
    let version: Int
    let operation: String
    let root: String?
    let session: String?
    let arguments: [String]?
}
private struct RequestKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}
extension Request {
    init(from decoder: Decoder) throws {
        let raw = try decoder.container(keyedBy: RequestKey.self)
        let names: Set<String> = ["version", "operation", "root", "session", "arguments"]
        try require(raw.allKeys.allSatisfy { names.contains($0.stringValue) }, "IPC 不接受 executable、环境或未知字段")
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        operation = try container.decode(String.self, forKey: .operation)
        root = try container.decodeIfPresent(String.self, forKey: .root)
        session = try container.decodeIfPresent(String.self, forKey: .session)
        arguments = try container.decodeIfPresent([String].self, forKey: .arguments)
    }
}
struct Reply: Codable {
    let kind: String
    var bytes: Data? = nil
    var exitCode: Int32? = nil
    var message: String? = nil
    var version: Int? = nil
    var component: String? = nil
    var engine: String? = nil
    var identity: String? = nil
}

struct ClientOutputBuffer {
    private var bytes = Data()
    mutating func append(_ data: Data) { bytes.append(data) }
    func finish(_ reply: Reply) throws -> Data {
        try require(reply.kind == "exit" && reply.exitCode != nil, "缺少最终 exit ACK；不得交付不完整 stdout")
        return bytes
    }
}

func configureSocket(_ fd: Int32, seconds: Int = 125) {
    var noSignal: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout.size(ofValue: noSignal)))
    var timeout = timeval(tv_sec: seconds, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
}
func writeAll(_ fd: Int32, _ data: Data) throws {
    try data.withUnsafeBytes { buffer in
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            if count < 0 && errno == EINTR { continue }
            try require(count > 0, "连接写入失败")
            offset += count
        }
    }
}
func readExact(_ fd: Int32, _ size: Int) throws -> Data {
    var result = Data(count: size)
    try result.withUnsafeMutableBytes { buffer in
        var offset = 0
        while offset < size {
            let count = Darwin.read(fd, buffer.baseAddress!.advanced(by: offset), size - offset)
            if count < 0 && errno == EINTR { continue }
            try require(count > 0, "连接断开或读取超时")
            offset += count
        }
    }
    return result
}
func sendFrame<T: Encodable>(_ fd: Int32, _ value: T) throws {
    let bytes = try JSONEncoder().encode(value)
    try require(bytes.count <= 1024 * 1024, "IPC 帧过大")
    var count = UInt32(bytes.count).bigEndian
    try withUnsafeBytes(of: &count) { try writeAll(fd, Data($0)) }
    try writeAll(fd, bytes)
}
func receiveFrame<T: Decodable>(_ fd: Int32, as type: T.Type, limit: Int = 1024 * 1024) throws -> T {
    let header = try readExact(fd, 4)
    let count = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    try require(count > 0 && count <= limit, "IPC 帧长度无效")
    return try JSONDecoder().decode(type, from: readExact(fd, Int(count)))
}
func withSocketAddress<T>(_ body: (UnsafePointer<sockaddr>, socklen_t) throws -> T) rethrows -> T {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(socketPath.utf8CString)
    withUnsafeMutableBytes(of: &address.sun_path) { target in target.copyBytes(from: bytes.map { UInt8(bitPattern: $0) }) }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    return try withUnsafePointer(to: &address) { pointer in
        try pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { try body($0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
}

func isSession(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}
func fileInfo(_ path: String) throws -> stat {
    var info = stat()
    try require(lstat(path, &info) == 0, "路径不存在：\(path)")
    return info
}
func validatePrivateDirectory(_ path: String) throws {
    let info = try fileInfo(path)
    try require(info.st_uid == getuid() && info.st_mode & S_IFMT == S_IFDIR && info.st_mode & 0o777 == 0o700, "目录必须为当前用户的真实 0700 目录")
}
func realDirectoryPath(_ path: String) throws -> String {
    guard let pointer = realpath(path, nil) else { throw ComponentError.rejected("无法解析真实目录") }
    defer { free(pointer) }
    return String(cString: pointer)
}
func systemTemporaryDirectory() throws -> String {
    // 不信任代理传来的 TMPDIR，使用系统为当前用户分配的临时目录。
    let count = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
    try require(count > 1 && count < 4096, "无法解析系统临时目录")
    var buffer = [CChar](repeating: 0, count: count)
    try require(confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, count) == count, "系统临时目录读取失败")
    return try realDirectoryPath(String(cString: buffer))
}
func validateRoot(_ root: String, session: String) throws {
    try require(isSession(session), "session 必须为 64 位小写十六进制")
    let url = URL(fileURLWithPath: root)
    let real = try realDirectoryPath(root)
    let temp = try systemTemporaryDirectory()
    try require(root == real && url.deletingLastPathComponent().path == temp && url.lastPathComponent.hasPrefix("gamma-ad-") && url.lastPathComponent.count > 9, "root 必须是系统临时目录内的 gamma-ad-* 真实目录")
    try validatePrivateDirectory(root)
    try validatePrivateDirectory(root + "/state")
    // 根内不得包含 symlink，避免引擎读取旧 refs 时逃逸到外部目录。
    if let entries = FileManager.default.enumerator(atPath: root + "/state") {
        var checked = 0
        while let entry = entries.nextObject() as? String {
            checked += 1
            try require(checked <= 20000, "会话目录条目过多")
            let info = try fileInfo(root + "/state/" + entry)
            try require(info.st_mode & S_IFMT != S_IFLNK && info.st_uid == getuid(), "state 不允许符号链接或其他用户文件")
        }
    }
}

let allowedCommands: Set<String> = Set("snapshot find screenshot get is click double-click triple-click right-click type set-value clear focus select toggle check uncheck expand collapse scroll scroll-to press hover drag mouse-move mouse-click mouse-wheel launch close-app list-windows list-displays list-apps focus-window resize-window move-window minimize maximize restore list-surfaces open-system-surface list-notifications dismiss-notification dismiss-all-notifications notification-action clipboard-get clipboard-set clipboard-clear wait status permissions version skills session trace cursor-overlay".split(separator: " ").map(String.init))
func validateArguments(_ arguments: [String]) throws {
    let commandArguments = arguments.first == "--headed" ? Array(arguments.dropFirst()) : arguments
    try require(!commandArguments.isEmpty && allowedCommands.contains(commandArguments[0]), "不支持的 CLI 命令")
    let command = commandArguments[0]
    let subcommands: [String: Set<String>] = ["skills": ["list", "get", "path"], "session": ["list", "start", "end"], "trace": ["show"], "cursor-overlay": ["status", "disable"]]
    if let allowed = subcommands[command] {
        try require(commandArguments.count > 1 && allowed.contains(commandArguments[1]), "不支持的安全子命令")
    }
    try require(arguments.count <= 256 && arguments.reduce(0, { $0 + $1.utf8.count }) <= 256 * 1024, "CLI 参数过大")
    if command == "launch" {
        try require(commandArguments.count >= 2 && !commandArguments[1].contains("/") && !commandArguments[1].hasPrefix("-"), "launch 仅接受应用名称或 bundle identifier")
    }
    if command == "screenshot" {
        // 图片只返回原生 base64；不开放任意输出文件路径。
        let valuedFlags: Set<String> = ["--app", "--window-id", "--screen"]
        var index = 1
        while index < commandArguments.count {
            let argument = commandArguments[index]
            if valuedFlags.contains(argument) { index += 2; try require(index <= commandArguments.count, "screenshot 选项缺少值") }
            else if argument == "--headed" || argument == "--verbose" || argument == "-v" || argument == "--help" { index += 1 }
            else { throw ComponentError.rejected("screenshot 不允许文件路径或未知选项") }
        }
    }
    for argument in arguments {
        try require(!argument.utf8.contains(0), "CLI 参数含 NUL")
        let flag = argument.split(separator: "=", maxSplits: 1).first.map(String.init) ?? argument
        // 运行目录和 session 仅由协议绑定；禁止用户指定额外文件写入和批处理旁路。
        try require(!["--session", "--agent-id", "--trace", "--trace-strict", "--screenshot", "--debug", "--env", "--cwd", "--arg", "--cdp"].contains(flag), "禁止覆盖会话或任意文件写入：\(flag)")
    }
}
