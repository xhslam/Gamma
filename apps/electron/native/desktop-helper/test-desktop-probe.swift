import Foundation
import CoreGraphics
import ScreenCaptureKit
import ApplicationServices
import Carbon.HIToolbox

// Phase 0 探针，不是生产控制器。默认仅自测，不截图、不枚举窗口、不监听或注入事件。
// 标记只用于来源区分，不是签名；其他进程可以伪造它，不能作为授权凭证。
private let gammaMagicTag: Int64 = 0x47414D4D41555345
private let requiredGateIDs = [
    "live-event-tap", "live-preemption", "live-occlusion",
    "live-capture-alignment", "live-ax-raise"
]

private enum Status: String, Codable { case pass = "PASS", fail = "FAIL", blocked = "BLOCKED", skip = "SKIP" }
private struct Check: Codable {
    let id: String
    let status: Status
    let evidence: String
    let detail: String
}
private struct Report: Encodable {
    let schemaVersion = 2
    let timestamp = ISO8601DateFormatter().string(from: Date())
    let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
    let architecture: String
    let runMode: String
    let phase0Ready: Bool
    let results: [Check]
}

// 本地状态逻辑与回调共用；真实 helper 应在独立安全 run loop 中使用并提供同步/原子门禁。
private struct SafetyLatch {
    var preempted = false
    var disabled = false
    var ownEvents = 0
    mutating func receive(tag: Int64, pid: Int64) {
        if tag == gammaMagicTag && pid == Int64(getpid()) { ownEvents += 1 }
        else { preempted = true }
    }
    mutating func listenerDisabled() { disabled = true; preempted = true }
    var mayDispatch: Bool { !preempted && !disabled }
}

private struct WindowGeometry {
    let bounds: CGRect
    let alpha: Double
}
private func validRect(_ rect: CGRect) -> Bool {
    [rect.origin.x, rect.origin.y, rect.width, rect.height].allSatisfy { $0.isFinite }
        && rect.width > 0 && rect.height > 0
}
// 矩形元数据是保守拒绝依据，不是像素可见性证明。未知值不得 continue 后放行。
private func geometryBlocks(_ windows: [WindowGeometry?], at point: CGPoint) -> Bool {
    guard point.x.isFinite && point.y.isFinite else { return true }
    for candidate in windows {
        guard let window = candidate, validRect(window.bounds), window.alpha.isFinite,
              window.alpha >= 0 && window.alpha <= 1 else { return true }
        if window.alpha > 0 && window.bounds.contains(point) { return true }
    }
    return false
}
private func mapLocalPoint(_ local: CGPoint, bounds: CGRect) -> CGPoint? {
    guard validRect(bounds), local.x.isFinite, local.y.isFinite,
          local.x >= 0, local.y >= 0, local.x < bounds.width, local.y < bounds.height else { return nil }
    return CGPoint(x: bounds.origin.x + local.x, y: bounds.origin.y + local.y)
}
private func logicCheck(_ id: String, _ passed: Bool, _ detail: String) -> Check {
    Check(id: id, status: passed ? .pass : .fail, evidence: "logic", detail: detail)
}
private func selfTests() -> [Check] {
    var own = SafetyLatch()
    own.receive(tag: gammaMagicTag, pid: Int64(getpid()))
    var human = own
    human.receive(tag: 0, pid: 0)
    human.receive(tag: gammaMagicTag, pid: Int64(getpid()))
    var disabled = own
    disabled.listenerDisabled()
    var wrongPID = SafetyLatch()
    wrongPID.receive(tag: gammaMagicTag, pid: Int64(getpid()) + 1)
    let bounds = CGRect(x: -1920, y: -200, width: 800, height: 600)
    let at = CGPoint(x: 10, y: 20)
    let tagged = CGEvent(source: nil)
    tagged?.setIntegerValueField(.eventSourceUserData, value: gammaMagicTag)
    return [
        logicCheck("tag-field-roundtrip", tagged?.getIntegerValueField(.eventSourceUserData) == gammaMagicTag,
                   "仅在内存 CGEvent 对象写入和读取字段，未 post，不能证明事件穿过真实 Tap 后仍保留标记"),
        logicCheck("self-event-classification", own.ownEvents == 1 && own.mayDispatch && wrongPID.preempted,
                   "本地来源分类逻辑通过；标记和 PID 都不是不可伪造的认证"),
        logicCheck("preemption-latched", human.preempted && !human.mayDispatch,
                   "模拟外部输入后保持闭锁，后续自有事件不能恢复；不是实机接管时延测试"),
        logicCheck("tap-disabled-latched", disabled.disabled && !disabled.mayDispatch,
                   "模拟监听失活后闭锁；重启监听不得自动恢复授权"),
        logicCheck("geometry-fail-closed",
                   geometryBlocks([nil], at: at)
                    && geometryBlocks([WindowGeometry(bounds: CGRect(x: 0, y: 0, width: 100, height: 100), alpha: 0.01)], at: at)
                    && !geometryBlocks([WindowGeometry(bounds: CGRect(x: 0, y: 0, width: 100, height: 100), alpha: 0)], at: at)
                    && geometryBlocks([WindowGeometry(bounds: bounds, alpha: .nan)], at: at),
                   "合成矩形用例：缺失/无效元数据拒绝，半透明重叠也拒绝；未查询真实窗口或验证遮挡准确率"),
        logicCheck("local-point-transform",
                   mapLocalPoint(at, bounds: bounds) == CGPoint(x: -1910, y: -180)
                    && mapLocalPoint(CGPoint(x: 800, y: 0), bounds: bounds) == nil
                    && mapLocalPoint(CGPoint(x: CGFloat.nan, y: 0), bounds: bounds) == nil,
                   "窗口局部 points 到负坐标全局 points 的纯函数验证；像素缩放/裁剪/Retina 捕获映射仍待测")
    ]
}

