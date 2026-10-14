import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { ModeSwitcher } from '@/components/app-shell/ModeSwitcher'
    import { appModeAtom } from '@/atoms/app-mode'
    import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
    import { agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
    import { tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
    import { activeViewAtom } from '@/atoms/active-view'
    import '@/styles/globals.css'
    const delay = () => new Promise(resolve => setTimeout(resolve, 10));
    const until = async predicate => { for(let i=0;i<150;i++){if(predicate())return;await delay()}throw new Error('模式切换未达到预期状态') };
    window.modeSwitcherRegression = {
      until,
      async mount(options = {}) {
        localStorage.clear();
        const store=createStore(), root=createRoot(document.getElementById('root')), calls=[];
        window.electronAPI={updateSettings:async settings=>{calls.push(settings)}};
        store.set(appModeAtom,options.mode ?? 'agent');
        store.set(conversationsAtom,options.chats ?? []);
        store.set(agentSessionsAtom,options.agents ?? []);
        store.set(currentConversationIdAtom,options.lastChat ?? null);
        store.set(currentAgentSessionIdAtom,options.lastAgent ?? null);
        store.set(tabsAtom,options.tabs ?? []);
        store.set(activeTabIdAtom,options.activeTab ?? null);
        store.set(activeViewAtom,'conversations');
        root.render(React.createElement(Provider,{store},React.createElement(ModeSwitcher)));
        await until(()=>document.querySelector('[role="group"][aria-label="工作模式"]'));
        const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
        return {
          root,calls,button,
          state:()=>({mode:store.get(appModeAtom),chat:store.get(currentConversationIdAtom),agent:store.get(currentAgentSessionIdAtom),activeTab:store.get(activeTabIdAtom),tabs:store.get(tabsAtom).map(tab=>tab.sessionId),workspace:store.get(currentAgentWorkspaceIdAtom)}),
          pressed:()=>({Agent:button('Agent').getAttribute('aria-pressed'),Chat:button('Chat').getAttribute('aria-pressed')}),
        };
      },
    };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 Chromium 中的工作模式切换器', () => {
  test('When 上次对话、已有标签与最近对话同时存在 Then 优先恢复上次对话并同步按钮选中状态', async () => {
    const result = await renderer.run<{ selected: string | null; activeTab: string | null; before: Record<string, string>; after: Record<string, string>; unchanged: boolean }>(`
      const api=window.modeSwitcherRegression,fixture=await api.mount({
        chats:[{id:'recent',title:'最近对话'},{id:'last',title:'上次对话'}],lastChat:'last',
        tabs:[{id:'opened',sessionId:'opened',type:'chat',title:'已开对话'}],
      });
      const before=fixture.pressed();fixture.button('Chat').click();await api.until(()=>fixture.state().mode==='chat');
      const state=fixture.state(),after=fixture.pressed();fixture.button('Chat').click();
      const unchanged=JSON.stringify(state)===JSON.stringify(fixture.state());fixture.root.unmount();
      return {selected:state.chat,activeTab:state.activeTab,before,after,unchanged};
    `)
    expect(result).toEqual({ selected: 'last', activeTab: 'last', before: { Agent: 'true', Chat: 'false' }, after: { Agent: 'false', Chat: 'true' }, unchanged: true })
  }, 30_000)

  test('When 上次 Agent 会话已不存在但有同模式标签 Then 恢复已有标签且同步项目', async () => {
    const result = await renderer.run<{ selected: string | null; activeTab: string | null; workspace: string; calls: Array<{ agentWorkspaceId: string }>; pressed: Record<string, string> }>(`
      const api=window.modeSwitcherRegression,fixture=await api.mount({
        mode:'chat',lastAgent:'deleted',
        agents:[{id:'recent',title:'最近任务',workspaceId:'recent-project'},{id:'opened',title:'已开任务',workspaceId:'opened-project'}],
        tabs:[{id:'opened',sessionId:'opened',type:'agent',title:'已开任务'}],
      });
      fixture.button('Agent').click();await api.until(()=>fixture.state().mode==='agent');
      const state=fixture.state(),pressed=fixture.pressed();fixture.root.unmount();
      return {selected:state.agent,activeTab:state.activeTab,workspace:state.workspace,calls:fixture.calls,pressed};
    `)
    expect(result).toEqual({ selected: 'opened', activeTab: 'opened', workspace: 'opened-project', calls: [{ agentWorkspaceId: 'opened-project' }], pressed: { Agent: 'true', Chat: 'false' } })
  }, 30_000)

  test('When 上次对话和同模式标签均不存在 Then 跳过归档并恢复最近未归档对话', async () => {
    const result = await renderer.run<{ selected: string | null; activeTab: string | null }>(`
      const api=window.modeSwitcherRegression,fixture=await api.mount({lastChat:'deleted',chats:[
        {id:'archived',title:'已归档对话',archived:true},{id:'recent',title:'最近对话'},{id:'older',title:'更早对话'},
      ]});
      fixture.button('Chat').click();await api.until(()=>fixture.state().mode==='chat');
      const state=fixture.state();fixture.root.unmount();return {selected:state.chat,activeTab:state.activeTab};
    `)
    expect(result).toEqual({ selected: 'recent', activeTab: 'recent' })
  }, 30_000)

  test('When 目标模式列表为空或仅有归档对话 Then 仅切换模式并保留当前会话与标签', async () => {
    const result = await renderer.run<Array<{ mode: string; selected: string | null; activeTab: string | null; tabs: string[]; calls: number }>>(`
      const api=window.modeSwitcherRegression,results=[];
      for(const chats of [[],[{id:'archived',title:'已归档对话',archived:true}]]) {
        const fixture=await api.mount({chats,lastAgent:'agent',activeTab:'agent',tabs:[{id:'agent',sessionId:'agent',type:'agent',title:'当前任务'}]});
        fixture.button('Chat').click();await api.until(()=>fixture.state().mode==='chat');
        const state=fixture.state();results.push({mode:state.mode,selected:state.chat,activeTab:state.activeTab,tabs:state.tabs,calls:fixture.calls.length});fixture.root.unmount();
      }
      return results;
    `)
    expect(result).toEqual([
      { mode: 'chat', selected: null, activeTab: 'agent', tabs: ['agent'], calls: 0 },
      { mode: 'chat', selected: null, activeTab: 'agent', tabs: ['agent'], calls: 0 },
    ])
  }, 30_000)
})
