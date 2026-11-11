import Foundation
import Security
import Darwin

@_silgen_name("proc_pidpath") private func nativePIDPath(_ pid: Int32, _ buffer: UnsafeMutableRawPointer, _ size: UInt32) -> Int32

func executablePath(_ pid: pid_t) throws -> String {
    var bytes = [CChar](repeating: 0, count: 4096)
    let count = nativePIDPath(pid, &bytes, UInt32(bytes.count))
    try require(count > 0, "无法读取进程路径")
    return String(cString: bytes)
}
func parentPID(_ pid: pid_t) throws -> pid_t {
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.size
    try require(sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 && size > 0, "无法核验父进程")
    try require(info.kp_eproc.e_ucred.cr_uid == getuid(), "进程用户不匹配")
    return info.kp_eproc.e_ppid
}
func signedHash(_ code: SecCode) throws -> Data {
    try require(SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess, "运行进程签名无效")
    var staticCode: SecStaticCode?
    try require(SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, "无法读取运行代码静态签名")
    guard let staticCode else { throw ComponentError.rejected("运行代码静态签名为空") }
    var information: CFDictionary?
    try require(SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess, "无法读取签名")
    guard let hash = (information as? [String: AnyObject])?[kSecCodeInfoUnique as String] as? Data else { throw ComponentError.rejected("缺少代码签名 hash") }
    return hash
}
func diskHash(_ path: String) throws -> Data {
    var code: SecStaticCode?
    try require(SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &code) == errSecSuccess, "无法读取磁盘签名")
    guard let code else { throw ComponentError.rejected("签名对象为空") }
    try require(SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode), nil) == errSecSuccess, "磁盘签名完整性校验失败")
    var info: CFDictionary?
    try require(SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess, "无法读取磁盘签名信息")
    guard let hash = (info as? [String: AnyObject])?[kSecCodeInfoUnique as String] as? Data else { throw ComponentError.rejected("磁盘签名缺少 hash") }
    return hash
}
func processHash(_ pid: pid_t) throws -> Data {
    var code: SecCode?
    let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
    try require(SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess, "无法读取运行进程签名")
    guard let code else { throw ComponentError.rejected("运行签名对象为空") }
    return try signedHash(code)
}
func ownIdentity() throws -> String {
    let hash = try processHash(getpid())
    try require(hash == diskHash(Bundle.main.bundleURL.path), "组件磁盘与运行签名不一致")
    try require(Bundle.main.bundleIdentifier == "com.gamma.computeruse", "组件 bundle identity 无效")
    return hash.map { String(format: "%02x", $0) }.joined()
}
func peerPID(_ fd: Int32) throws -> pid_t {
    var uid: uid_t = 0
    var gid: gid_t = 0
    try require(getpeereid(fd, &uid, &gid) == 0 && uid == getuid(), "IPC 对端用户不匹配")
    var pid: pid_t = 0
    var size = socklen_t(MemoryLayout<pid_t>.size)
    try require(getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0 && pid > 1, "无法核验 IPC 对端 PID")
    return pid
}
func authenticatePeer(_ fd: Int32, requireGammaParent: Bool) throws {
    let pid = try peerPID(fd)
    let ownPath = try executablePath(getpid())
    try require(executablePath(pid) == ownPath, "IPC 对端必须来自同一组件路径")
    try require(processHash(pid) == processHash(getpid()), "IPC 对端组件签名不一致")
    if requireGammaParent {
        let parent = try parentPID(pid)
        let path = try executablePath(parent)
        try require(path == "/Applications/Gamma.app/Contents/MacOS/Gamma", "代理必须由已安装的 Gamma 主进程启动")
        // 同时验证运行签名和固定路径的完整磁盘签名；不接受仅路径或 token。
        try require(processHash(parent) == diskHash(path), "Gamma 父进程签名与磁盘不一致")
        try require(try parentPID(pid) == parent, "代理父进程在校验期间发生变化")
    }
}
