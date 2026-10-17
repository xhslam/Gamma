import Foundation
import Darwin

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
    struct Detail: Encodable { let code: String, message: String }
    let id: String; let ok = false; let error: Detail
}
struct StoppedEvent: Encodable { let event = "stopped"; let reason: String }
struct StoppedResult: Encodable { let stopped = true }
struct PermissionParams: Decodable { let permission: String }
struct StopParams: Decodable { let reason: String? }
struct Permissions: Encodable { let accessibility: Bool, screen: Bool, listen: Bool, post: Bool }
struct Status: Encodable { let supported: Bool; let permissions: Permissions; let message: String? }
struct Selected: Encodable { let scope = "main-display"; let target: Target? = nil }
struct ImageResult: Encodable { let data: String; let mimeType = "image/png"; let width: Int, height: Int }
struct DisplayResult: Codable { var displayId: UInt32? = nil; let originX: Double, originY: Double, ptWidth: Double, ptHeight: Double, scaledWidth: Int, scaledHeight: Int }
struct ObservationResult: Encodable { let observationId: String; let epoch: Int; let image: ImageResult; let display: DisplayResult?; let ax: String; let targetApp: AppIdentity? }
struct ResolveAppParams: Decodable { let appName: String }
struct ResolvedApp: Encodable { let appName: String, bundleId: String; let pid: Int32?; let processIdentity: String? }
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
        emit(Failure(id: id, error: Failure.Detail(code: e.code, message: e.message)))
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
