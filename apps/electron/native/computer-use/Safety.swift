import Foundation
import CoreGraphics
import ApplicationServices
import Darwin

// 单窗口授权不自动扩展到AX附属窗口、sheet、菜单或弹出面板。
func isUnscopedAXSurface(role: String, subrole: String, depth: Int) -> Bool {
    depth > 0 && (["AXWindow", "AXSheet", "AXMenu", "AXPopover"].contains(role) || ["AXDialog", "AXSystemDialog"].contains(subrole))
}

struct NativeFailure: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}
struct Rect: Codable, Equatable {
    let x: Double, y: Double, width: Double, height: Double
    init(_ r: CGRect) { x = r.origin.x; y = r.origin.y; width = r.width; height = r.height }
    var cg: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    var valid: Bool { [x, y, width, height].allSatisfy(\.isFinite) && width > 1 && height > 1 && width <= 32768 && height <= 32768 }
}
struct Target: Codable, Equatable {
    let windowId: UInt32, pid: Int32
    let processIdentity: String, bundleId: String, title: String
    let bounds: Rect
}
struct LeaseParams: Codable { let leaseId: String; let epoch: Int; let deadline: Double }
struct BoundParams: Codable { let leaseId: String; let epoch: Int }

func parseKeyCombination(_ keyString: String) throws -> (CGKeyCode, CGEventFlags) {
    let normalized = keyString == "-" ? "minus" : keyString
    let parts = normalized.split(whereSeparator: { $0 == "+" || $0 == "-" }).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
    guard !parts.isEmpty else { throw NativeFailure("invalid-key", "按键不能为空") }
    var flags = CGEventFlags()
    var baseKey: String?
    for part in parts {
        switch part {
        case "cmd", "command", "super": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "opt", "option": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default:
            if baseKey != nil { throw NativeFailure("invalid-key", "只能包含一个主按键：\(keyString)") }
            baseKey = part
        }
    }
    guard let key = baseKey else { throw NativeFailure("invalid-key", "缺少主按键：\(keyString)") }
    let keyMap: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
        "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
        "3": 20, "4": 21, "6": 22, "5": 23, "equal": 24, "=": 24, "9": 25, "7": 26,
        "minus": 27, "-": 27, "8": 28, "0": 29, "rightbracket": 30, "]": 30, "o": 31,
        "u": 32, "leftbracket": 33, "[": 33, "i": 34, "p": 35, "return": 36, "enter": 36,
        "l": 37, "j": 38, "quote": 39, "'": 39, "k": 40, "semicolon": 41, ";": 41,
        "backslash": 42, "\\": 42, "comma": 43, ",": 43, "slash": 44, "/": 44, "n": 45,
        "m": 46, "period": 47, ".": 47, "tab": 48, "space": 49, "grave": 50, "`": 50,
        "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "forwarddelete": 117,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
        "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        "left": 123, "arrowleft": 123, "right": 124, "arrowright": 124,
        "down": 125, "arrowdown": 125, "up": 126, "arrowup": 126
    ]
    guard let code = keyMap[key] else { throw NativeFailure("invalid-key", "不支持的按键：\(key)") }
    return (code, flags)
}

struct Action: Codable, Equatable {
    let kind: String, observationId: String
    let x: Double?, y: Double?, text: String?, key: String?, deltaY: Double?, elementRef: String?
    let appName: String?
    let startX: Double?, startY: Double?
    let button: String?
    let clickCount: Int?
    let windowId: UInt32?
    let bundleId: String?
    let secondaryAction: String?, selectionText: String?, prefix: String?, suffix: String?, selectionType: String?, format: String?

    init(kind: String, observationId: String, x: Double? = nil, y: Double? = nil, text: String? = nil, key: String? = nil, deltaY: Double? = nil, elementRef: String? = nil, appName: String? = nil, startX: Double? = nil, startY: Double? = nil, button: String? = nil, clickCount: Int? = nil, windowId: UInt32? = nil, bundleId: String? = nil, secondaryAction: String? = nil, selectionText: String? = nil, prefix: String? = nil, suffix: String? = nil, selectionType: String? = nil, format: String? = nil) {
        self.kind = kind; self.observationId = observationId
        self.x = x; self.y = y; self.text = text; self.key = key; self.deltaY = deltaY; self.elementRef = elementRef
        self.appName = appName; self.startX = startX; self.startY = startY
        self.button = button; self.clickCount = clickCount; self.windowId = windowId; self.bundleId = bundleId
        self.secondaryAction = secondaryAction; self.selectionText = selectionText; self.prefix = prefix; self.suffix = suffix; self.selectionType = selectionType; self.format = format
    }

