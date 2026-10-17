import Foundation
import CoreGraphics

// 离线自测绝不实例化NSApplication、LAContext、Engine或任何系统权限/窗口API。
func runSelfTests() throws -> Int {
    var count = 0
    func expect(_ condition: @autoclosure () -> Bool, _ name: String) throws {
        guard condition() else { throw NativeFailure("self-test", name) }; count += 1
    }
    func rejects(_ name: String, _ body: () throws -> Void) throws {
        do { try body() } catch { count += 1; return }
        throw NativeFailure("self-test", name)
    }
    for bundle in ["com.apple.Terminal", "com.googlecode.iterm2", "com.agilebits.onepassword7", "com.microsoft.VSCode", "com.apple.systempreferences"] {
        try expect(forbiddenTargetBundle(bundle), "Given已知执行或敏感应用，Then不可选择")
    }
    try expect(!forbiddenTargetBundle("test.fixture"), "Given普通fixture标识，Then仍需完整窗口验证而非全局拒绝")
    try expect(isUnscopedAXSurface(role: "AXSheet", subrole: "", depth: 1), "Given附属sheet，Then不继承窗口授权")
    try expect(isUnscopedAXSurface(role: "AXWindow", subrole: "AXDialog", depth: 2), "Given附属对话框，Then拒绝读取及引用")
    try expect(!isUnscopedAXSurface(role: "AXWindow", subrole: "", depth: 0), "Given所选根窗口，Then允许验证")
    var now: TimeInterval = 100
    let gate = SafetyGate(clock: { now })
    let lease = LeaseParams(leaseId: "lease-a", epoch: 7, deadline: 61_000)
    let target = Target(windowId: 5, pid: 123, processIdentity: "123:start", bundleId: "test.fixture", title: "Fixture", bounds: Rect(CGRect(x: -100, y: 30, width: 1000, height: 500)))
    let token = try gate.begin(lease, wallNow: 1000)
    try gate.finishSelection(target, token: token)
    try rejects("Given未启动监听，Then不能观察") { _ = try gate.current(BoundParams(leaseId: "lease-a", epoch: 7)) }
    gate.setListenerHealthy(true)
    let currentTarget = try gate.current(BoundParams(leaseId: "lease-a", epoch: 7)).0
    try expect(currentTarget == target, "Given有效租约，Then返回唯一目标")
    try rejects("Given跨epoch请求，Then拒绝") { _ = try gate.current(BoundParams(leaseId: "lease-a", epoch: 8)) }
    try rejects("Given跨lease请求，Then拒绝") { _ = try gate.current(BoundParams(leaseId: "other", epoch: 7)) }
    let snapshot = Snapshot(id: "obs-1", epoch: 7, fence: token, created: now, target: target, width: 2000, height: 1000, axDigest: "layout-a")
    let center = try snapshot.point(x: 1000, y: 500)
    try expect(center.x == 400 && center.y == 280, "GivenRetina图像与负坐标屏幕，Then按points换算")
    try rejects("Given右边界坐标，Then拒绝") { _ = try snapshot.point(x: 2000, y: 0) }
    try rejects("Given负坐标，Then拒绝") { _ = try snapshot.point(x: -1, y: 0) }
    try rejects("GivenNaN坐标，Then拒绝") { _ = try snapshot.point(x: .nan, y: 0) }
    let action = Action(kind: "axPress", observationId: "obs-1", x: nil, y: nil, text: nil, key: nil, deltaY: nil, elementRef: "opaque")
    let request = PerformParams(leaseId: "lease-a", epoch: 7, actionId: "once", action: action)
    try gate.save(snapshot); _ = try gate.prepare(request); try gate.approve(request, snapshot: snapshot)
    try rejects("Given已消费观察，Then不能重放") { _ = try gate.prepare(PerformParams(leaseId: "lease-a", epoch: 7, actionId: "again", action: action)) }
    try gate.save(snapshot)
    try rejects("Given重复actionId，Then拒绝") { _ = try gate.prepare(request) }
    let next = PerformParams(leaseId: "lease-a", epoch: 7, actionId: "later", action: action)
    _ = try gate.prepare(next); gate.stop()
    try rejects("Given用户停止后确认迟到，Then永不恢复授权") { try gate.approve(next, snapshot: snapshot) }
    try rejects("Given旧fence，Then检查拒绝") { try gate.check(token) }
    try expect(!gate.stop(), "Given已停止，Thenstop幂等")
    try rejects("Given期限超过30分钟，Then拒绝") { _ = try gate.begin(LeaseParams(leaseId: "bad", epoch: 1, deadline: 1_801_001), wallNow: 1000) }
    try rejects("Given非有限deadline，Then拒绝") { _ = try gate.begin(LeaseParams(leaseId: "bad", epoch: 1, deadline: .infinity), wallNow: 1000) }
    let token2 = try gate.begin(lease, wallNow: 1000); try gate.finishSelection(target, token: token2); gate.setListenerHealthy(true)
    let s2 = Snapshot(id: "obs-1", epoch: 7, fence: token2, created: now, target: target, width: 100, height: 50, axDigest: "a")
    try gate.save(s2); now += 31
    try rejects("Given超过30秒的观察，Then拒绝动作") { _ = try gate.prepare(request) }
    now += 30
    try expect(gate.expired, "Given单调时钟超过租约，Then判为过期")
    try rejects("Given租约过期，Then拒绝观察") { _ = try gate.current(BoundParams(leaseId: "lease-a", epoch: 7)) }
    gate.stop()
    let token3 = try gate.begin(lease, wallNow: 1000); try gate.finishSelection(target, token: token3); gate.setListenerHealthy(true)
    let s3 = Snapshot(id: "obs-1", epoch: 7, fence: token3, created: now, target: target, width: 100, height: 50, axDigest: "a")
    try gate.save(s3); _ = try gate.prepare(request)
    let mutated = PerformParams(leaseId: "lease-a", epoch: 7, actionId: "once", action: Action(kind: "axPress", observationId: "obs-1", x: nil, y: nil, text: nil, key: nil, deltaY: nil, elementRef: "other"))
    try rejects("Given批准时动作参数被替换，Then拒绝") { try gate.approve(mutated, snapshot: s3) }
    gate.setListenerHealthy(false)
    try rejects("Given监听失活，Then迟到确认拒绝") { try gate.approve(request, snapshot: s3) }
    gate.setListenerHealthy(true); gate.invalidateObservation()
    try rejects("Given布局失效，Then确认拒绝") { try gate.approve(request, snapshot: s3) }
    try gate.startWork(token3); gate.stop()
    try rejects("Given旧worker仍未返回，Then不得启动新租约") { _ = try gate.begin(lease, wallNow: 1000) }
    gate.endWork()
    let token4 = try gate.begin(lease, wallNow: 1000)
    try expect(token4 != token3, "Given重新授权，Thenfence必须前进")
    gate.stop()
    let unicode = "中文👩🏽‍💻🚀"
    let textAction = Action(kind: "type", observationId: "obs", x: nil, y: nil, text: unicode, key: nil, deltaY: nil, elementRef: nil)
    try textAction.validate(); try expect(String(decoding: Array(unicode.utf16), as: UTF16.self) == unicode, "Given复合Unicode，ThenUTF16不拆分")
    try rejects("Given文本超过4096UTF16单元，Then拒绝") { try Action(kind: "type", observationId: "obs", x: nil, y: nil, text: String(repeating: "🚀", count: 2049), key: nil, deltaY: nil, elementRef: nil).validate() }
    try rejects("Given文本含NUL，Then拒绝") { try Action(kind: "type", observationId: "obs", x: nil, y: nil, text: "x\0y", key: nil, deltaY: nil, elementRef: nil).validate() }
    try rejects("Given未列入白名单按键，Then拒绝") { try Action(kind: "key", observationId: "obs", x: nil, y: nil, text: nil, key: "InvalidUnknownKey", deltaY: nil, elementRef: nil).validate() }
    try rejects("Givenscroll缺少坐标，Then拒绝") { try Action(kind: "scroll", observationId: "obs", x: nil, y: nil, text: nil, key: nil, deltaY: 100, elementRef: nil).validate() }
    try rejects("Givenscroll幅度过大，Then拒绝") { try Action(kind: "scroll", observationId: "obs", x: 1, y: 1, text: nil, key: nil, deltaY: 1201, elementRef: nil).validate() }
    try rejects("Givenparams为数组，Then协议拒绝") { _ = try JSONDecoder().decode(Envelope.self, from: Data("{\"id\":\"a\",\"method\":\"status\",\"params\":[]}".utf8)) }
    var posted = 0
    try rejects("Givenstop后进行最终投递，Then不产生事件") { try gate.commitDispatch(ExecutionPermit(nonce: UUID(), fence: token4, until: now + 1)) { posted += 1 } }
    try expect(posted == 0, "Given失效fence，Then投递计数保持零")
    let token5 = try gate.begin(lease, wallNow: 1000); try gate.finishSelection(target, token: token5); gate.setListenerHealthy(true)
    let s5 = Snapshot(id: "obs-1", epoch: 7, fence: token5, created: now, target: target, width: 100, height: 50, axDigest: "a")
    try gate.save(s5); _ = try gate.prepare(request)
    let ticket = try gate.approve(request, snapshot: s5)
    try rejects("Given伪造单次批准票据，Then拒绝") { try gate.claimAX(ExecutionPermit(nonce: UUID(), fence: token5, until: now + 1)) }
    try gate.commitDispatch(ticket) { posted += 1 }
    try rejects("Given同一批准票据重复投递，Then拒绝") { try gate.commitDispatch(ticket) { posted += 1 } }
    try expect(posted == 1, "Given有效fence，Then单次同步提交")
    try expect(gate.monitorsInput, "Given已选窗口，Then监听所有输入")
    gate.stop()
    _ = try gate.begin(lease, wallNow: 1000)
    try expect(!gate.monitorsInput, "Given原生选择期，Then不把选择UI输入当作授权后输入")
    gate.stop()
    func window(_ id: UInt32, pid: Int32 = 123, bounds: Rect = target.bounds, alpha: Double = 1, title: String = "Fixture") -> NSDictionary {
        NSDictionary(dictionary: [kCGWindowNumber: NSNumber(value: id), kCGWindowOwnerPID: NSNumber(value: pid),
            kCGWindowLayer: NSNumber(value: 0), kCGWindowAlpha: NSNumber(value: alpha), kCGWindowIsOnscreen: NSNumber(value: true), kCGWindowName: title,
            kCGWindowBounds: NSDictionary(dictionary: ["X": bounds.x, "Y": bounds.y, "Width": bounds.width, "Height": bounds.height])])
    }
    let targetWindow = window(target.windowId)
    try validateWindowStack([targetWindow], target: target, requireFrontmost: true); count += 1
    try validateWindowStack([targetWindow, window(6, pid: 456)], target: target, requireFrontmost: true); count += 1
    try rejects("Given同PID同标题同几何的两个CG窗口，Then拒绝反向歧义") { try validateWindowStack([targetWindow, window(6)], target: target, requireFrontmost: false) }
    try rejects("Given半透明覆盖窗口，Then拒绝") { try validateWindowStack([window(9, pid: 456, alpha: 0.1), targetWindow], target: target, requireFrontmost: true) }
    try rejects("Given完全透明覆盖窗口，Then仍保守拒绝") { try validateWindowStack([window(9, pid: 456, alpha: 0), targetWindow], target: target, requireFrontmost: true) }
    try rejects("Given缺失元数据，Then拒绝") { try validateWindowStack([NSDictionary(), targetWindow], target: target, requireFrontmost: true) }
    try rejects("Given目标几何变化，Then拒绝") { try validateWindowStack([window(5, bounds: Rect(CGRect(x: 0, y: 0, width: 100, height: 100)))], target: target, requireFrontmost: true) }
    try rejects("Given目标消失，Then拒绝") { try validateWindowStack([], target: target, requireFrontmost: false) }
    try validateWindowStack([window(9, pid: 456), targetWindow], target: target, requireFrontmost: false); count += 1
    var framing = JSONLFrameBuffer(), lines: [Data] = []
    try framing.append(Array("first".utf8)[...]) { lines.append($0) }
    try framing.append(Array("\nsecond\n".utf8)[...]) { lines.append($0) }
    try expect(lines == [Data("first".utf8), Data("second".utf8)], "Given分块JSONL，Then只在换行后交付完整行")
    var huge = JSONLFrameBuffer()
    try huge.append([UInt8](repeating: 32, count: 1024 * 1024)[...]) { _ in }
    try rejects("Given单行超出1MiB，Then终止输入") { try huge.append([32][...]) { _ in } }
    try rejects("Given空type动作，Then拒绝伪成功") { try Action(kind: "type", observationId: "obs", x: nil, y: nil, text: "", key: nil, deltaY: nil, elementRef: nil).validate() }
    // 全部使用合成窗口、假时钟及假暂停，不实例化认证UI或读取真实桌面。
    var readinessTime: TimeInterval = 0
    var readinessChecks = 0
    try waitForDesktopReadiness(checkFence: {}, checkDesktop: { readinessChecks += 1 }, clock: { readinessTime }, pause: { readinessTime += $0 })
    try expect(readinessChecks == 3 && readinessTime >= 0.079, "Given立即可见，Then仍连续验证三次")
    readinessTime = 0; readinessChecks = 0
    try waitForDesktopReadiness(checkFence: {}, checkDesktop: {
        readinessChecks += 1
        if readinessTime < 0.35 { throw NativeFailure("occluded", "合成认证窗仍退场中") }
    }, clock: { readinessTime }, pause: { readinessTime += $0 })
    try expect(readinessTime >= 0.43 && readinessTime < 0.8, "Given认证窗350ms才消失，Then等待真实退场而非固定200ms")
    readinessTime = 0
    try waitForDesktopReadiness(checkFence: {}, checkDesktop: {
        if readinessTime < 0.28 { throw NativeFailure("not-frontmost", "合成焦点尚未归还") }
    }, clock: { readinessTime }, pause: { readinessTime += $0 })
    try expect(readinessTime >= 0.35 && readinessTime < 0.8, "Given焦点迟到，Then仅只读等待其恢复")
    readinessTime = 0; readinessChecks = 0
    try waitForDesktopReadiness(checkFence: {}, checkDesktop: {
        readinessChecks += 1
        if readinessChecks == 2 { throw NativeFailure("occluded", "合成覆盖再次出现") }
    }, clock: { readinessTime }, pause: { readinessTime += $0 })
    try expect(readinessChecks == 5, "Given可见状态再次被打断，Then稳定计数归零")
    readinessTime = 0
    try rejects("Given认证窗一直遮挡，Then800ms预算内拒绝") {
        try waitForDesktopReadiness(checkFence: {}, checkDesktop: { throw NativeFailure("occluded", "仍遮挡") }, clock: { readinessTime }, pause: { readinessTime += $0 })
    }
    try expect(readinessTime <= 0.801, "Given遮挡超时，Then不延长轮询预算")
    readinessTime = 0
    try rejects("Given焦点一直不归还，Then拒绝而非自动提窗") {
        try waitForDesktopReadiness(checkFence: {}, checkDesktop: { throw NativeFailure("not-frontmost", "仍非前台") }, clock: { readinessTime }, pause: { readinessTime += $0 })
    }
    for code in ["target-changed", "secure-input", "permission-required", "window-metadata"] {
        readinessTime = 0
        try rejects("Given非暂态错误\(code)，Then立即拒绝") {
            try waitForDesktopReadiness(checkFence: {}, checkDesktop: { throw NativeFailure(code, "非暂态") }, clock: { readinessTime }, pause: { readinessTime += $0 })
        }
        try expect(readinessTime == 0, "Given非暂态错误，Then无重试或等待")
    }
    readinessTime = 0; readinessChecks = 0
    try rejects("Given收敛期间撤权，Then下一次检查前拒绝") {
        try waitForDesktopReadiness(checkFence: {
            if readinessTime > 0 { throw NativeFailure("revoked", "合成停止") }
        }, checkDesktop: { readinessChecks += 1 }, clock: { readinessTime }, pause: { readinessTime += $0 })
    }
    try expect(readinessChecks == 1, "Given等待中停止，Then不再读取窗口或投递")
    readinessTime = 0
    try rejects("Given只读调用自身迟到，Then即使返回可见也不越过截止时间") {
        try waitForDesktopReadiness(checkFence: {}, checkDesktop: { readinessTime += 0.81 }, clock: { readinessTime }, pause: { readinessTime += $0 })
    }
    readinessChecks = 0
    try rejects("Given测试时钟不前进，Then次数上限仍保证结束") {
        try waitForDesktopReadiness(checkFence: {}, checkDesktop: { readinessChecks += 1; throw NativeFailure("occluded", "仍遮挡") }, clock: { 0 }, pause: { _ in })
    }
    try expect(readinessChecks == 22, "Given停滞时钟，Then最多22次只读检查")
    readinessTime = 0
    try rejects("Given自身或认证窗持续覆盖，Then不因PID或标题白名单绕过") {
        try waitForDesktopReadiness(checkFence: {}, checkDesktop: {
            try validateWindowStack([window(99, pid: 999, title: "CoreAuthUI"), targetWindow], target: target, requireFrontmost: true)
        }, clock: { readinessTime }, pause: { readinessTime += $0 })
    }
    return count
}
