export interface CodeFieldRipple {
  x: number
  y: number
  startedAt: number
  strength?: number
}

export const CODE_FIELD_RIPPLE_LIFETIME = 1800
export const CODE_FIELD_MAX_RIPPLES = 6

/** 波峰以 CSS 像素向外传播，柔和尾波随时间衰减。 */
export function sampleCodeFieldRipple(ripples: readonly CodeFieldRipple[], x: number, y: number, now: number): number {
  let strength = 0
  for (const ripple of ripples) {
    const age = now - ripple.startedAt
    if (age < 0 || age >= CODE_FIELD_RIPPLE_LIFETIME) continue
    const distance = Math.hypot(x - ripple.x, y - ripple.y)
    const radius = age * 0.24
    const crest = Math.exp(-(((distance - radius) / 20) ** 2))
    const wake = Math.exp(-(((distance - radius + 36) / 28) ** 2)) * 0.3
    strength += (crest + wake) * (1 - age / CODE_FIELD_RIPPLE_LIFETIME) ** 2 * (ripple.strength ?? 1)
  }
  return Math.min(1, strength)
}