    func validate() throws {
        guard !observationId.isEmpty, observationId.utf8.count <= 128, elementRef == nil || elementRef!.utf8.count <= 128 else { throw NativeFailure("invalid-action", "观察标识无效") }
        if let bundleId { try validateBundleConstraint(bundleId, actual: bundleId) }
        for field in [secondaryAction, selectionText, prefix, suffix, selectionType, format].compactMap({ $0 }) {
            guard field.utf16.count <= 4096, !field.contains("\0") else { throw NativeFailure("invalid-action", "AX或剪贴板参数超过预算") }
        }
        if kind.hasPrefix("ax") { guard elementRef?.isEmpty == false else { throw NativeFailure("invalid-action", "AX动作必须引用本次观察的elementRef") } }
        guard button == nil || ["left", "right", "middle"].contains(button!), clickCount == nil || (1...3).contains(clickCount!) else { throw NativeFailure("invalid-action", "鼠标按钮或点击次数无效") }
        switch kind {
        case "click", "double_click", "triple_click", "right_click", "middle_click", "mouse_move", "move":
            guard let x, let y, x.isFinite, y.isFinite else { throw NativeFailure("invalid-action", "坐标无效") }
        case "drag", "left_click_drag":
            guard let x, let y, let startX, let startY, [x, y, startX, startY].allSatisfy(\.isFinite) else { throw NativeFailure("invalid-action", "拖拽必须包含有限的起终点坐标") }
        case "scroll":
            guard let x, let y, let deltaY, x.isFinite, y.isFinite, deltaY.isFinite, deltaY != 0, abs(deltaY) >= 1, abs(deltaY) <= 1200 else { throw NativeFailure("invalid-action", "滚动参数无效") }
        case "type", "axSetValue", "paste":
            guard let text, (kind == "axSetValue" || !text.isEmpty), text.utf16.count <= (kind == "paste" ? 65_536 : 4096), !text.unicodeScalars.contains(where: { $0.value == 0 || ($0.value < 32 && $0.value != 10 && $0.value != 9 && $0.value != 13) }) else { throw NativeFailure("invalid-action", "文本参数无效") }
            if kind == "paste" { try validateInsertionFormat(format ?? "text") }
        case "key":
            guard let key, !key.isEmpty else { throw NativeFailure("invalid-action", "按键不能为空") }
            _ = try parseKeyCombination(key)
        case "open_app":
            guard let identifier = bundleId ?? appName, identifier.contains("."), !identifier.contains(" "), identifier.utf8.count <= 512 else { throw NativeFailure("invalid-action", "打开应用必须提供已解析的bundleId") }
        case "focus_window":
            guard let windowId, windowId > 0 else { throw NativeFailure("invalid-action", "窗口编号无效") }
        case "wait":
            break
        case "axPress", "axFocus": break
        case "axAction":
            guard let secondaryAction, !secondaryAction.isEmpty, secondaryAction.utf8.count <= 256 else { throw NativeFailure("invalid-action", "axAction必须指定真实支持的secondaryAction") }
        case "axSelectText":
            guard let selectionText, !selectionText.isEmpty, ["text", "cursor_before", "cursor_after"].contains(selectionType ?? "text") else { throw NativeFailure("invalid-action", "选择文本或selectionType无效") }
        default: throw NativeFailure("unsupported-action", "不支持的动作：\(kind)")
        }
    }
}
struct PerformParams: Codable {
    let leaseId: String; let epoch: Int; let actionId: String; let action: Action
    let preparationId: String?
    init(leaseId: String, epoch: Int, actionId: String, action: Action, preparationId: String? = nil) {
        self.leaseId = leaseId; self.epoch = epoch; self.actionId = actionId; self.action = action; self.preparationId = preparationId
    }
}
struct Receipt: Encodable { let actionId: String, outcome: String, message: String }
struct ExecutionPermit: Equatable { let nonce: UUID; let fence: UInt64; let until: TimeInterval }
struct Snapshot {
    let id: String, epoch: Int, fence: UInt64, created: TimeInterval
    let target: Target?, width: Int, height: Int, axDigest: String
    let display: DisplayResult?
    let desktopDigest: String?
    let axRefs: [String: AXUIElement]
    let axRoot: AXUIElement?

