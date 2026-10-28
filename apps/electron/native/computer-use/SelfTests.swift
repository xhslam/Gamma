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
    try expect(isUnscopedAXSurface(role: "AXSheet", subrole: "", depth: 1), "Given附属sheet，Then不继承窗口授权")
    try expect(isUnscopedAXSurface(role: "AXWindow", subrole: "AXDialog", depth: 2), "Given附属对话框，Then拒绝读取及引用")
    try expect(!isUnscopedAXSurface(role: "AXWindow", subrole: "", depth: 0), "Given所选根窗口，Then允许验证")
    for (width, height) in [(2560.0, 1440.0), (1080.0, 2560.0), (5120.0, 1440.0), (1.0, 100000.0)] {
        let (w, h) = captureDimensions(width: width, height: height)
        try expect(w >= 2 && h >= 2 && w <= 1280 && h <= 1280, "Given横竖或超宽显示器，Then截图两边均符合协议预算")
    }
    let (portraitW, portraitH) = captureDimensions(width: 1080, height: 2560)
    try expect(portraitH == 1280 && abs(Double(portraitW) / Double(portraitH) - 1080.0 / 2560.0) < 0.001, "Given竖屏，Then等比缩放长边")
    let invalidSize = captureDimensions(width: .infinity, height: 0)
    try expect(invalidSize.0 == 2 && invalidSize.1 == 2, "Given无效几何，Then不产生溢出图像")
    try expect(isGammaPID(getpid()), "Given当前进程PID，Then确认为Gamma相关PID")
    try expect(isGammaPID(getppid()), "Given父进程PID，Then确认为Gamma相关PID")
    try expect(!isGammaPID(999999), "Given虚构外部PID，Then拒绝确认为Gamma相关PID")
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
    try Action(kind: "scroll", observationId: "obs", deltaY: 100).validate(); count += 1
    try rejects("Givenscroll只有一个坐标，Then拒绝") { try Action(kind: "scroll", observationId: "obs", x: 1, deltaY: 100).validate() }
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
    try expect(gate.monitorsInput, "Given全屏授权已建立，Then从租约开始即监听用户接管")
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
    try expect(validatedAXScrollRange(current: 1, minimum: 0, maximum: 0, webKitScrollArea: true, offset: 230, extent: 230) == 0...1, "GivenSafari原生滚动条在底部且Min/Max为0，Then按WebKit契约采用归一化范围")
    try expect(validatedAXScrollRange(current: 0, minimum: 0, maximum: 0, webKitScrollArea: true, offset: 0, extent: 230) == 0...1, "GivenSafari顶部几何一致，Then归一化范围有效")
    try expect(validatedAXScrollRange(current: 0.5, minimum: 0, maximum: 0, webKitScrollArea: true, offset: 115, extent: 230) == 0...1, "GivenSafari中间位置几何一致，Then归一化范围有效")
    try expect(validatedAXScrollRange(current: 4, minimum: 0, maximum: 10, webKitScrollArea: false, offset: 0, extent: 0) == 0...10, "Given明确数值范围，Then保留原范围")
    for (current, minimum, maximum, webKit, offset, extent) in [
        (1.0, 0.0, 0.0, false, 230.0, 230.0), (1, 0, 0, true, 0, 230),
        (2, 0, 0, true, 230, 230), (0, 0, 0, true, 0, 0),
        (0, 0, 0, true, -1, 230), (1, 0, 0, true, 231, 230),
        (0, 0, 0, true, Double.nan, 230), (0, 2, 1, true, 0, 230),
        (Double.nan, 0, 0, true, 0, 230),
    ] {
        try expect(validatedAXScrollRange(current: current, minimum: minimum, maximum: maximum, webKitScrollArea: webKit, offset: offset, extent: extent) == nil, "Given身份、范围或几何无法证实归一化契约，Then拒绝猜测")
    }
    try expect(axScrollDestination(current: 0, minimum: 0, maximum: 1, delta: -115, viewport: 704, content: 934) == 0.5, "Given归一化滚动条，Then负delta向下且按可滚动高度换算")
    try expect(axScrollDestination(current: 1, minimum: 0, maximum: 1, delta: 115, viewport: 704, content: 934) == 0.5, "Given页面底部，Then正delta向上")
    try expect(axScrollDestination(current: 0.5, minimum: 0, maximum: 1, delta: -1200, viewport: 704, content: 934) == 1, "Given滚动超出底部，Then只到已验证的最大位置")
    try expect(axScrollDestination(current: 0.5, minimum: 0, maximum: 1, delta: 1200, viewport: 704, content: 934) == 0, "Given滚动超出顶部，Then只到已验证的最小位置")
    for (current, minimum, maximum, delta, viewport, content) in [
        (Double.nan, 0.0, 1.0, -300.0, 704.0, 934.0), (0, 0, 1, -300, 0, 934),
        (0, 0, 1, -300, 704, 704), (0, 0, 1, -300, 704, 100),
        (0, 1, 1, -300, 704, 934), (2, 0, 1, -300, 704, 934),
        (0, 0, 1, -1201, 704, 934), (0, 0, 1, 0, 704, 934)
    ] {
        try expect(axScrollDestination(current: current, minimum: minimum, maximum: maximum, delta: delta, viewport: viewport, content: content) == nil, "Given范围或几何无法验证，Then不猜滚动位置")
    }
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
    // 新全屏协议的离线边界：不解析真实应用，不创建CGEvent或访问AX。
    let fullDisplay = DisplayResult(displayId: 42, originX: -1440, originY: -100, ptWidth: 1440, ptHeight: 900, scaledWidth: 1280, scaledHeight: 800)
    let fullSnapshot = Snapshot(id: "full", epoch: 1, fence: 1, created: 0, width: 1280, height: 800, axDigest: "", display: fullDisplay)
    let fullCenter = try fullSnapshot.point(x: 640, y: 400)
    try expect(fullCenter.x == -720 && fullCenter.y == 350, "Given主屏截图缩放与负原点，Then按实际图像大小映射points")
    let doubleAction = Action(kind: "double_click", observationId: "full", x: 640, y: 400)
    let doubleSteps = try mouseSteps(doubleAction, snapshot: fullSnapshot)
    try expect(doubleSteps.count == 4 && doubleSteps.map(\.clickState) == [1, 1, 2, 2], "Given双击，Then两个完整down/up序列")
    let dragAction = Action(kind: "drag", observationId: "full", x: 1200, y: 700, startX: 20, startY: 30)
    try dragAction.validate()
    let dragSteps = try mouseSteps(dragAction, snapshot: fullSnapshot)
    try expect(dragSteps.count == 22 && dragSteps[1].type == .leftMouseDragged && dragSteps.last?.type == .leftMouseUp, "Given拖拽，Then中间包含真实dragged事件与最终抬键")
    try rejects("Given拖拽缺少起点，Then拒绝") { try Action(kind: "drag", observationId: "full", x: 10, y: 10).validate() }
    try rejects("Given拖拽起点NaN，Then拒绝") { try Action(kind: "drag", observationId: "full", x: 10, y: 10, startX: .nan, startY: 0).validate() }
    try rejects("Given未知鼠标按钮，Then拒绝") { try Action(kind: "click", observationId: "full", x: 10, y: 10, button: "unknown").validate() }
    try Action(kind: "focus_window", observationId: "full", windowId: 5).validate()
    try rejects("Given提窗没有windowId，Then拒绝") { try Action(kind: "focus_window", observationId: "full").validate() }
    try rejects("Givenopen_app仅有模型应用名，Then必须先解析真实bundleId") { try Action(kind: "open_app", observationId: "full", appName: "Notes").validate() }
    try Action(kind: "open_app", observationId: "full", bundleId: "test.fixture").validate()
    let longUnicode = String(repeating: "中文👩🏽‍💻🚀", count: 20)
    let chunks = unicodeEventChunks(longUnicode)
    try expect(chunks.allSatisfy { !$0.isEmpty && $0.count <= 20 } && String(decoding: chunks.flatMap { $0 }, as: UTF16.self) == longUnicode, "Given长Unicode，Then小批事件完整保留UTF16")
    try expect(chunks.allSatisfy { chunk in !(0xD800...0xDBFF).contains(chunk.last!) && !(0xDC00...0xDFFF).contains(chunk.first!) }, "Given代理对边界，Then不会拆开emoji")
    try expect(isOwnEvent(tag: 42, sourcePID: 123, expectedTag: 42, expectedPID: 123), "Given本helper标记与PID同时一致，Then识别自身事件")
    try expect(!isOwnEvent(tag: 42, sourcePID: 456, expectedTag: 42, expectedPID: 123), "Given只有标记相同，Then不忽略外部事件")
    try expect(!isOwnEvent(tag: 43, sourcePID: 123, expectedTag: 42, expectedPID: 123), "Given只有PID相同，Then不忽略事件")
    let (minusKey, _) = try parseKeyCombination("-")
    let panelGate = SafetyGate(clock: { 0 })
    let panelToken = try panelGate.begin(lease, wallNow: 1000)
    try panelGate.finishSelection(nil, token: panelToken); panelGate.setListenerHealthy(true)
    for _ in 0..<3 {
        try panelGate.startWork(panelToken)
        try expect(!shouldHideStopPanel(leaseActive: panelGate.isActive, workActive: true, confirming: panelGate.isConfirming), "Given连续桌面请求，Then工作期间停止条可用")
        panelGate.endWork()
        try expect(!shouldHideStopPanel(leaseActive: panelGate.isActive, workActive: false, confirming: panelGate.isConfirming), "Given请求结束但租约有效，Then等待模型时停止条不消失")
    }
    panelGate.stop()
    try expect(shouldHideStopPanel(leaseActive: panelGate.isActive, workActive: false, confirming: panelGate.isConfirming), "Given明确停止且工作已结束，Then停止条隐藏")
    try expect(shortcutReleaseFlags(synthetic: .maskCommand, session: .maskCommand, hardware: []).isEmpty, "Given合成cmd快捷键，Then释放后不残留cmd状态")
    try expect(shortcutReleaseFlags(synthetic: [.maskCommand, .maskShift], session: [.maskCommand, .maskShift], hardware: []).isEmpty, "Given合成多修饰键，Then全部释放")
    try expect(shortcutReleaseFlags(synthetic: .maskCommand, session: [.maskCommand, .maskControl], hardware: []) == .maskControl, "Given其他来源的修饰键，Then不清除它们")
    try expect(shortcutReleaseFlags(synthetic: .maskCommand, session: .maskCommand, hardware: .maskCommand) == .maskCommand, "Given用户物理按住cmd，Then不能用合成释放清除用户状态")
    try expect(shortcutReleaseFlags(synthetic: .maskCommand, session: [.maskCommand, .maskAlphaShift], hardware: []) == .maskAlphaShift, "Given大写锁定，Then不清除非快捷键标志")
    let (pageKey, pageFlags) = try parseKeyCombination("cmd+shift+PageDown")
    try expect(minusKey == 27 && pageKey == 121 && pageFlags.contains([.maskCommand, .maskShift]), "Given扩展组合键，Then正确解析minus与翻页")
    let desktopGate = SafetyGate(clock: { 0 })
    let desktopLease = LeaseParams(leaseId: "desktop", epoch: 1, deadline: 61_000)
    let desktopToken = try desktopGate.begin(desktopLease, wallNow: 1000)
    try desktopGate.finishSelection(nil, token: desktopToken); desktopGate.setListenerHealthy(true)
    let desktopSnapshot = Snapshot(id: "full", epoch: 1, fence: desktopToken, created: 0, width: 1280, height: 800, axDigest: "", display: fullDisplay)
    let desktopRequest = PerformParams(leaseId: "desktop", epoch: 1, actionId: "one", action: doubleAction)
    try desktopGate.save(desktopSnapshot)
    _ = try desktopGate.inspect(desktopRequest); _ = try desktopGate.inspect(desktopRequest)
    try expect(true, "Given只读prepare重复，Then不消费观察或actionId")
    try desktopGate.bindPreparation("prepared", request: desktopRequest, token: desktopToken)
    try desktopGate.setConfirmation("prepared", waiting: true, token: desktopToken)
    try rejects("Given等待确认，Then拒绝准备新动作") { _ = try desktopGate.inspect(desktopRequest) }
    try rejects("Given等待确认，Then拒绝事件续发") { try desktopGate.continueDispatch(desktopToken) { posted += 1 } }
    try rejects("Given错误preparationId解除确认，Then拒绝") { try desktopGate.setConfirmation("other", waiting: false, token: desktopToken) }
    try desktopGate.setConfirmation("prepared", waiting: false, token: desktopToken)
    _ = try desktopGate.prepare(desktopRequest)
    let desktopPermit = try desktopGate.approve(desktopRequest, snapshot: desktopSnapshot)
    try desktopGate.commitDispatch(desktopPermit) { posted += 1 }
    try desktopGate.continueDispatch(desktopToken) { posted += 1 }
    desktopGate.stop()
    try rejects("Given拖拽中停止，Then下一个事件不可续发") { try desktopGate.continueDispatch(desktopToken) { posted += 1 } }
    try rejects("Given停止后迟到确认，Then不能恢复") { try desktopGate.setConfirmation("prepared", waiting: false, token: desktopToken) }
    let matchingRequest = PerformParams(leaseId: "desktop", epoch: 1, actionId: "one", action: doubleAction, preparationId: "prepared")
    try expect(samePreparedRequest(desktopRequest, matchingRequest), "Given同一不可变动作，Then允许携带preparationId执行")
    let changedRequest = PerformParams(leaseId: "desktop", epoch: 1, actionId: "one", action: Action(kind: "click", observationId: "full", x: 1, y: 2), preparationId: "prepared")
    try expect(!samePreparedRequest(desktopRequest, changedRequest), "Given批准后替换动作，Then不可复用准备")
    try Action(kind: "open_app", observationId: "full", appName: "com.apple.Notes").validate()
    let observedLayoutSnapshot = Snapshot(id: "full", epoch: 1, fence: 1, created: 0, target: target, width: 1280, height: 800, axDigest: "captured-layout", display: fullDisplay)
    try validateObservedLayout(observedLayoutSnapshot, window: target, digest: "captured-layout")
    try expect(true, "Given截图与准备控件布局一致，Then允许继续安全检查")
    try rejects("Given截图后应用内部布局变化，Then拒绝使用旧像素") { try validateObservedLayout(observedLayoutSnapshot, window: target, digest: "changed-layout") }
    try rejects("Given截图没有可验证AX布局，Then不能盲打") { try validateObservedLayout(fullSnapshot, window: target, digest: "captured-layout") }
    let otherWindow = Target(windowId: 6, pid: target.pid, processIdentity: target.processIdentity, bundleId: target.bundleId, title: target.title, bounds: target.bounds)
    try rejects("Given背景窗口未包含在本次前台布局，Then必须先聚焦并重新截图") { try validateObservedLayout(observedLayoutSnapshot, window: otherWindow, digest: "captured-layout") }
    // AX与文本替换路径：仅纯函数/编码，不实例化AX元素、剪贴板或桌面应用。
    for role in [nil, "unknown", "AXUnknown", "", "AXSecureTextField", "AXUnrecognizedCustomControl"] as [String?] {
        try expect(isHiddenAXControl(role: role, subrole: nil), "Given安全或未知role，Then不读取内容或创建引用")
    }
    try expect(isHiddenAXControl(role: "AXTextField", subrole: "AXSecureTextField"), "Given安全subrole，Then即使role为普通文本仍隐藏")
    try expect(isHiddenAXControl(role: "AXTextField", subrole: "PasswordEntry"), "Given密码变体，Then保守隐藏")
    try expect(!isHiddenAXControl(role: "AXTextArea", subrole: nil), "Given已知普通文本控件，Then允许后续实时能力检查")
    var axBuffer = AXObservationBuffer(), sameAX = AXObservationBuffer(), changedAX = AXObservationBuffer()
    _ = axBuffer.append(entry: "role=AXTextField value=hello actions=AXPress", content: "hello|AXPress", ref: "uuid-first")
    _ = sameAX.append(entry: "role=AXTextField value=hello actions=AXPress", content: "hello|AXPress", ref: "uuid-second")
    _ = changedAX.append(entry: "role=AXTextField value=hello actions=AXPress", content: "changed-beyond-truncation|AXPress", ref: "uuid-first")
    try expect(axBuffer.text != sameAX.text && axBuffer.digest == sameAX.digest, "Given新观察UUID变化，Then输出ref更新但摘要保持稳定")
    try expect(axBuffer.digest != changedAX.digest, "Given截断后文本变化，Then完整内容摘要仍使观察失效")
    var nodeBudget = AXObservationBuffer()
    for _ in 0..<300 { _ = nodeBudget.append(entry: "role=AXButton") }
    try expect(nodeBudget.count == 256, "Given超过256节点，ThenAX序列化有界")
    var byteBudget = AXObservationBuffer()
    for _ in 0..<300 { _ = byteBudget.append(entry: String(repeating: "中文🚀", count: 100), ref: "uuid") }
    try expect(byteBudget.text.utf8.count <= 32_700 && byteBudget.count < 256, "Given多字节Unicode大树，Then按UTF8而非字符预算限制到32KiB以内")
    try Action(kind: "axSetValue", observationId: "full", text: "", elementRef: "ref").validate(); count += 1
    for kind in ["axPress", "axSetValue", "axFocus", "axAction", "axSelectText"] {
        try rejects("Given\(kind)缺少观察引用，Then拒绝") { try Action(kind: kind, observationId: "full", text: "text", secondaryAction: "AXPress", selectionText: "text").validate() }
    }
    try Action(kind: "axAction", observationId: "full", elementRef: "ref", secondaryAction: "AXIncrement").validate(); count += 1
    try rejects("GivenaxAction无真实动作名，Then拒绝") { try Action(kind: "axAction", observationId: "full", elementRef: "ref").validate() }
    try rejects("Given伪造任意attribute动作kind，Then拒绝") { try Action(kind: "axSetAttribute", observationId: "full", elementRef: "ref", secondaryAction: "AXValue").validate() }
    try validateBundleConstraint(nil, actual: "test.real"); count += 1
    try validateBundleConstraint("test.real", actual: "test.real"); count += 1
    try rejects("Given应用约束不匹配，Thenwait及其他动作共用拒绝边界") { try validateBundleConstraint("test.other", actual: "test.real") }
    try rejects("GivenbundleId为路径，Then拒绝") { try validateBundleConstraint("/test.real", actual: "/test.real") }
    let emojiRange = try selectedTextRange(value: "甲🚀乙", selectionText: "🚀", prefix: nil, suffix: nil, selectionType: "text")
    try expect(emojiRange.location == 1 && emojiRange.length == 2, "Givenemoji选择，Then使用完整UTF16代理对范围")
    let beforeRange = try selectedTextRange(value: "甲🚀乙", selectionText: "🚀", prefix: nil, suffix: nil, selectionType: "cursor_before")
    let afterRange = try selectedTextRange(value: "甲🚀乙", selectionText: "🚀", prefix: nil, suffix: nil, selectionType: "cursor_after")
    try expect(beforeRange.location == 1 && beforeRange.length == 0 && afterRange.location == 3 && afterRange.length == 0, "Given光标前后模式，Then光标不落在代理对中间")
    try rejects("Given重复文本无消歧，Then拒绝猜测首次匹配") { _ = try selectedTextRange(value: "one target two target", selectionText: "target", prefix: nil, suffix: nil, selectionType: "text") }
    let disambiguated = try selectedTextRange(value: "one target two target!", selectionText: "target", prefix: "two ", suffix: "!", selectionType: "text")
    try expect(disambiguated.location == 15 && disambiguated.length == 6, "Given相邻prefix/suffix唯一消歧，Then只选指定匹配")
    try rejects("Givenprefix/suffix仍重复，Then拒绝") { _ = try selectedTextRange(value: "aXaX", selectionText: "X", prefix: "a", suffix: nil, selectionType: "text") }
    try rejects("Given文本不存在，Then不修改选择") { _ = try selectedTextRange(value: "abc", selectionText: "z", prefix: nil, suffix: nil, selectionType: "text") }
    try rejects("Given空selectionText，Then拒绝") { _ = try selectedTextRange(value: "abc", selectionText: "", prefix: nil, suffix: nil, selectionType: "text") }
    try rejects("Given未知selectionType，Then拒绝") { _ = try selectedTextRange(value: "abc", selectionText: "b", prefix: nil, suffix: nil, selectionType: "all") }
    try rejects("Given超量匹配且prefix均不命中，Then仍受扫描预算约束") { _ = try selectedTextRange(value: String(repeating: "a", count: 5000), selectionText: "a", prefix: "z", suffix: nil, selectionType: "text") }
    for format in ["text", "md"] { try Action(kind: "paste", observationId: "full", text: "hello", format: format).validate(); count += 1 }
    try rejects("Given未知paste格式，Then拒绝而非降级伪装") { try Action(kind: "paste", observationId: "full", text: "hello", format: "rtf").validate() }
    try rejects("Given空paste，Then拒绝无效动作") { try Action(kind: "paste", observationId: "full", text: "").validate() }
    let actionJSON = try JSONEncoder().encode(Action(kind: "axSelectText", observationId: "full", elementRef: "ref", bundleId: "test.real", selectionText: "🚀", prefix: "甲", suffix: "乙", selectionType: "cursor_after"))
    let decodedAction = try JSONDecoder().decode(Action.self, from: actionJSON)
    try expect(decodedAction.selectionText == "🚀" && decodedAction.bundleId == "test.real" && decodedAction.selectionType == "cursor_after", "Given新增字段经过JSON协议，Then保持Unicode及应用约束")
    let pressName = try validatedAXActionName(kind: "axPress", secondaryAction: "AXDelete", supported: ["AXPress"])
    try expect(pressName == "AXPress", "GivenaxPress携带其他名称，Then仍只执行真实支持的AXPress")
    let customName = try validatedAXActionName(kind: "axAction", secondaryAction: "AXIncrement", supported: ["AXIncrement", "AXDecrement"])
    try expect(customName == "AXIncrement", "GivenaxAction已枚举支持，Then只执行原样动作名")
    try rejects("Given猜测AXPress但控件不支持，Then拒绝") { _ = try validatedAXActionName(kind: "axPress", secondaryAction: nil, supported: ["AXShowMenu"]) }
    try rejects("GivenAXValue是属性而非枚举动作，Then拒绝") { _ = try validatedAXActionName(kind: "axAction", secondaryAction: "AXValue", supported: ["AXPress"]) }
    try rejects("Given空真实动作列表，Then不猜测默认动作") { _ = try validatedAXActionName(kind: "axAction", secondaryAction: "AXPress", supported: []) }
    let composedRange = try selectedTextRange(value: "前👩🏽‍💻后", selectionText: "👩🏽‍💻", prefix: "前", suffix: "后", selectionType: "text")
    try expect(composedRange.location == 1 && composedRange.length == "👩🏽‍💻".utf16.count, "Given复合emoji与ZWJ，Then选择覆盖完整UTF16序列")
    try rejects("GivenHTML粘贴，Then明确拒绝且不降级") { try Action(kind: "paste", observationId: "full", text: "<b>x</b>", format: "html").validate() }
    do { try validateInsertionFormat("html"); throw NativeFailure("self-test", "HTML应拒绝") }
    catch let failure as NativeFailure { try expect(failure.code == "unsupported-format", "Given富文本格式，Then返回明确unsupported-format") }
    let insertionOriginal = "甲🚀乙"
    let insertedAtStart = try replacingSelectedText(original: insertionOriginal, range: CFRange(location: 0, length: 0), replacement: "前")
    let insertedAtEnd = try replacingSelectedText(original: insertionOriginal, range: CFRange(location: 4, length: 0), replacement: "后")
    let replacedEmoji = try replacingSelectedText(original: insertionOriginal, range: CFRange(location: 1, length: 2), replacement: "👩🏽‍💻")
    try expect(insertedAtStart == "前甲🚀乙" && insertedAtEnd == "甲🚀乙后", "Given可信首尾光标，Then只在指定位置插入")
    try expect(replacedEmoji == "甲👩🏽‍💻乙" && insertionOriginal == "甲🚀乙", "Given选区替换，Then保留两侧内容且原字符串不变")
    let allReplacement = try replacingSelectedText(original: "abc", range: CFRange(location: 0, length: 3), replacement: "new")
    let emptyInsertion = try replacingSelectedText(original: "", range: CFRange(location: 0, length: 0), replacement: "x")
    let unchangedText = try replacingSelectedText(original: insertionOriginal, range: CFRange(location: 1, length: 0), replacement: "")
    try expect(allReplacement == "new" && emptyInsertion == "x" && unchangedText == insertionOriginal, "Given全选/空文档/空替换，Then按可信范围准确计算")
    for range in [CFRange(location: -1, length: 0), CFRange(location: 5, length: 0), CFRange(location: 0, length: -1), CFRange(location: 3, length: 2), CFRange(location: Int.max, length: Int.max), CFRange(location: 0, length: Int.max)] {
        try rejects("Given负值/越界/溢出AX选区，Then拒绝且不猜插入位置") { _ = try replacingSelectedText(original: insertionOriginal, range: range, replacement: "x") }
    }
    for range in [CFRange(location: 2, length: 0), CFRange(location: 1, length: 1), CFRange(location: 2, length: 1)] {
        try rejects("Given光标或选区拆开代理对，Then拒绝") { _ = try replacingSelectedText(original: insertionOriginal, range: range, replacement: "x") }
    }
    let multiline = try replacingSelectedText(original: "前\n中\n后", range: CFRange(location: 2, length: 1), replacement: "**新**\t🚀")
    try expect(multiline == "前\n**新**\t🚀\n后", "GivenMarkdown与换行/Tab/emoji，Then原样插入而非富文本渲染")
    try rejects("Given全文超过预算，Then计算替换前拒绝") { _ = try replacingSelectedText(original: String(repeating: "x", count: 1_048_577), range: CFRange(location: 0, length: 0), replacement: "") }
    try rejects("Given替换结果超过预算，Then拒绝") { _ = try replacingSelectedText(original: String(repeating: "x", count: 1_048_576), range: CFRange(location: 0, length: 0), replacement: "x") }
    try rejects("Given插入文本超过预算，Then拒绝") { _ = try replacingSelectedText(original: "", range: CFRange(location: 0, length: 0), replacement: String(repeating: "x", count: 65_537)) }
    let boundInsertion = TextInsertionState(value: "abc", location: 1, length: 0)
    try validateInsertionState(boundInsertion, current: TextInsertionState(value: "abc", location: 1, length: 0)); count += 1
    try rejects("Given确认后光标变化，Then拒绝") { try validateInsertionState(boundInsertion, current: TextInsertionState(value: "abc", location: 2, length: 0)) }
    try rejects("Given确认后选区长度变化，Then拒绝") { try validateInsertionState(boundInsertion, current: TextInsertionState(value: "abc", location: 1, length: 1)) }
    try rejects("Given确认后原文变化，Then拒绝") { try validateInsertionState(boundInsertion, current: TextInsertionState(value: "axc", location: 1, length: 0)) }
    try rejects("GivenUnicode规范等价但UTF16原文变化，Then仍拒绝") { try validateInsertionState(TextInsertionState(value: "éab", location: 0, length: 0), current: TextInsertionState(value: "e\u{301}ab", location: 0, length: 0)) }
    // Given只授辅助功能，Then允许基础桌面能力，诊断状态不伪造为已授权。
    let accessibilityOnly = Permissions(accessibility: true, screen: false, listen: false, post: false)
    try expect(hasRequiredComputerPermissions(accessibilityOnly), "Given仅辅助功能，Then基础模式准入")
    try expect(!hasRequiredComputerPermissions(Permissions(accessibility: false, screen: true, listen: true, post: true)), "Given缺辅助功能，Then其他权限不能代替")
    let axSnapshot = Snapshot(id: "ax-only", epoch: 1, fence: 1, created: 0, target: target, width: 2560, height: 1600,
                              axDigest: "ax-layout", display: DisplayResult(originX: 0, originY: 0, ptWidth: 2560, ptHeight: 1600, scaledWidth: 2560, scaledHeight: 1600), hasImage: false)
    let axObservation = ObservationResult(observationId: axSnapshot.id, epoch: 1, image: nil, width: 2560, height: 1600, display: axSnapshot.display, ax: "role=AXWindow", targetApp: nil)
    let axEncoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(axObservation)) as? [String: Any]
    try expect(axEncoded?["image"] == nil && axEncoded?["mode"] as? String == "accessibility" && axEncoded?["width"] as? Int == 2560, "GivenAX-only，Then协议省略图像并保留逻辑尺寸")
    let textOnlyParams = try JSONDecoder().decode(ObserveParams.self, from: Data("{\"leaseId\":\"a\",\"epoch\":1,\"includeImage\":false}".utf8))
    let legacyParams = try JSONDecoder().decode(ObserveParams.self, from: Data("{\"leaseId\":\"a\",\"epoch\":1}".utf8))
    try expect(textOnlyParams.includeImage == false && legacyParams.includeImage == nil, "Given非视觉模型或旧请求，Then可显式禁图并兼容旧协议")
    try validateVisualAction(Action(kind: "axPress", observationId: "ax-only", elementRef: "ref"), snapshot: axSnapshot); count += 1
    try validateVisualAction(Action(kind: "scroll", observationId: "ax-only", deltaY: 100), snapshot: axSnapshot); count += 1
    for kind in ["click", "double_click", "right_click", "mouse_move", "drag", "scroll"] {
        try rejects("GivenAX-only，Then拒绝显式像素\(kind)") { try validateVisualAction(Action(kind: kind, observationId: "ax-only", x: 1, y: 1), snapshot: axSnapshot) }
    }
    let visibleDisplay = DisplayResult(originX: -100, originY: 30, ptWidth: 1000, ptHeight: 500, scaledWidth: 1000, scaledHeight: 500)
    let defaultPoint = try defaultScrollPoint(elementBounds: Rect(CGRect(x: -200, y: 100, width: 500, height: 200)), windowBounds: target.bounds, display: visibleDisplay)
    try expect(defaultPoint == CGPoint(x: 100, y: 200), "Given焦点部分超出主屏，Then滚动位于可见交集中心")
    let windowPoint = try defaultScrollPoint(elementBounds: nil, windowBounds: target.bounds, display: visibleDisplay)
    try expect(windowPoint == CGPoint(x: 400, y: 280), "Given焦点无几何，Then只使用已验证窗口可见中心")
    try rejects("Given焦点完全位于其他显示器，Then不猜主屏中心") { _ = try defaultScrollPoint(elementBounds: Rect(CGRect(x: 5000, y: 0, width: 10, height: 10)), windowBounds: target.bounds, display: visibleDisplay) }
    let titleless = NSMutableDictionary(dictionary: targetWindow); titleless.removeObject(forKey: kCGWindowName)
    try validateWindowStack([titleless], target: target, requireFrontmost: true); count += 1
    try rejects("Given标题隐藏且同PID同几何窗口歧义，Then仍拒绝") { try validateWindowStack([titleless, window(6, title: "Other")], target: target, requireFrontmost: false) }

    var confirmationNow: TimeInterval = 100
    let confirmationGate = SafetyGate(clock: { confirmationNow })
    let confirmationLease = LeaseParams(leaseId: "confirm", epoch: 1, deadline: 601_000)
    let confirmationToken = try confirmationGate.begin(confirmationLease, wallNow: 1000)
    confirmationGate.setListenerHealthy(true)
    func confirmationSnapshot(_ id: String) -> Snapshot { Snapshot(id: id, epoch: 1, fence: confirmationToken, created: confirmationNow, target: target, width: 100, height: 50, axDigest: "a") }
    let confirmSnapshot = confirmationSnapshot("confirm-obs")
    let confirmRequest = PerformParams(leaseId: "confirm", epoch: 1, actionId: "confirm-action", action: Action(kind: "axPress", observationId: confirmSnapshot.id, elementRef: "ref"))
    try confirmationGate.save(confirmSnapshot)
    try rejects("Given未登记preparation，Then不能暂停观察年龄") { try confirmationGate.setConfirmation("unbound", waiting: true, token: confirmationToken) }
    try confirmationGate.bindPreparation("confirm-prepared", request: confirmRequest, token: confirmationToken)
    try confirmationGate.setConfirmation("confirm-prepared", waiting: true, token: confirmationToken)
    confirmationNow += 31
    try confirmationGate.setConfirmation("confirm-prepared", waiting: false, token: confirmationToken)
    _ = try confirmationGate.inspect(confirmRequest); count += 1
    let substituted = PerformParams(leaseId: "confirm", epoch: 1, actionId: "other-action", action: confirmRequest.action)
    try rejects("Given替换actionId，Then不能继承确认暂停时间") { _ = try confirmationGate.inspect(substituted) }
    _ = try confirmationGate.prepare(confirmRequest)
    let confirmedPermit = try confirmationGate.approve(confirmRequest, snapshot: confirmSnapshot)
    try confirmationGate.claimAX(confirmedPermit); count += 1
    let excessiveSnapshot = confirmationSnapshot("excessive")
    let excessiveRequest = PerformParams(leaseId: "confirm", epoch: 1, actionId: "excessive", action: Action(kind: "wait", observationId: excessiveSnapshot.id))
    try confirmationGate.save(excessiveSnapshot); try confirmationGate.bindPreparation("excessive", request: excessiveRequest, token: confirmationToken)
    try confirmationGate.setConfirmation("excessive", waiting: true, token: confirmationToken)
    confirmationNow += 121
    try rejects("Given确认超过120秒，Then清除暂停信用并要求重新观察") { try confirmationGate.setConfirmation("excessive", waiting: false, token: confirmationToken) }
    try rejects("Given超时确认，Then原观察仍过期") { _ = try confirmationGate.inspect(excessiveRequest) }
    let staleConfirmationSnapshot = confirmationSnapshot("before-confirm")
    let staleConfirmationRequest = PerformParams(leaseId: "confirm", epoch: 1, actionId: "before-confirm", action: Action(kind: "wait", observationId: staleConfirmationSnapshot.id))
    try confirmationGate.save(staleConfirmationSnapshot); try confirmationGate.bindPreparation("late", request: staleConfirmationRequest, token: confirmationToken)
    confirmationNow += 31
    try rejects("Given进入确认前已过期，Then不能通过确认复活观察") { try confirmationGate.setConfirmation("late", waiting: true, token: confirmationToken) }
    let permissionSnapshot = confirmationSnapshot("permission")
    let permissionRequest = PerformParams(leaseId: "confirm", epoch: 1, actionId: "permission", action: Action(kind: "wait", observationId: permissionSnapshot.id))
    try confirmationGate.save(permissionSnapshot)
    try confirmationGate.setScreenPermissionWaiting(true)
    try expect(confirmationGate.isScreenPermissionWaiting && confirmationGate.isActive, "Given录屏弹窗，Then保留租约但暂停投递")
    try rejects("Given系统录屏授权等待中，Then禁止动作投递") { try confirmationGate.continueDispatch(confirmationToken) {} }
    try rejects("Given系统录屏授权等待中，Then禁止保存新观察") { try confirmationGate.save(permissionSnapshot) }
    try confirmationGate.setScreenPermissionWaiting(false)
    try rejects("Given录屏授权完成，Then不能重用授权前观察") { _ = try confirmationGate.inspect(permissionRequest) }
    let cumulativeSnapshot = confirmationSnapshot("cumulative")
    let cumulativeRequest = PerformParams(leaseId: "confirm", epoch: 1, actionId: "cumulative", action: Action(kind: "wait", observationId: cumulativeSnapshot.id))
    try confirmationGate.save(cumulativeSnapshot); try confirmationGate.bindPreparation("cumulative", request: cumulativeRequest, token: confirmationToken)
    try confirmationGate.setConfirmation("cumulative", waiting: true, token: confirmationToken)
    confirmationNow += 61
    try confirmationGate.setConfirmation("cumulative", waiting: false, token: confirmationToken)
    try confirmationGate.setConfirmation("cumulative", waiting: true, token: confirmationToken)
    confirmationNow += 60
    try expect(!confirmationGate.expired, "Given累计确认上限测试，Then租约本身仍有效")
    try rejects("Given多次确认累计超过120秒，Then不能反复暂停绕过上限") { try confirmationGate.setConfirmation("cumulative", waiting: false, token: confirmationToken) }
    try confirmationGate.setScreenPermissionWaiting(true)
    confirmationGate.stop()
    try expect(!confirmationGate.isActive && !confirmationGate.isScreenPermissionWaiting, "Given系统录屏授权期间急停，Then立即撤销租约与暂停状态")
    return count
}
