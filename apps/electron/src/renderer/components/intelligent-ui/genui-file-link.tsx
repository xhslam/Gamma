import type { ReactNode } from 'react'

/** 文件操作仅由 Gamma 已授权的文件入口提供；embed 内文件引用保持只读。 */
export function FileLink({ path, children, label }: { path: string; line?: number; children?: ReactNode; label: string }): ReactNode {
  return <span title={path}>{children ?? label}</span>
}