    init(id: String, epoch: Int, fence: UInt64, created: TimeInterval, target: Target? = nil, width: Int, height: Int, axDigest: String, display: DisplayResult? = nil, desktopDigest: String? = nil, axRefs: [String: AXUIElement] = [:], axRoot: AXUIElement? = nil) {
        self.id = id; self.epoch = epoch; self.fence = fence; self.created = created
        self.target = target; self.width = width; self.height = height; self.axDigest = axDigest
        self.display = display; self.desktopDigest = desktopDigest; self.axRefs = axRefs; self.axRoot = axRoot
    }

    func point(x: Double, y: Double) throws -> CGPoint {
        guard x.isFinite, y.isFinite, x >= 0, y >= 0, x < Double(width), y < Double(height), width > 0, height > 0 else { throw NativeFailure("invalid-coordinate", "图像坐标越界") }
        if let d = display {
            let px = d.originX + (x / Double(width)) * d.ptWidth
            let py = d.originY + (y / Double(height)) * d.ptHeight
            return CGPoint(x: px, y: py)
        }
        if let target {
            return CGPoint(x: target.bounds.x + x / Double(width) * target.bounds.width,
                           y: target.bounds.y + y / Double(height) * target.bounds.height)
        }
        return CGPoint(x: x, y: y)
    }
}

private let knownAXRoles: Set<String> = [
    "AXApplication", "AXSystemWide", "AXWindow", "AXSheet", "AXDrawer", "AXGrowArea", "AXImage",
    "AXButton", "AXRadioButton", "AXCheckBox", "AXPopUpButton", "AXMenuButton", "AXTabGroup",
    "AXTable", "AXColumn", "AXRow", "AXOutline", "AXBrowser", "AXScrollArea", "AXScrollBar",
    "AXRadioGroup", "AXList", "AXGroup", "AXValueIndicator", "AXComboBox", "AXSlider", "AXIncrementor",
    "AXBusyIndicator", "AXProgressIndicator", "AXRelevanceIndicator", "AXToolbar", "AXDisclosureTriangle",
    "AXTextField", "AXTextArea", "AXStaticText", "AXMenuBar", "AXMenu", "AXMenuItem", "AXSplitGroup",
    "AXSplitter", "AXColorWell", "AXTimeField", "AXDateField", "AXHelpTag", "AXMatte", "AXDockItem",
    "AXHeading", "AXLink", "AXWebArea", "AXLayoutArea", "AXLayoutItem", "AXHandle", "AXCell", "AXPopover",
    "AXLevelIndicator", "AXRuler", "AXRulerMarker", "AXGrid", "AXPage", "AXText", "AXSwitch",
    "AXDescriptionList", "AXDefinition", "AXTerm", "AXDetails", "AXSummary", "AXFeed", "AXFigure", "AXMark"
]
func isHiddenAXControl(role: String?, subrole: String?) -> Bool {
    guard let role, knownAXRoles.contains(role), subrole != "AXUnknown", subrole != "unknown" else { return true }
    let identity = role + " " + (subrole ?? "")
    return identity.localizedCaseInsensitiveContains("secure") || identity.localizedCaseInsensitiveContains("password")
}

func validateBundleConstraint(_ expected: String?, actual: String) throws {
    guard let expected else { return }
    guard !expected.isEmpty, expected.utf8.count <= 512, expected.contains("."),
          !expected.contains("/"), !expected.contains("\\"), !expected.unicodeScalars.contains(where: { $0.value <= 32 }),
          expected == actual else { throw NativeFailure("application-mismatch", "实际接收应用与bundleId约束不一致") }
}

