import * as React from 'react'
import { DefaultResultRenderer } from './default-result'

interface MemoryResultProps {
  toolName: string
  result: string
  isError: boolean
}

/** 数量只来自成功工具返回的版本头，不将请求参数或模型文字当作读取证据。 */
export function MemoryResultRenderer({ toolName, result, isError }: MemoryResultProps): React.ReactElement {
  if (isError) return <DefaultResultRenderer result={result} isError />
  const files = [...result.matchAll(/^(?:(?:global|workspace):\/[^\n]+|\/[^\n]+)\n\[version: [^\]\n]+\] \[size: \d+ bytes\] \[offset: \d+\]/gm)]
  const updated = /^(?:saved|appended|edited)\. \[version: /.test(result)
  const label = toolName === 'memory_read' && files.length > 0
    ? `已读取 ${files.length} 条记忆${result.includes('[已截断；') ? ' · 含分段内容' : ''}`
    : updated ? '已更新记忆' : undefined
  if (!label) return <DefaultResultRenderer result={result} isError={false} />
  return (
    <details className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</summary>
      <div className="mt-2"><DefaultResultRenderer result={result} isError={false} /></div>
    </details>
  )
}
