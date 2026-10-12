import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore, useAtomValue } from 'jotai'
    import { WorkspacePanels } from '@/components/app-shell/WorkspacePanels'
    import { DiffPanelTabBar } from '@/components/diff/DiffPanelTabBar'
    import { AgentHeader } from '@/components/agent/AgentHeader'
    import { BrowserSlot } from '@/components/browser/BrowserSlot'
    import { TooltipProvider } from '@/components/ui/tooltip'
    import { getWorkspaceResizeWidth, clampRightPanelWidth } from '@/components/app-shell/right-panel-layout'
    import { currentAgentSessionIdAtom, agentSessionsAtom, agentSidePanelLayoutAtomFamily, agentSidePanelLayoutMapAtom, agentSidePanelOpenAtomFamily } from '@/atoms/agent-atoms'
    import '@/styles/globals.css'
    document.head.insertAdjacentHTML('beforeend','<style>html,body,#root{height:100%;margin:0}#root{width:800px;height:500px;display:flex}</style>')
    const delay = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async predicate => { for(let i=0;i<150;i++){if(predicate())return;await delay(10)}throw new Error('工作区布局未达到预期状态') }
    window.workspaceLayoutRegression = {
      delay, until,
      async mount(layouts) {
        const store=createStore(), root=createRoot(document.getElementById('root')), calls=[], mounts={agent:0,workspace:0};
        window.electronAPI={setAgentBrowserLayout:async input=>calls.push(input)};
        store.set(currentAgentSessionIdAtom,'A');
        store.set(agentSessionsAtom,[{id:'A',title:'会话A',updatedAt:2},{id:'B',title:'会话B',updatedAt:1}]);
        store.set(agentSidePanelLayoutMapAtom,layouts ?? {A:{width:300,hasOpenedWideWorkspace:false,widePanelWidthOverride:null}});
        const Draft=({name})=>{React.useEffect(()=>{mounts[name]++},[]);return React.createElement('input',{'aria-label':name+'草稿',defaultValue:name+'初稿'})};
        function Shell(){
          const sessionId=useAtomValue(currentAgentSessionIdAtom), layout=useAtomValue(agentSidePanelLayoutAtomFamily(sessionId)), open=useAtomValue(agentSidePanelOpenAtomFamily(sessionId));
          const side=layout.workspaceSide==='left'?'left':'right';
          const setWidth=width=>store.set(agentSidePanelLayoutAtomFamily(sessionId),previous=>({...previous,width:clampRightPanelWidth(width,800,240,0,true)}));
          const resizeStart=event=>{const start=event.clientX, width=layout.width;const move=next=>setWidth(getWorkspaceResizeWidth(width,start,next.clientX,side));const finish=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',finish)};document.addEventListener('mousemove',move);document.addEventListener('mouseup',finish)};
          const resizeKey=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setWidth(getWorkspaceResizeWidth(layout.width,0,event.key==='ArrowLeft'?-24:24,side))}};
          return React.createElement(WorkspacePanels,{workspaceSide:side,workspaceOpen:open,workspaceWidth:layout.width,minimumWidth:240,maximumWidth:480,onResizeStart:resizeStart,onResizeKeyDown:resizeKey,
            agent:React.createElement(React.Fragment,null,React.createElement(AgentHeader,{sessionId}),React.createElement(Draft,{name:'agent'})),
            workspace:React.createElement('div',{style:{width:open?layout.width:0,height:'100%',display:'flex',flexDirection:'column',overflow:'hidden'}},React.createElement(DiffPanelTabBar,{tabs:[{id:'files',label:'文件',icon:null}],activeTab:'files',onTabChange:()=>{},onCloseTab:()=>{},onOpenBrowser:()=>{},onOpenFile:()=>{},onClose:()=>store.set(agentSidePanelOpenAtomFamily(sessionId),false)}),React.createElement(Draft,{name:'workspace'}),React.createElement(BrowserSlot,{sessionId,tabId:'native-browser'}))
          });
        }
        const render=()=>root.render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(Shell))));render();
        await until(()=>document.querySelector('[aria-label="交换 Agent 与工作区位置"]'));await delay(80);
        return {root,store,calls,mounts,render,
          side:()=>store.get(agentSidePanelLayoutAtomFamily(store.get(currentAgentSessionIdAtom))).workspaceSide ?? 'right',
          width:()=>store.get(agentSidePanelLayoutAtomFamily(store.get(currentAgentSessionIdAtom))).width,
          switchSession:id=>store.set(currentAgentSessionIdAtom,id),
          persisted:()=>JSON.parse(localStorage.getItem('gamma-agent-workspace-layout-by-session')),
          swap:()=>document.querySelector('[aria-label="交换 Agent 与工作区位置"]').click(),
          order:()=>[...document.querySelector('[data-testid="agent-workspace-layout"]').children].map(node=>node.dataset.workspacePane),
        };
      }
    }
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 Chromium Agent 与展示工作区布局', () => {
  test('When 点击交换并再次交换 Then DOM顺序、焦点与原生浏览器坐标更新且草稿不重挂载', async () => {
    const result = await renderer.run<{ initial: string[]; swapped: string[]; restored: string[]; retained: boolean; focus: boolean; pressed: string; mounts: { agent: number; workspace: number }; browserMoved: boolean; width: number }>(`
      const api=window.workspaceLayoutRegression, fixture=await api.mount();const initial=fixture.order();
      const agent=document.querySelector('[aria-label="agent草稿"]'), workspace=document.querySelector('[aria-label="workspace草稿"]');agent.value='Agent未发送';workspace.value='Markdown未保存';
      const before=fixture.calls.filter(call=>call.visible).at(-1).bounds;fixture.swap();await api.until(()=>fixture.side()==='left' && fixture.order()[0]==='workspace');await api.delay(80);
      const swapped=fixture.order(), pressed=document.querySelector('[aria-label="交换 Agent 与工作区位置"]').getAttribute('aria-pressed');
      const focus=document.activeElement.getAttribute('aria-label')==='交换 Agent 与工作区位置';const after=fixture.calls.filter(call=>call.visible).at(-1).bounds;
      const retained=agent===document.querySelector('[aria-label="agent草稿"]') && workspace===document.querySelector('[aria-label="workspace草稿"]') && agent.value==='Agent未发送' && workspace.value==='Markdown未保存';
      fixture.swap();await api.until(()=>fixture.side()==='right');await api.delay();const restored=fixture.order(),width=fixture.width();fixture.root.unmount();
      return {initial,swapped,restored,retained,focus,pressed,mounts:fixture.mounts,browserMoved:after.x<before.x && after.width===before.width,width};
    `)
    expect(result).toEqual({ initial: ['agent', 'workspace'], swapped: ['workspace', 'agent'], restored: ['agent', 'workspace'], retained: true, focus: true, pressed: 'true', mounts: { agent: 1, workspace: 1 }, browserMoved: true, width: 300 })
  }, 30_000)

  test('When 旧布局交换、切换会话、折叠后展开 Then 方向按会话保存并保留尺寸与内容', async () => {
    const result = await renderer.run<{ legacyRight: boolean; savedLeft: boolean; anotherRight: boolean; returnedLeft: boolean; collapsed: boolean; expandedLeft: boolean; savedWidths: number[] }>(`
      const api=window.workspaceLayoutRegression,fixture=await api.mount({A:{width:300,hasOpenedWideWorkspace:true,widePanelWidthOverride:420},B:{width:280,hasOpenedWideWorkspace:false,widePanelWidthOverride:null}});
      const legacyRight=fixture.side()==='right';fixture.swap();await api.until(()=>fixture.side()==='left');const saved=fixture.persisted();const savedLeft=saved.A.workspaceSide==='left';
      fixture.switchSession('B');await api.until(()=>fixture.side()==='right' && fixture.order()[0]==='agent');const anotherRight=fixture.order()[0]==='agent';fixture.switchSession('A');await api.until(()=>fixture.side()==='left' && fixture.order()[0]==='workspace');const returnedLeft=fixture.order()[0]==='workspace';
      document.querySelector('[aria-label="折叠左侧工作区"]').click();await api.until(()=>document.querySelector('[aria-label="展开左侧工作区"]'));const collapsed=!document.querySelector('[aria-label="调整工作区宽度"]');
      document.querySelector('[aria-label="展开左侧工作区"]').click();await api.until(()=>document.querySelector('[aria-label="调整工作区宽度"]'));const expandedLeft=fixture.side()==='left' && fixture.order()[0]==='workspace';fixture.root.unmount();
      return {legacyRight,savedLeft,anotherRight,returnedLeft,collapsed,expandedLeft,savedWidths:[saved.A.width,saved.A.widePanelWidthOverride,saved.B.width]};
    `)
    expect(result).toEqual({ legacyRight: true, savedLeft: true, anotherRight: true, returnedLeft: true, collapsed: true, expandedLeft: true, savedWidths: [300, 420, 280] })
  }, 30_000)

  test('When 在两侧拖拽或通过方向键调整分隔条 Then 分隔条位于相邻边缘且宽度按视觉方向改变', async () => {
    const result = await renderer.run<{ rightDrag: number; leftDrag: number; keyWidth: number; rightEdge: boolean; leftEdge: boolean; keyboardReachable: boolean }>(`
      const api=window.workspaceLayoutRegression,fixture=await api.mount();let handle=document.querySelector('[role="separator"]');const rightEdge=handle.classList.contains('left-0');
      handle.dispatchEvent(new MouseEvent('mousedown',{clientX:500,bubbles:true}));document.dispatchEvent(new MouseEvent('mousemove',{clientX:540,bubbles:true}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await api.delay();const rightDrag=fixture.width();
      fixture.swap();await api.until(()=>fixture.side()==='left');handle=document.querySelector('[role="separator"]');const leftEdge=handle.classList.contains('right-0');
      handle.dispatchEvent(new MouseEvent('mousedown',{clientX:260,bubbles:true}));document.dispatchEvent(new MouseEvent('mousemove',{clientX:300,bubbles:true}));document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await api.delay();const leftDrag=fixture.width();
      handle.focus();const keyboardReachable=document.activeElement===handle && handle.tabIndex===0;handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));await api.delay();const keyWidth=fixture.width();fixture.root.unmount();return {rightDrag,leftDrag,keyWidth,rightEdge,leftEdge,keyboardReachable};
    `)
    expect(result).toEqual({ rightDrag: 260, leftDrag: 300, keyWidth: 276, rightEdge: true, leftEdge: true, keyboardReachable: true })
  }, 30_000)
})