func selectedTextRange(value: String, selectionText: String, prefix: String?, suffix: String?, selectionType: String) throws -> CFRange {
    guard !selectionText.isEmpty, value.utf16.count <= 1_048_576,
          ["text", "cursor_before", "cursor_after"].contains(selectionType) else { throw NativeFailure("invalid-selection", "选择参数或控件文本超过预算") }
    // String边界保留完整Unicode字符；转换为NSRange后使用AX要求的UTF16偏移。
    var matches: [Range<String.Index>] = [], cursor = value.startIndex, attempts = 0
    while cursor < value.endIndex, let range = value.range(of: selectionText, options: .literal, range: cursor..<value.endIndex) {
        attempts += 1
        guard attempts <= 4096 else { throw NativeFailure("selection-budget", "文本匹配次数超过预算") }
        if range.lowerBound.samePosition(in: value.utf16) != nil, range.upperBound.samePosition(in: value.utf16) != nil,
           (prefix == nil || value[..<range.lowerBound].hasSuffix(prefix!)),
           (suffix == nil || value[range.upperBound...].hasPrefix(suffix!)) { matches.append(range) }
        guard matches.count <= 1024 else { throw NativeFailure("ambiguous-selection", "文本匹配过多") }
        cursor = value.index(after: range.lowerBound)
    }
    guard matches.count == 1, let match = matches.first else { throw NativeFailure("ambiguous-selection", "文本不存在或有重复；请用相邻prefix/suffix消歧") }
    let range = NSRange(match, in: value)
    return CFRange(location: selectionType == "cursor_after" ? range.location + range.length : range.location, length: selectionType == "text" ? range.length : 0)
}

func validatedAXActionName(kind: String, secondaryAction: String?, supported: [String]) throws -> String {
    guard ["axPress", "axAction"].contains(kind), supported.count <= 64 else { throw NativeFailure("unsupported-action", "不是支持的AX动作种类") }
    let name = kind == "axPress" ? "AXPress" : secondaryAction ?? ""
    guard !name.isEmpty, name.utf8.count <= 256, supported.contains(name) else { throw NativeFailure("unsupported-action", "AX动作不在目标当前真实支持列表中") }
    return name
}

func validateInsertionFormat(_ format: String) throws {
    guard ["text", "md"].contains(format) else { throw NativeFailure("unsupported-format", "当前不支持可验证的HTML/富文本粘贴；仅支持text或原样Markdown文本，且不读取或修改剪贴板") }
}

struct TextInsertionState: Equatable {
    let value: String
    let location: Int, length: Int
    var range: CFRange { CFRange(location: location, length: length) }
    static func == (lhs: TextInsertionState, rhs: TextInsertionState) -> Bool {
        lhs.location == rhs.location && lhs.length == rhs.length && lhs.value.utf16.elementsEqual(rhs.value.utf16)
    }
}

/// 只计算替换结果；不会修改原字符串、选区或系统剪贴板。
func replacingSelectedText(original: String, range: CFRange, replacement: String) throws -> String {
    let limit = 1_048_576
    guard original.utf16.count <= limit, replacement.utf16.count <= 65_536 else { throw NativeFailure("text-budget", "选区替换文本超过预算") }
    let units = Array(original.utf16), inserted = Array(replacement.utf16)
    guard range.location >= 0, range.location <= units.count, range.length >= 0,
          range.length <= units.count - range.location else { throw NativeFailure("invalid-selection", "AX选区不是原文中的可信有界范围") }
    let end = range.location + range.length
    func isBoundary(_ offset: Int) -> Bool {
        offset == 0 || offset == units.count || !((0xD800...0xDBFF).contains(units[offset - 1]) && (0xDC00...0xDFFF).contains(units[offset]))
    }
    guard isBoundary(range.location), isBoundary(end) else { throw NativeFailure("invalid-selection", "AX选区不能拆开UTF16代理对") }
    guard inserted.count <= limit - (units.count - range.length) else { throw NativeFailure("text-budget", "替换后全文超过预算") }
    return String(decoding: Array(units[..<range.location]) + inserted + Array(units[end...]), as: UTF16.self)
}

func validateInsertionState(_ expected: TextInsertionState, current: TextInsertionState) throws {
    guard expected == current else { throw NativeFailure("selection-changed", "确认后原文或选区已变化，未投递文本替换") }
}

// 仅在AX worker上等待认证窗口真实退场及焦点恢复，不以PID白名单忽略遮挡。
// 800ms是轮询预算，不承诺系统只读API的硬实时上限。停止、过期及非暂态错误立即拒绝。
// 注入时钟/暂停函数让离线测试不调用任何桌面API，也不进行真实等待。
func waitForDesktopReadiness(
    checkFence: () throws -> Void,
    checkDesktop: () throws -> Void,
    clock: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    pause: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) }
) throws {
    let deadline = clock() + 0.8
    var consecutiveReady = 0
    // 次数上限也防止测试时钟不前进；不延长租约、观察期限或单次批准。
    for _ in 0..<22 {
        try checkFence()
        guard clock() < deadline else { break }
        do {
            try checkDesktop()
            consecutiveReady += 1
        } catch let failure as NativeFailure where ["occluded", "not-frontmost"].contains(failure.code) {
            consecutiveReady = 0
        }
        try checkFence()
        guard clock() < deadline else { break }
        if consecutiveReady >= 3 { return }
        pause(min(0.04, max(0, deadline - clock())))
    }
    throw NativeFailure("desktop-not-ready", "认证窗口或目标焦点未在800ms预算内稳定收敛；未投递动作")
}

