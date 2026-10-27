import Foundation
import Darwin
import AppKit
import ApplicationServices

struct Envelope: Decodable {
    let id: String, method: String
    private let params: ObjectParams
}
private struct ObjectParams: Decodable {
    struct Key: CodingKey { let stringValue: String; var intValue: Int? { nil }; init?(stringValue: String) { self.stringValue = stringValue }; init?(intValue: Int) { return nil } }
    init(from decoder: Decoder) throws { _ = try decoder.container(keyedBy: Key.self) }
}
struct Request<P: Decodable>: Decodable { let id: String, method: String, params: P }
struct Success<R: Encodable>: Encodable { let id: String; let ok = true; let result: R }
struct Failure: Encodable {
    struct Detail: Encodable { let code: String, message: String; var permission: String? = nil }
    let id: String; let ok = false; let error: Detail
}
struct StoppedEvent: Encodable { let event = "stopped"; let reason: String }
struct StoppedResult: Encodable { let stopped = true }
struct PermissionParams: Decodable { let permission: String }
struct StopParams: Decodable { let reason: String? }
struct Permissions: Encodable { let accessibility: Bool, screen: Bool, listen: Bool, post: Bool }
func hasRequiredComputerPermissions(_ permissions: Permissions) -> Bool { permissions.accessibility }
struct Status: Encodable { let supported: Bool; let permissions: Permissions; let message: String? }
struct Selected: Encodable { let scope = "main-display"; let target: Target? = nil }
struct ImageResult: Encodable { let data: String; let mimeType = "image/png"; let width: Int, height: Int }
struct DisplayResult: Codable { var displayId: UInt32? = nil; let originX: Double, originY: Double, ptWidth: Double, ptHeight: Double, scaledWidth: Int, scaledHeight: Int }
struct ObservationResult: Encodable {
    let observationId: String; let epoch: Int; let image: ImageResult?; let width: Int, height: Int
    let display: DisplayResult?; let ax: String; let targetApp: AppIdentity?; let mode: String?
    init(observationId: String, epoch: Int, image: ImageResult?, width: Int, height: Int, display: DisplayResult?, ax: String, targetApp: AppIdentity?) {
        self.observationId = observationId; self.epoch = epoch; self.image = image; self.width = width; self.height = height
        self.display = display; self.ax = ax; self.targetApp = targetApp; self.mode = image == nil ? "accessibility" : nil
    }
}
struct ResolveAppParams: Decodable { let appName: String }
struct ResolvedApp: Encodable { let appName: String, bundleId: String; let pid: Int32?; let processIdentity: String? }
struct ListedApp: Encodable { let appName: String, bundleId: String; let pid: Int32?; let isRunning: Bool }
struct AppListResult: Encodable { let apps: [ListedApp]; let scope = "running-regular-apps" }
struct AppIdentity: Codable, Equatable { let name: String, bundleId: String; let pid: Int32; let processIdentity: String }
struct WindowListResult: Encodable { let windows: [Target] }
struct ElementContext: Encodable, Equatable {
    let role: String?, subrole: String?, title: String?, description: String?
    let isSecure: Bool
    /** 原生确认位于浏览器chrome，而非AXWebArea网页内容。 */
    let isTrustedSearch: Bool
}
struct PreparationResult: Encodable { let preparationId: String, appName: String, bundleId: String; let context: ElementContext }
struct ConfirmationParams: Decodable { let leaseId: String; let epoch: Int; let preparationId: String; let waiting: Bool }
struct ConfirmationResult: Encodable { let waiting: Bool }

final class ProtocolWriter {
    private let queue = DispatchQueue(label: "com.gamma.computer-use.stdout")
    private let mutex = NSLock()
    private var pendingBytes = 0
    var onBrokenPipe: () -> Void = {}
    func emit<T: Encodable>(_ value: T) {
        guard var data = try? JSONEncoder().encode(value), data.count <= 24 * 1024 * 1024 else { onBrokenPipe(); return }
        data.append(10)
        mutex.lock(); pendingBytes += data.count; let overflow = pendingBytes > 32 * 1024 * 1024; mutex.unlock()
        guard !overflow else { onBrokenPipe(); return }
        queue.async { [self] in
            let success = data.withUnsafeBytes { buffer -> Bool in
                guard let base = buffer.baseAddress else { return false }
                var offset = 0
                while offset < data.count {
                    let count = Darwin.write(STDOUT_FILENO, base.advanced(by: offset), data.count - offset)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { return false }; offset += count
                }
                return true
            }
            mutex.lock(); pendingBytes -= data.count; mutex.unlock()
            if !success { onBrokenPipe() }
        }
    }
    func success<T: Encodable>(_ id: String, _ value: T) { emit(Success(id: id, result: value)) }
    func failure(_ id: String, _ error: Error) {
        let e = error as? NativeFailure ?? NativeFailure("native-failure", "原生操作失败（未输出敏感系统错误）")
        emit(Failure(id: id, error: Failure.Detail(code: e.code, message: e.message, permission: e.permission)))
    }
}

