import { useState } from 'react'
import { CodeBlock as GammaCodeBlock } from '@gamma/ui'
import { copyTextToClipboard } from '@/lib/clipboard'

/** 官方组件使用的少量宿主 primitives，统一接到 Gamma 的复制与代码展示。 */
export function CodeBlock({ code, lang }: { code: string; lang?: string; copyLabel?: string; copiedLabel?: string }) {
  return <GammaCodeBlock onCopy={copyTextToClipboard}><code className={`language-${lang ?? 'text'}`}>{code}</code></GammaCodeBlock>
}

export function DiffBlock({ diffs }: { diffs: Array<{ path: string; oldText?: string; newText?: string }>; labels?: unknown }) {
  return <div>{diffs.map((diff, index) => <section key={index}><strong>{diff.path}</strong><CodeBlock lang="diff" code={(diff.oldText ?? '').split('\n').map(line => `- ${line}`).concat((diff.newText ?? '').split('\n').map(line => `+ ${line}`)).join('\n')} /></section>)}</div>
}

export function JsonTree({ data, label }: { data: object | unknown[]; label?: string; labels?: unknown; copyable?: boolean }) {
  const [expanded, setExpanded] = useState(true)
  return <section><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开'} {label ?? 'JSON'}</button>{expanded && <CodeBlock lang="json" code={JSON.stringify(data, null, 2)} />}</section>
}

export async function writeClipboard(text: string): Promise<boolean> {
  try { await copyTextToClipboard(text); return true } catch { return false }
}