// 所有授权状态均由短临界区保护；不在锁内执行AX、UI、捕获或等待。
final class SafetyGate {
    private let lock = NSLock()
    private var fence: UInt64 = 0
    private var lease: LeaseParams?
    private var expiry: TimeInterval = 0
    private var target: Target?
    private var observation: Snapshot?
    private var pending: PerformParams?
    private var permit: ExecutionPermit?
    private var usedActions = Set<String>()
    private var busy = false
    private var listenerHealthy = false
    private var confirming: String?
    private let clock: () -> TimeInterval
    init(clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) { self.clock = clock }
    private func locked<T>(_ body: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try body() }
    func begin(_ p: LeaseParams, wallNow: Double = Date().timeIntervalSince1970 * 1000) throws -> UInt64 {
        try locked {
            guard lease == nil, !busy, !p.leaseId.isEmpty, p.leaseId.utf8.count <= 128, p.epoch >= 0,
                  p.deadline.isFinite, p.deadline > wallNow, p.deadline - wallNow <= 1_800_000 else { throw NativeFailure("invalid-lease", "租约无效、已存在或超过30分钟") }
            fence &+= 1; lease = p; expiry = clock() + (p.deadline - wallNow) / 1000
            listenerHealthy = false; usedActions.removeAll(); return fence
        }
    }
    func finishSelection(_ t: Target? = nil, token: UInt64 = 0) throws {
        locked { target = t }
    }
    func setListenerHealthy(_ value: Bool) { locked { listenerHealthy = value } }
    private func valid(_ token: UInt64? = nil) throws {
        guard lease != nil, clock() < expiry, token == nil || token == fence else { throw NativeFailure("revoked", "授权已停止或过期") }
    }
    func current(_ p: BoundParams, needListener: Bool = true) throws -> (Target?, UInt64) {
        try locked {
            try valid()
            guard p.leaseId == lease?.leaseId, p.epoch == lease?.epoch,
                  !needListener || listenerHealthy else { throw NativeFailure("revoked", "授权、目标或监听状态无效") }
            return (target, fence)
        }
    }
    func startWork(_ token: UInt64) throws { try locked { try valid(token); guard !busy else { throw NativeFailure("busy", "已有原生操作进行中") }; busy = true } }
    func endWork() { locked { busy = false } }
    func check(_ token: UInt64) throws { try locked { try valid(token) } }
    func setConfirmation(_ id: String, waiting: Bool, token: UInt64) throws {
        try locked {
            try valid(token)
            guard !id.isEmpty, listenerHealthy else { throw NativeFailure("revoked", "确认上下文无效") }
            if waiting {
                guard confirming == nil || confirming == id, permit == nil, pending == nil else { throw NativeFailure("busy", "已有确认或执行") }
                confirming = id
            } else {
                guard confirming == id else { throw NativeFailure("revoked", "确认标识已失效") }
                confirming = nil
            }
        }
    }
    var isConfirming: Bool { locked { confirming != nil } }
    func inspect(_ p: PerformParams) throws -> Snapshot {
        try p.action.validate()
        return try locked {
            try valid()
            guard listenerHealthy, confirming == nil, p.leaseId == lease?.leaseId, p.epoch == lease?.epoch,
                  !p.actionId.isEmpty, p.actionId.utf8.count <= 128, !usedActions.contains(p.actionId),
                  let s = observation, s.id == p.action.observationId, s.epoch == p.epoch, s.fence == fence,
                  clock() - s.created <= 30 else { throw NativeFailure("stale-observation", "观察、动作或确认状态已失效") }
            return s
        }
    }
    func checkDispatch(_ token: UInt64) throws {
        try locked { try valid(token); guard listenerHealthy, confirming == nil else { throw NativeFailure("revoked", "监听失活或正在等待确认") } }
    }
    // 只允许包裹两个CGEvent.post等短同步投递；严禁AX/UI/捕获进入此锁。
    private func consume(_ ticket: ExecutionPermit) throws {
        try valid(ticket.fence)
        guard listenerHealthy, confirming == nil, permit == ticket, clock() <= ticket.until else { throw NativeFailure("revoked", "单次批准已失效或已消费") }
        permit = nil
    }
    func claimAX(_ ticket: ExecutionPermit) throws { try locked { try consume(ticket) } }
    func commitDispatch(_ ticket: ExecutionPermit, _ dispatch: () -> Void) throws {
        try locked { try consume(ticket); dispatch() }
    }
    func continueDispatch(_ token: UInt64, _ dispatch: () -> Void) throws {
        try locked { try valid(token); guard listenerHealthy, confirming == nil else { throw NativeFailure("revoked", "执行已撤权") }; dispatch() }
    }
    func save(_ s: Snapshot) throws { try locked { try valid(s.fence); guard pending == nil else { throw NativeFailure("busy", "等待本地确认") }; observation = s } }
    func prepare(_ p: PerformParams) throws -> Snapshot {
        try p.action.validate()
        return try locked {
            try valid()
            guard p.leaseId == lease?.leaseId, p.epoch == lease?.epoch, listenerHealthy, confirming == nil,
                  !p.actionId.isEmpty, p.actionId.utf8.count <= 128, !usedActions.contains(p.actionId), usedActions.count < 1024,
                  pending == nil, let s = observation, s.id == p.action.observationId, s.epoch == p.epoch,
                  s.fence == fence, clock() - s.created <= 30 else { throw NativeFailure("stale-observation", "观察过期、动作重放或安全门已撤权") }
            usedActions.insert(p.actionId); pending = p; return s
        }
    }
    @discardableResult func approve(_ p: PerformParams, snapshot: Snapshot) throws -> ExecutionPermit {
        try locked {
            try valid(snapshot.fence)
            guard listenerHealthy, confirming == nil, pending?.actionId == p.actionId, pending?.action == p.action,
                  pending?.epoch == p.epoch, pending?.leaseId == p.leaseId, observation?.id == snapshot.id,
                  clock() - snapshot.created <= 30 else { throw NativeFailure("revoked", "迟到确认无效") }
            // 先消费再投递：即使系统调用失败也不能重放同一观察。
            pending = nil; observation = nil
            let ticket = ExecutionPermit(nonce: UUID(), fence: snapshot.fence, until: min(expiry, snapshot.created + 30))
            permit = ticket; return ticket
        }
    }
    @discardableResult func stop() -> Bool {
        locked { let active = lease != nil; fence &+= 1; lease = nil; target = nil; observation = nil; pending = nil; permit = nil; listenerHealthy = false; confirming = nil; return active }
    }
    func invalidateObservation() { locked { observation = nil; pending = nil; permit = nil } }
    var expired: Bool { locked { lease != nil && clock() >= expiry } }
    var isActive: Bool { locked { lease != nil } }
    var monitorsInput: Bool { locked { lease != nil } }
}

