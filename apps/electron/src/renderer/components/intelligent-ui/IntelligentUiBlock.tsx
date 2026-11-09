import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ErrorBoundary, GenuiActionContext, GenuiBlock, isRenderableProcess, processGenuiSpec, setGenuiAssetBase } from '@gamma/genui-embed'
import type { BlockInteractionState } from '@gamma/genui-embed'
import { intelligentUiEnabledAtom } from '@/atoms/ui-preferences'
import { useAgentBrowserLink } from '@/components/browser/AgentBrowserLinkProvider'
import { Button } from '@/components/ui/button'
import { useIntelligentUiSession } from './IntelligentUiContext'
import { intelligentUiStatesAtom, mergeUiState } from './intelligent-ui-state'
import { isPublicUiUrl, parseIntelligentUiSource, uiContentFingerprint, validateIntelligentUiAction } from './intelligent-ui-policy'
import type { IntelligentUiAction } from './intelligent-ui-policy'
import { UiSourceFallback } from './IntelligentUiFence'
import './intelligent-ui.css'

setGenuiAssetBase('./genui-assets/')

export default function IntelligentUiBlock({ source, blockId }: { source: string; blockId: string }) {
  const session = useIntelligentUiSession()
  const enabled = useAtomValue(intelligentUiEnabledAtom)
  const [states, setStates] = useAtom(intelligentUiStatesAtom)
  const browser = useAgentBrowserLink()
  const stateKey = JSON.stringify([session?.workspaceId, session?.sessionId, blockId, uiContentFingerprint(source)])
  const [pending, setPending] = useState<IntelligentUiAction | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef({ session, enabled, stateKey })
  latest.current = { session, enabled, stateKey }
  const sendingRef = useRef(false)
  const parsed = useMemo(() => {
    try {
      const result = processGenuiSpec(parseIntelligentUiSource(source))
      if (!isRenderableProcess(result) || !result.spec) throw new Error('组件结构未通过校验')
      // 上游会归一化别名；规范化后的字段也必须再次通过宿主安全策略。
      parseIntelligentUiSource(JSON.stringify(result.spec))
      return { spec: result.spec, error: '' }
    } catch (cause) { return { spec: null, error: cause instanceof Error ? cause.message : 'UI JSON 无效' } }
  }, [source])
  // 仅首帧读取；GenuiBlock 的外部存储接口不会读写 dsh 全局 localStorage。
  const initialState = useMemo(() => Array.isArray(states) ? states.find(entry => entry.key === stateKey)?.state : undefined, [stateKey])
  const saveState = useCallback((state: BlockInteractionState) => {
    setStates(previous => {
      const existing = Array.isArray(previous) ? previous.find(entry => entry.key === stateKey)?.state : undefined
      if (JSON.stringify(existing) === JSON.stringify(state)) return previous
      return mergeUiState(previous, stateKey, state)
    })
  }, [setStates, stateKey])
  useEffect(() => { setPending(null); setError('') }, [stateKey, enabled, session?.canSend])
  const onAction = useCallback((action: string, payload: Record<string, unknown>) => {
    if (!latest.current.enabled || !latest.current.session?.canSend || sendingRef.current) return
    try { setPending(validateIntelligentUiAction(action, payload)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '交互内容无效') }
  }, [])
  async function confirm(): Promise<void> {
    const current = latest.current
    if (!pending || sendingRef.current || !current.enabled || !current.session?.canSend || current.stateKey !== stateKey) return
    sendingRef.current = true
    setSending(true)
    setError('')
    try { await current.session.sendAction(blockId, pending); setPending(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '交互发送失败，请确认会话状态') }
    finally { sendingRef.current = false; setSending(false) }
  }
  if (!enabled || !session) return <UiSourceFallback source={source} message="Intelligent UI 已关闭" />
  if (!parsed.spec) return <UiSourceFallback source={source} message={parsed.error} />
  return <div className="gamma-intelligent-ui not-prose" data-intelligent-ui="" onClickCapture={event => {
    const target = event.target instanceof Element ? event.target.closest('a') : null
    if (!target) return
    event.preventDefault(); event.stopPropagation()
    const href = target.getAttribute('href') ?? ''
    if (isPublicUiUrl(href) && browser) browser.openLink(href)
    else setError('此链接未通过 Gamma 导航入口校验')
  }} onAuxClickCapture={event => { if (event.target instanceof Element && event.target.closest('a')) { event.preventDefault(); event.stopPropagation() } }}>
    <ErrorBoundary label="Intelligent UI"><GenuiActionContext.Provider value={session.canSend ? onAction : undefined}><GenuiBlock key={stateKey} spec={parsed.spec} stateKey={stateKey} initialState={initialState} onStateChange={saveState} animateEntrance={false} /></GenuiActionContext.Provider></ErrorBoundary>
    {pending && <section className="mt-3 rounded-lg border border-border bg-muted/40 p-3" aria-label="确认 UI 交互" data-ui-action-preview="">
      <p className="text-sm font-medium">发送交互给 Agent</p>
      <pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(pending, null, 2)}</pre>
      <div className="flex gap-2"><Button size="sm" disabled={sending || !session.canSend} onClick={() => void confirm()}>{sending ? '正在发送…' : '发送给 Agent'}</Button><Button size="sm" variant="ghost" disabled={sending} onClick={() => setPending(null)}>取消</Button></div>
    </section>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <details className="mt-2 text-xs text-muted-foreground"><summary>查看 UI 源码</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">{source}</pre></details>
  </div>
}
