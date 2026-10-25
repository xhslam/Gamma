export interface CodeFieldRipple {
  x: number
  y: number
  startedAt: number
  strength?: number
  kind?: 'hover' | 'click'
}

export const CODE_FIELD_RIPPLE_LIFETIME = 1600
export const CODE_FIELD_CLICK_LIFETIME = 2400
export const CODE_FIELD_MAX_RIPPLES = 12

export function codeFieldRippleLifetime(ripple: CodeFieldRipple): number {
  return ripple.kind === 'click' ? CODE_FIELD_CLICK_LIFETIME : CODE_FIELD_RIPPLE_LIFETIME
}

/** 宽波峰缓缓扩散，柔和起亮和收尾；只调制字符色彩，不绘制实心光斑。 */
export function sampleCodeFieldRipple(ripples: readonly CodeFieldRipple[], x: number, y: number, now: number): number {
  let strength = 0
  for (const ripple of ripples) {
    const age = now - ripple.startedAt
    const lifetime = codeFieldRippleLifetime(ripple)
    if (age < 0 || age >= lifetime) continue
    const progress = age / lifetime
    const distance = Math.hypot(x - ripple.x, y - ripple.y)
    if (ripple.kind === 'click') {
      // 圆心固定在按下位置，ease-out 半径让水波先展开、再逐渐减速。
      const radius = 360 * (1 - (1 - progress) ** 2)
      const width = 20 + progress * 16
      const crest = Math.exp(-(((distance - radius) / width) ** 2))
      const delayed = Math.max(0, (age - 180) / lifetime)
      const innerRadius = 360 * (1 - (1 - delayed) ** 2)
      const inner = age > 180 ? Math.exp(-(((distance - innerRadius) / (width * 1.15)) ** 2)) * 0.38 : 0
      const entrance = Math.min(1, age / 100)
      const innerEntrance = Math.min(1, Math.max(0, (age - 180) / 100))
      const envelope = entrance * entrance * (3 - 2 * entrance) * (1 - progress) ** 1.5
      strength += (crest + inner * innerEntrance * innerEntrance * (3 - 2 * innerEntrance)) * envelope * (ripple.strength ?? 1)
      continue
    }
    const radius = age * 0.12
    const width = 30 + progress * 24
    const crest = Math.exp(-(((distance - radius) / width) ** 2))
    const wake = Math.exp(-(((distance - radius + 42) / (width * 1.3)) ** 2)) * 0.35
    // 起始零亮度，约 120ms 柔和浮现，末尾平滑归零，避免亮斑闪现和硬截断。
    const entrance = Math.min(1, age / 120)
    const envelope = entrance * entrance * (3 - 2 * entrance) * (1 - progress) ** 2
    // 随位置与波龄轻微起伏，让交叠波光有层次，但不改变静态底色和字符。
    const shimmer = 0.85 + 0.15 * Math.sin(distance * 0.055 - age * 0.004 + ripple.x * 0.013)
    strength += (crest + wake) * envelope * shimmer * (ripple.strength ?? 1)
  }
  // 平滑压缩叠加亮度，避免多个波纹相交时形成硬饱和边界。
  return 0.75 * (1 - Math.exp(-strength))
}