// 仅锁文件；绝不删除inode。停止后仍有AX写操作未返回时必须保留锁。
final class OwnerLock {
    private var fd: Int32 = -1
    private let mutex = NSLock()
    func acquire() throws {
        mutex.lock(); defer { mutex.unlock() }
        guard fd == -1 else { throw NativeFailure("owner-busy", "本helper仍占用桌面控制权") }
        let directory = "/tmp/com.gamma.computer-use-\(getuid())"
        if mkdir(directory, 0o700) != 0 && errno != EEXIST { throw NativeFailure("owner-lock", "无法建立互斥锁目录") }
        var info = stat()
        guard lstat(directory, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
              info.st_mode & 0o077 == 0 else { throw NativeFailure("owner-lock", "互斥锁目录不可信") }
        let file = open(directory + "/owner.lock", O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard file >= 0 else { throw NativeFailure("owner-lock", "无法打开互斥锁") }
        guard fstat(file, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
              info.st_nlink == 1, info.st_mode & 0o077 == 0, flock(file, LOCK_EX | LOCK_NB) == 0 else {
            close(file); throw NativeFailure("owner-busy", "其他helper正在控制桌面，或锁文件不可信")
        }
        fd = file
    }
    func release() { mutex.lock(); defer { mutex.unlock() }; if fd >= 0 { flock(fd, LOCK_UN); close(fd); fd = -1 } }
    deinit { release() }
}
