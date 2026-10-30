import Foundation
import CryptoKit

// 精确目标/窗口作用域设计参考 Cua Driver 0.38.0（92e49bca）：
// platform-macos/src/ax/window_scope.rs、cua-driver-core/src/snapshot_store.rs。
// 本文件独立适配 Gamma 的单次观察、授权与停止 fence，不引入后台输入。
// 上游 MIT 声明：Copyright (c) 2025 Cua AI, Inc.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/// 标题属于展示信息；窗口身份与几何才决定旧观察是否仍能定位该窗口。
func sameTargetWindow(_ lhs: Target?, _ rhs: Target?) -> Bool {
    guard let lhs, let rhs else { return lhs == nil && rhs == nil }
    return lhs.windowId == rhs.windowId && lhs.pid == rhs.pid
        && lhs.processIdentity == rhs.processIdentity && lhs.bundleId == rhs.bundleId
        && lhs.bounds == rhs.bounds
}

struct AXWindowCandidate {
    let pid: Int32
    let windowId: UInt32?
}

/// 无窗口ID证明时不按几何、标题或当前焦点猜测，避免同PID兄弟窗口串用。
func matchingAXWindowIndex(_ target: Target, candidates: [AXWindowCandidate]) throws -> Int {
    let matches = candidates.indices.filter {
        candidates[$0].pid == target.pid && candidates[$0].windowId == target.windowId
    }
    guard target.windowId != 0, matches.count == 1, let index = matches.first else {
        throw NativeFailure("ambiguous-window", "AX未能唯一证明请求的窗口ID与owner；不回退到其他焦点窗口")
    }
    return index
}

func validateObservedWindow(_ snapshot: Snapshot, window: Target) throws {
    guard snapshot.target != nil, sameTargetWindow(snapshot.target, window), !snapshot.axDigest.isEmpty else {
        throw NativeFailure("observation-layout-changed", "目标窗口身份或几何不属于本次观察；请先聚焦并重新观察")
    }
}

/// 只绑定目标本身，不把页面其他区域的内容变化当作该元素失效。
/// 指纹覆盖完整文本而非展示截断值，且只留在helper内存，不外发或记日志。
struct AXElementFingerprint: Equatable {
    let signature: String
    let role: String
    let depth: Int
    let bounds: Rect?
    let enabled: Bool?
    init(role: String, subrole: String, title: String, description: String, value: String,
         actions: [String], bounds: Rect?, enabled: Bool?, depth: Int = 0) {
        let fields = [role, subrole, title, description, value] + actions.sorted()
        // 长度前缀保持字段边界，避免任意AX字符串中的分隔符碰撞。
        let canonical = fields.map { "\($0.utf8.count):\($0)" }.joined()
        signature = SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
        self.role = role; self.depth = depth; self.bounds = bounds; self.enabled = enabled
    }
}

func validateObservedElementState(_ expected: AXElementFingerprint, current: AXElementFingerprint) throws {
    // depth只用于观察时的点位消歧，不把输出元数据当成实时控件状态。
    guard expected.signature == current.signature, expected.bounds == current.bounds, expected.enabled == current.enabled else {
        throw NativeFailure("target-changed", "目标自身的内容、能力、状态或几何已改变；未投递，请重新观察")
    }
}

/// 旧像素必须仍指向原观察中覆盖该点的最具体控件，不能在按钮移动后改绑其父容器。
func validateObservedPoint(_ states: [String: AXElementFingerprint], point: CGPoint, actualRef: String) throws {
    let hits = states.filter { isStableAXHitControl($0.value.role) && $0.value.bounds?.cg.contains(point) == true }.sorted { lhs, rhs in
        let left = lhs.value.bounds!.cg, right = rhs.value.bounds!.cg
        let a = left.width * left.height, b = right.width * right.height
        return a == b ? lhs.value.depth > rhs.value.depth : a < b
    }
    guard let expected = hits.first else { return }
    if hits.count > 1 {
        let next = hits[1]
        let a = expected.value.bounds!.cg, b = next.value.bounds!.cg
        guard a.width * a.height != b.width * b.height || expected.value.depth != next.value.depth else {
            throw NativeFailure("target-changed", "原观察中点位控件无法唯一消歧，请使用语义引用")
        }
    }
    guard actualRef == expected.key else { throw NativeFailure("target-changed", "旧坐标对应的控件已移动或替换，未投递，请重新观察") }
}

/// 只输出变化类别，绝不记录窗口标题、输入内容或进程生存期原文。
struct DesktopChangeSummary: Encodable {
    let countChanged: Bool
    let orderChanged: Bool
    let titlesChanged: Bool
    let boundsChanged: Bool
    let ownersChanged: Bool
    let processesChanged: Bool
    var logFields: [String: Bool] {
        ["countChanged": countChanged, "orderChanged": orderChanged, "titlesChanged": titlesChanged,
         "boundsChanged": boundsChanged, "ownersChanged": ownersChanged, "processesChanged": processesChanged]
    }
}
func desktopChangeSummary(from previous: [Target], to current: [Target]) -> DesktopChangeSummary {
    var old: [UInt32: Target] = [:]
    for window in previous { old[window.windowId] = window }
    let common = current.compactMap { now -> (Target, Target)? in old[now.windowId].map { ($0, now) } }
    return DesktopChangeSummary(
        countChanged: previous.count != current.count,
        orderChanged: previous.map(\.windowId) != current.map(\.windowId),
        titlesChanged: common.contains { $0.0.title != $0.1.title },
        boundsChanged: common.contains { $0.0.bounds != $0.1.bounds },
        ownersChanged: common.contains { $0.0.pid != $0.1.pid || $0.0.bundleId != $0.1.bundleId },
        processesChanged: common.contains { $0.0.processIdentity != $0.1.processIdentity }
    )
}
