import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore, Provider } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { activeOnDemandOverlayAtom } from '@/atoms/on-demand-panel-atoms'
import { OnDemandConversationLayout } from './OnDemandConversationLayout'

describe('会话快捷侧栏的挂载边界', () => {
  for (const scenario of [
    { name: '嵌入 Agent', sessionId: 'current', embedded: true, active: 'files' as const },
    { name: '非当前会话', sessionId: 'other', embedded: false, active: 'files' as const },
    { name: '已收起的主会话', sessionId: 'current', embedded: false, active: null },
  ]) {
    test(`Given ${scenario.name} When 主会话布局渲染 Then 保留消息和输入但不重复挂载侧栏`, () => {
      const store = createStore()
      store.set(currentAgentSessionIdAtom, 'current')
      store.set(activeOnDemandOverlayAtom, scenario.active)
      const html = renderToStaticMarkup(
        <Provider store={store}>
          <OnDemandConversationLayout sessionId={scenario.sessionId} embedded={scenario.embedded}>
            <div>会话消息</div><textarea aria-label="消息输入" />
          </OnDemandConversationLayout>
        </Provider>,
      )
      expect(html).toContain('data-panel-open="false"')
      expect(html).toContain('会话消息')
      expect(html).toContain('aria-label="消息输入"')
      expect(html).not.toContain('data-testid="on-demand-overlay-panel"')
    })
  }
})
