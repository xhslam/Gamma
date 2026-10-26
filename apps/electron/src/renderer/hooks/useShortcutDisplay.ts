/**
 * useShortcutDisplay — 快捷键展示文本 Hook
 *
 * 复用 Central Shortcut Registry，支持用户自定义快捷键覆盖，
 * 避免在组件 Tooltip 中硬编码平台快捷键字符串。
 */

import * as React from 'react'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'

export function useShortcutDisplay(shortcutId: string): string {
  // 首次渲染与当前宏任务下计算生效的快捷键显示
  return React.useMemo(() => {
    const accelerator = getActiveAccelerator(shortcutId)
    return getAcceleratorDisplay(accelerator)
  }, [shortcutId])
}