struct JSONLFrameBuffer {
    private var pending = Data()
    mutating func append(_ bytes: ArraySlice<UInt8>, onLine: (Data) -> Void) throws {
        for byte in bytes {
            if byte == 10 {
                if !pending.isEmpty { onLine(pending) }; pending.removeAll(keepingCapacity: true)
            } else {
                guard pending.count < 1024 * 1024 else { throw NativeFailure("input-too-large", "单行输入超过1MiB") }
                pending.append(byte)
            }
        }
    }
}
final class JSONLReader {
    let onLine: (Data) -> Void
    let onEnd: () -> Void
    init(onLine: @escaping (Data) -> Void, onEnd: @escaping () -> Void) { self.onLine = onLine; self.onEnd = onEnd }
    func start() {
        Thread.detachNewThread { [self] in
            var frames = JSONLFrameBuffer(), bytes = [UInt8](repeating: 0, count: 8192)
            while true {
                let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { onEnd(); return }
                do { try frames.append(bytes.prefix(count), onLine: onLine) }
                catch { onEnd(); return }
            }
        }
    }
}

func currentPermissionsDict() -> [String: Bool] {
    return [
        "accessibility": AXIsProcessTrusted(),
        "screen": CGPreflightScreenCaptureAccess(),
        "listen": CGPreflightListenEventAccess(),
        "post": CGPreflightPostEventAccess()
    ]
}

func currentFrontmostAppDict() -> [String: Any]? {
    guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
    var dict: [String: Any] = ["pid": app.processIdentifier]
    if let name = app.localizedName { dict["name"] = name }
    if let bundleId = app.bundleIdentifier { dict["bundleId"] = bundleId }
    return dict
}

func describeAXElementInfo(_ element: AXUIElement?) -> [String: Any]? {
    guard let element = element else { return nil }
    var dict: [String: Any] = [:]
    AXUIElementSetMessagingTimeout(element, 0.08)
    var roleVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleVal) == .success, let role = roleVal as? String {
        dict["role"] = role
    }
    var subroleVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subroleVal) == .success, let subrole = subroleVal as? String {
        dict["subrole"] = subrole
    }
    var titleVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleVal) == .success, let title = titleVal as? String {
        dict["title"] = String(title.prefix(128))
    }
    var identifierVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &identifierVal) == .success, let identifier = identifierVal as? String {
        dict["identifier"] = String(identifier.prefix(128))
    }
    var positionVal: AnyObject?, sizeVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionVal) == .success,
       AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeVal) == .success,
       let positionVal = positionVal, let sizeVal = sizeVal,
       CFGetTypeID(positionVal) == AXValueGetTypeID(), CFGetTypeID(sizeVal) == AXValueGetTypeID() {
        var point = CGPoint.zero, size = CGSize.zero
        if AXValueGetValue(unsafeBitCast(positionVal, to: AXValue.self), .cgPoint, &point),
           AXValueGetValue(unsafeBitCast(sizeVal, to: AXValue.self), .cgSize, &size),
           point.x.isFinite, point.y.isFinite, size.width.isFinite, size.height.isFinite {
            dict["frame"] = ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
        }
    }
    return dict
}

func currentSystemFocusedElementDict() -> [String: Any]? {
    let system = AXUIElementCreateSystemWide()
    var raw: AnyObject?
    if AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &raw) == .success,
       let raw = raw, CFGetTypeID(raw) == AXUIElementGetTypeID() {
        let el = unsafeBitCast(raw, to: AXUIElement.self)
        return describeAXElementInfo(el)
    }
    return nil
}

private let nativeLogQueue = DispatchQueue(label: "com.gamma.computer-use.native-logger")

// 使用追加模式避免不同进程同时写入时互相覆盖；日志失败不影响桌面操作。
private func appendNativeLog(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload), data.count < 1024 * 1024 else { return }
    var line = data
    line.append(10)
    let environment = ProcessInfo.processInfo.environment
    let path = environment["GAMMA_COMPUTER_LOG_PATH"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Gamma/computer-use.log").path
    let file = URL(fileURLWithPath: path)
    do { try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true) }
    catch { return }
    let descriptor = open(file.path, O_WRONLY | O_CREAT | O_APPEND, mode_t(0o600))
    guard descriptor >= 0 else { return }
    defer { close(descriptor) }
    line.withUnsafeBytes { buffer in
        guard let base = buffer.baseAddress else { return }
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.write(descriptor, base.advanced(by: offset), buffer.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return }
            offset += count
        }
    }
}

func writeNativeLoggerReady() {
    appendNativeLog([
        "event": "logger-ready",
        "process": "native",
        "version": ProcessInfo.processInfo.environment["GAMMA_APP_VERSION"] ?? "unknown",
        "pid": getpid()
    ])
}

func writeNativeComputerUseLog(
    location: String,
    action: String? = nil,
    rawError: String? = nil,
    errorCode: String? = nil,
    targetApp: [String: Any]? = nil,
    frontmostApp: [String: Any]? = nil,
    focusedElement: [String: Any]? = nil
) {
    nativeLogQueue.async {
        let permissions = currentPermissionsDict()
        let frontApp = frontmostApp ?? currentFrontmostAppDict()
        let focus = focusedElement ?? currentSystemFocusedElementDict()

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let timeStr = formatter.string(from: Date())

        var payload: [String: Any] = [
            "time": timeStr,
            "source": "native-helper",
            "location": location,
            "permissions": permissions
        ]
        if let action = action { payload["action"] = action }
        if let rawError = rawError { payload["rawError"] = rawError }
        if let errorCode = errorCode { payload["errorCode"] = errorCode }
        if let targetApp = targetApp { payload["targetApp"] = targetApp }
        if let frontApp = frontApp { payload["frontmostApp"] = frontApp }
        if let focus = focus { payload["focusedElement"] = focus }

        appendNativeLog(payload)
    }
}
