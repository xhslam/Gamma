import Foundation
import CoreGraphics
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

    init(kind: String, observationId: String, x: Double? = nil, y: Double? = nil, text: String? = nil, key: String? = nil, deltaY: Double? = nil, elementRef: String? = nil, appName: String? = nil, startX: Double? = nil, startY: Double? = nil, button: String? = nil, clickCount: Int? = nil, windowId: UInt32? = nil, bundleId: String? = nil) {
        self.kind = kind; self.observationId = observationId
        self.x = x; self.y = y; self.text = text; self.key = key; self.deltaY = deltaY; self.elementRef = elementRef
        self.appName = appName; self.startX = startX; self.startY = startY
        self.button = button; self.clickCount = clickCount; self.windowId = windowId; self.bundleId = bundleId
    }

    func validate() throws {
        guard !observationId.isEmpty, observationId.utf8.count <= 128, elementRef == nil || elementRef!.utf8.count <= 128 else { throw NativeFailure("invalid-action", "观察标识无效") }
        guard button == nil || ["left", "right", "middle"].contains(button!), clickCount == nil || (1...3).contains(clickCount!) else { throw NativeFailure("invalid-action", "鼠标按钮或点击次数无效") }
        switch kind {
        case "click", "double_click", "triple_click", "right_click", "middle_click", "mouse_move", "move":
            guard let x, let y, x.isFinite, y.isFinite else { throw NativeFailure("invalid-action", "坐标无效") }
        case "drag", "left_click_drag":
            guard let x, let y, let startX, let startY, [x, y, startX, startY].allSatisfy(\.isFinite) else { throw NativeFailure("invalid-action", "拖拽必须包含有限的起终点坐标") }
        case "scroll":
            guard let x, let y, let deltaY, x.isFinite, y.isFinite, deltaY.isFinite, deltaY != 0, abs(deltaY) >= 1, abs(deltaY) <= 1200 else { throw NativeFailure("invalid-action", "滚动参数无效") }
        case "type", "axSetValue":
            guard let text, !text.isEmpty, text.utf16.count <= 4096, !text.unicodeScalars.contains(where: { $0.value == 0 || ($0.value < 32 && $0.value != 10 && $0.value != 9) }) else { throw NativeFailure("invalid-action", "文本参数无效") }
        case "key":
            guard let key, !key.isEmpty else { throw NativeFailure("invalid-action", "按键不能为空") }
            _ = try parseKeyCombination(key)
        case "open_app":
            guard let identifier = bundleId ?? appName, identifier.contains("."), !identifier.contains(" "), identifier.utf8.count <= 512 else { throw NativeFailure("invalid-action", "打开应用必须提供已解析的bundleId") }
        case "focus_window":
            guard let windowId, windowId > 0 else { throw NativeFailure("invalid-action", "窗口编号无效") }
        case "wait":
            break
        case "axPress":
            guard elementRef?.isEmpty == false else { throw NativeFailure("invalid-action", "AX动作参数无效") }
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

    init(id: String, epoch: Int, fence: UInt64, created: TimeInterval, target: Target? = nil, width: Int, height: Int, axDigest: String, display: DisplayResult? = nil, desktopDigest: String? = nil) {
        self.id = id; self.epoch = epoch; self.fence = fence; self.created = created
        self.target = target; self.width = width; self.height = height; self.axDigest = axDigest
        self.display = display; self.desktopDigest = desktopDigest
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
    private var selecting = false
    private var busy = false
    private var listenerHealthy = false
    private var confirming: String?
    private let clock: () -> TimeInterval
    init(clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) { self.clock = clock }
    private func locked<T>(_ body: () throws -> T) rethrows -> T { lock.lock(); defer { lock.unlock() }; return try body() }
    func begin(_ p: LeaseParams, wallNow: Double = Date().timeIntervalSince1970 * 1000) throws -> UInt64 {
        try locked {
            guard lease == nil, !busy, !selecting, !p.leaseId.isEmpty, p.leaseId.utf8.count <= 128, p.epoch >= 0,
                  p.deadline.isFinite, p.deadline > wallNow, p.deadline - wallNow <= 1_800_000 else { throw NativeFailure("invalid-lease", "租约无效、已存在或超过30分钟") }
            fence &+= 1; lease = p; expiry = clock() + (p.deadline - wallNow) / 1000
            selecting = true; listenerHealthy = false; usedActions.removeAll(); return fence
        }
    }
    func finishSelection(_ t: Target?, token: UInt64) throws {
        try locked { try valid(token); guard selecting else { throw NativeFailure("revoked", "选择已失效") }; target = t; selecting = false }
    }
    func setListenerHealthy(_ value: Bool) { locked { listenerHealthy = value } }
    private func valid(_ token: UInt64? = nil) throws {
        guard lease != nil, clock() < expiry, token == nil || token == fence else { throw NativeFailure("revoked", "授权已停止或过期") }
    }
    func current(_ p: BoundParams, needListener: Bool = true) throws -> (Target?, UInt64) {
        try locked {
            try valid()
            guard p.leaseId == lease?.leaseId, p.epoch == lease?.epoch, !selecting,
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
            guard !selecting, listenerHealthy, confirming == nil, p.leaseId == lease?.leaseId, p.epoch == lease?.epoch,
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
        locked { let active = lease != nil; fence &+= 1; lease = nil; target = nil; observation = nil; pending = nil; permit = nil; selecting = false; listenerHealthy = false; confirming = nil; return active }
    }
    func invalidateObservation() { locked { observation = nil; pending = nil; permit = nil } }
    var expired: Bool { locked { lease != nil && clock() >= expiry } }
    var isActive: Bool { locked { lease != nil } }
    var monitorsInput: Bool { locked { lease != nil && !selecting } }
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