private func configurationChecks() -> [Check] {
    var results: [Check] = []
    if #available(macOS 14.0, *) {
        let config = SCStreamConfiguration()
        config.ignoreShadowsSingleWindow = true
        config.capturesAudio = false
        results.append(Check(id: "sck-shadow-configuration", status: config.ignoreShadowsSingleWindow ? .pass : .fail,
                             evidence: "configuration", detail: "配置属性可写可读，未实际捕获图像；不能证明图像尺寸、无阴影或坐标对齐"))
    } else {
        results.append(Check(id: "sck-shadow-configuration", status: .blocked, evidence: "configuration", detail: "需要 macOS 14+"))
    }
    results.append(Check(id: "ax-symbol-availability",
                         status: (kAXRaiseAction as String) == "AXRaise" && (kAXMainAttribute as String) == "AXMain" ? .pass : .fail,
                         evidence: "configuration", detail: "仅确认公开常量可链接；未调用 AXRaise，未验证提窗、主窗口或焦点"))
    return results
}
private func permissionChecks() -> [Check] {
    let permissions = [
        ("permission-ax", AXIsProcessTrusted()),
        ("permission-screen", CGPreflightScreenCaptureAccess()),
        ("permission-listen", CGPreflightListenEventAccess()),
        ("permission-post", CGPreflightPostEventAccess())
    ]
    return permissions.map { id, granted in
        Check(id: id, status: granted ? .pass : .blocked, evidence: "permission",
              detail: granted ? "只读 preflight 返回已授权；不代表该能力已完成实机验证" : "preflight 未授权；不请求权限，不执行对应操作")
    } + [Check(id: "secure-input-inactive", status: IsSecureEventInputEnabled() ? .blocked : .pass,
               evidence: "configuration", detail: "仅反映当前安全输入状态，不是权限授权，也不保证后续状态不变") ]
}

