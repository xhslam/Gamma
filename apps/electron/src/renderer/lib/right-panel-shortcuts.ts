/**
 * 右侧面板快捷键配置与冲突检测纯逻辑
 */

export interface ShortcutItem {
  id: string
  defaultMac: string
  defaultWin: string
}

export interface ShortcutConflictReport {
  valid: boolean
  conflicts: Array<{
    id1: string
    id2: string
    accelerator: string
    platform: 'mac' | 'windows'
  }>
}

interface ParsedShortcut {
  cmd: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

function normalizeKey(key: string): string {
  const lower = key.trim().toLowerCase()
  if (lower === 'space') return 'space'
  if (lower === 'enter' || lower === 'return') return 'enter'
  if (lower === 'esc' || lower === 'escape') return 'esc'
  return lower
}

/**
 * 将加速键字符串归一化解析为结构体
 */
export function parseShortcut(accelerator: string, platform: 'mac' | 'windows'): ParsedShortcut {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts.length > 0 ? normalizeKey(parts[parts.length - 1]!) : ''
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase())

  const isCmdOrCtrl = modifiers.includes('cmdorctrl') || modifiers.includes('commandorcontrol')
  const hasCmd = modifiers.includes('cmd') || modifiers.includes('command') || modifiers.includes('meta')
  const hasCtrl = modifiers.includes('ctrl') || modifiers.includes('control')
  const shift = modifiers.includes('shift')
  const alt = modifiers.includes('alt') || modifiers.includes('option')

  let cmd = false
  let ctrl = false

  if (platform === 'mac') {
    cmd = hasCmd || isCmdOrCtrl
    ctrl = hasCtrl
  } else {
    cmd = hasCmd
    ctrl = hasCtrl || isCmdOrCtrl
  }

  return {
    cmd,
    ctrl,
    shift,
    alt,
    key,
  }
}

/**
 * 判断两个快捷键在给定平台下是否冲突
 */
export function detectShortcutCollision(
  acc1: string,
  acc2: string,
  platform: 'mac' | 'windows',
): boolean {
  if (!acc1 || !acc2) return false
  const p1 = parseShortcut(acc1, platform)
  const p2 = parseShortcut(acc2, platform)

  return (
    p1.cmd === p2.cmd &&
    p1.ctrl === p2.ctrl &&
    p1.shift === p2.shift &&
    p1.alt === p2.alt &&
    p1.key === p2.key
  )
}

/**
 * 校验快捷键定义列表中是否存在冲突
 */
export function validateShortcutDefinitions(
  items: ShortcutItem[],
  platform: 'mac' | 'windows',
): ShortcutConflictReport {
  const conflicts: ShortcutConflictReport['conflicts'] = []

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const item1 = items[i]!
      const item2 = items[j]!
      const acc1 = platform === 'mac' ? item1.defaultMac : item1.defaultWin
      const acc2 = platform === 'mac' ? item2.defaultMac : item2.defaultWin

      if (detectShortcutCollision(acc1, acc2, platform)) {
        conflicts.push({
          id1: item1.id,
          id2: item2.id,
          accelerator: acc1,
          platform,
        })
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  }
}
