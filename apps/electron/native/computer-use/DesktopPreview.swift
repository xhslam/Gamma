import AppKit
import ScreenCaptureKit
import CoreImage
import Carbon

struct PreviewParams: Decodable {
    let leaseId: String, epoch: Int, enabled: Bool
    let frameId: String?
}
struct PreviewFrame: Encodable {
    let frameId: String, capturedAt: Double, width: Int, height: Int
    let data: String?
}
struct PreviewResult: Encodable {
    let mode: String
    let frame: PreviewFrame?
}

/// 独立于观察/AX/动作队列的本地视频流；只保留最新一帧，不录音、不保存文件。
final class DesktopPreview: NSObject, SCStreamOutput, SCStreamDelegate {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.gamma.computer-use.preview", qos: .userInitiated)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private var timer: DispatchSourceTimer?
    private var stream: SCStream?
    private var generation: UInt64 = 0
    private var fence: UInt64?
    private var live = false
    private var failedUntil: TimeInterval = 0
    private var lastDemand: TimeInterval = 0
    private var frame: PreviewFrame?
    private var validate: () -> Bool = { false }

    override init() {
        super.init()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let expired = self.fence != nil && ProcessInfo.processInfo.systemUptime - self.lastDemand > 1.5
            self.lock.unlock()
            if expired { self.stop() }
        }
        timer.resume(); self.timer = timer
    }
    deinit { timer?.cancel(); stream?.stopCapture(completionHandler: nil) }
    func stop() {
        lock.lock()
        generation &+= 1
        let old = stream
        stream = nil; fence = nil; live = false; frame = nil; validate = { false }
        lock.unlock()
        old?.stopCapture(completionHandler: nil)
    }
    func read(_ p: PreviewParams, token: UInt64, gate: SafetyGate) throws -> PreviewResult {
        try gate.check(token)
        if !p.enabled { stop(); return PreviewResult(mode: "paused", frame: nil) }
        guard CGPreflightScreenCaptureAccess(), !IsSecureEventInputEnabled() else {
            stop(); return PreviewResult(mode: "unavailable", frame: nil)
        }
        let now = ProcessInfo.processInfo.systemUptime
        lock.lock()
        lastDemand = now
        if failedUntil > now { lock.unlock(); return PreviewResult(mode: "unavailable", frame: nil) }
        let shouldStart = fence != token
        if shouldStart { generation &+= 1; fence = token; frame = nil; live = false }
        let version = generation
        let result = PreviewResult(mode: live ? "live" : "starting", frame: frame.map {
            PreviewFrame(frameId: $0.frameId, capturedAt: $0.capturedAt, width: $0.width, height: $0.height, data: p.frameId == $0.frameId ? nil : $0.data)
        })
        let validateCurrent = validate
        let wasLive = live
        lock.unlock()
        if wasLive && !validateCurrent() { fail(version); return PreviewResult(mode: "unavailable", frame: nil) }
        if shouldStart { start(version, token: token, gate: gate) }
        return result
    }
    private func fail(_ version: UInt64) {
        lock.lock()
        guard generation == version else { lock.unlock(); return }
        let old = stream
        generation &+= 1; stream = nil; fence = nil; frame = nil; live = false
        failedUntil = ProcessInfo.processInfo.systemUptime + 2
        lock.unlock()
        old?.stopCapture(completionHandler: nil)
    }
    private func start(_ version: UInt64, token: UInt64, gate: SafetyGate) {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { [weak self] content, error in
            guard let self else { return }
            let displayId = CGMainDisplayID(), bounds = CGDisplayBounds(CGMainDisplayID())
            guard error == nil, let content, let display = content.displays.first(where: { $0.displayID == displayId }),
                  (try? gate.check(token)) != nil, CGPreflightScreenCaptureAccess() else { self.fail(version); return }
            let filter = SCContentFilter(display: display, excludingApplications: content.applications.filter { isGammaPID($0.processID) }, exceptingWindows: [])
            let config = SCStreamConfiguration()
            let (width, height) = captureDimensions(width: bounds.width, height: bounds.height, maxEdge: 960)
            config.width = width; config.height = height
            config.minimumFrameInterval = CMTime(value: 1, timescale: 10)
            config.queueDepth = 3; config.showsCursor = true; config.capturesAudio = false
            config.pixelFormat = kCVPixelFormatType_32BGRA; config.scalesToFit = true
            let candidate = SCStream(filter: filter, configuration: config, delegate: self)
            do { try candidate.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue) }
            catch { self.fail(version); return }
            self.lock.lock()
            guard self.generation == version, self.fence == token else { self.lock.unlock(); return }
            self.stream = candidate
            self.validate = { (try? gate.check(token)) != nil && CGPreflightScreenCaptureAccess() && !IsSecureEventInputEnabled()
                && CGMainDisplayID() == displayId && CGDisplayBounds(displayId) == bounds }
            // 在独立串行队列提交；停止后的迟到启动回调必须再次关闭，不复活旧流。
            self.queue.async { candidate.startCapture { [weak self] error in
                guard let self else { return }
                if error != nil { self.fail(version); return }
                self.lock.lock()
                if self.generation == version { self.live = true }
                let stale = self.generation != version
                self.lock.unlock()
                if stale { candidate.stopCapture(completionHandler: nil) }
            } }
            self.lock.unlock()
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lock.lock(); let version = generation; let current = self.stream === stream; lock.unlock()
        if current { fail(version) }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        lock.lock(); let version = generation; let current = self.stream === stream; let valid = validate; lock.unlock()
        guard current else { return }
        guard valid() else { fail(version); return }
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = attachments.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw) else { return }
        if status == .idle || status == .started { return }
        guard status == .complete else { fail(version); return }
        guard let buffer = sampleBuffer.imageBuffer else { return }
        autoreleasepool {
            let image = CIImage(cvPixelBuffer: buffer)
            guard let cgImage = context.createCGImage(image, from: image.extent),
                  let jpeg = NSBitmapImageRep(cgImage: cgImage).representation(using: .jpeg, properties: [.compressionFactor: 0.7]),
                  jpeg.count <= 512 * 1024, valid() else { return }
            let next = PreviewFrame(frameId: UUID().uuidString, capturedAt: Date().timeIntervalSince1970 * 1000,
                                    width: cgImage.width, height: cgImage.height, data: jpeg.base64EncodedString())
            lock.lock()
            if generation == version, self.stream === stream { frame = next }
            lock.unlock()
        }
    }
}