// 所有回调分支使用同一种真实对象，不将 Bool tuple 错误 reinterpret 为 CFMachPort。
private final class TapContext {
    var tap: CFMachPort?
    var latch = SafetyLatch()
}
private func liveEventTap() -> Check {
    guard geteuid() != 0 else {
        return Check(id: "live-event-tap", status: .blocked, evidence: "integration", detail: "该验证必须在普通用户而非 root 下执行")
    }
    guard !IsSecureEventInputEnabled() else {
        return Check(id: "live-event-tap", status: .blocked, evidence: "integration", detail: "安全键盘输入已启用，禁止监听和投递")
    }
    guard CGPreflightListenEventAccess(), CGPreflightPostEventAccess() else {
        return Check(id: "live-event-tap", status: .blocked, evidence: "integration", detail: "缺少监听或事件发布权限；没有创建 Tap 或注入事件")
    }
    let context = TapContext()
    let callback: CGEventTapCallBack = { _, type, event, refcon in
        guard let refcon else { return Unmanaged.passUnretained(event) }
        let state = Unmanaged<TapContext>.fromOpaque(refcon).takeUnretainedValue()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            state.latch.listenerDisabled()
            // 只恢复监听，安全门保持锁存。生产控制器还须由人类明确重新授权。
            if type == .tapDisabledByTimeout, let tap = state.tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return Unmanaged.passUnretained(event)
        }
        state.latch.receive(tag: event.getIntegerValueField(.eventSourceUserData),
                            pid: event.getIntegerValueField(.eventSourceUnixProcessID))
        return Unmanaged.passUnretained(event)
    }
    let types: [CGEventType] = [.mouseMoved, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                                .otherMouseDown, .otherMouseUp, .leftMouseDragged, .rightMouseDragged,
                                .otherMouseDragged, .scrollWheel, .keyDown, .keyUp, .flagsChanged]
    let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
    return withExtendedLifetime(context) {
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                         eventsOfInterest: mask, callback: callback,
                                         userInfo: Unmanaged.passUnretained(context).toOpaque()) else {
            return Check(id: "live-event-tap", status: .blocked, evidence: "integration", detail: "Session listen-only Tap 创建失败；不能声称监听可用")
        }
        context.tap = tap
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap)
            return Check(id: "live-event-tap", status: .fail, evidence: "integration", detail: "Tap run loop source 创建失败")
        }
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .defaultMode)
        defer {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .defaultMode)
            CFMachPortInvalidate(tap)
            context.tap = nil
        }
        CGEvent.tapEnable(tap: tap, enable: true)
        guard CGEvent.tapIsEnabled(tap: tap), let current = CGEvent(source: nil),
              let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: current.location, mouseButton: .left),
              context.latch.mayDispatch else {
            return Check(id: "live-event-tap", status: .fail, evidence: "integration", detail: "Tap 不健康或无法构造事件，零注入")
        }
        event.setIntegerValueField(.eventSourceUserData, value: gammaMagicTag)
        event.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        // 仅 explicit live+ack 模式到达这里：在当前指针位置投递一次 mouseMoved，可能影响 hover。
        event.post(tap: .cgSessionEventTap)
        CFRunLoopRunInMode(.defaultMode, 0.35, false)
        let passed = context.latch.ownEvents > 0 && context.latch.mayDispatch && CGEvent.tapIsEnabled(tap: tap)
        return Check(id: "live-event-tap", status: passed ? .pass : .fail, evidence: "integration",
                     detail: "350ms 有界单次投递验证（不是长期稳定性测试）：taggedEvents=\(context.latch.ownEvents), preempted=\(context.latch.preempted), tapDisabled=\(context.latch.disabled)。未收到标记或监听失活不得 PASS；不代表长期稳定性或防伪认证")
    }
}

@main
private struct DesktopProbeMain {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        let allowed: Set<String> = ["--self-test", "--preflight", "--live-event-tap", "--acknowledge-desktop-input"]
        let modes = args.filter { ["--self-test", "--preflight", "--live-event-tap"].contains($0) }
        let live = modes.first == "--live-event-tap"
        guard args.allSatisfy({ allowed.contains($0) }), Set(args).count == args.count, modes.count <= 1,
              live == args.contains("--acknowledge-desktop-input") else {
            fputs("参数错误：默认 --self-test；--preflight 只读；--live-event-tap 必须同时提供 --acknowledge-desktop-input。\n", stderr)
            exit(2)
        }
        let mode = modes.first?.replacingOccurrences(of: "--", with: "") ?? "self-test"
        var results = selfTests() + configurationChecks()
        if mode != "self-test" { results += permissionChecks() }
        if live { results.append(liveEventTap()) }
        for id in requiredGateIDs where !results.contains(where: { $0.id == id }) {
            results.append(Check(id: id, status: .skip, evidence: "integration",
                                 detail: "未执行真实验证；需要独立 fixture、目标/权限/操作明确授权与可复核证据"))
        }
        let ready = !results.contains { $0.status == .fail } && requiredGateIDs.allSatisfy { id in results.contains { $0.id == id && $0.status == .pass && $0.evidence == "integration" } }
        #if arch(arm64)
        let arch = "arm64"
        #elseif arch(x86_64)
        let arch = "x86_64"
        #else
        let arch = "unknown"
        #endif
        let report = Report(architecture: arch, runMode: mode, phase0Ready: ready, results: results)
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(report)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([10]))
        } catch {
            fputs("探针报告编码失败\n", stderr)
            exit(1)
        }
        exit(results.contains { $0.status == .fail } ? 1 : 0)
    }
}
