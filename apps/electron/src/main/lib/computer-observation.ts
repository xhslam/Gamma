/** AX 文本是不可信外部数据；此模块仅做有界显示，不从文本推导权限。 */
export interface ComputerAXPresentation {
  ax: string
  axDiff?: string
}

export function computerElementRefs(ax: string): string[] {
  return Array.from(ax.matchAll(/^ref=([^\s]+)\s/gm), match => match[1]!)
}

/** diff 仅为阅读摘要；完整最新 AX 始终附带，不能使用摘要中的历史引用。 */
export function presentComputerAX(current: string, previous?: string, disableDiff = false): ComputerAXPresentation {
  let index = 0
  const ax = current.replace(/^ref=/gm, () => `[${++index}] ref=`)
  if (previous === undefined || disableDiff) return { ax }
  const canonical = (text: string): string[] => text.split('\n').map(line => line.replace(/^ref=[^\s]+\s/, '')).filter(Boolean)
  const before = canonical(previous), after = canonical(current)
  const oldCounts = new Map<string, number>(), newCounts = new Map<string, number>()
  for (const line of before) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1)
  for (const line of after) newCounts.set(line, (newCounts.get(line) ?? 0) + 1)
  const changes: string[] = []
  for (const [line, count] of oldCounts) for (let n = newCounts.get(line) ?? 0; n < count; n++) changes.push(`- ${line}`)
  for (const [line, count] of newCounts) for (let n = oldCounts.get(line) ?? 0; n < count; n++) changes.push(`+ ${line}`)
  const summary = changes.length ? changes.join('\n').slice(0, 8192) : 'AX 内容未变化。'
  return { ax, axDiff: `${summary}\n全部旧元素引用已失效；仅使用本次 observationId 和完整 ax 中的新引用/索引。` }
}

/** 原生 ref 每次变化；稳定判断仅比较同一应用的内容和布局。 */
export function computerObservationFingerprint(ax: string, imageData: string, bundleId?: string): string {
  return `${bundleId ?? ''}\n${computerElementRefs(ax).length ? ax.replace(/^ref=[^\s]+\s/gm, '') : imageData}`
}
