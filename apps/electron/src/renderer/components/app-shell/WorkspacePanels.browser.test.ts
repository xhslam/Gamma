import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore, useAtomValue } from 'jotai'
    import { beginPaneResize, commitPaneResize, isPaneResizeProtected } from '@/lib/pane-resize-policy'
    import { WorkspacePanels } from '@/components/app-shell/WorkspacePanels'
    import { DiffPanelTabBar } from '@/components/diff/DiffPanelTabBar'
    import { AgentHeader } from '@/components/agent/AgentHeader'
    import { BrowserSlot } from '@/components/browser/BrowserSlot'
    import { TooltipProvider } from '@/components/ui/tooltip'
    import { getWorkspaceResizeWidth, clampRightPanelWidth } from '@/components/app-shell/right-panel-layout'
    import { currentAgentSessionIdAtom, agentSessionsAtom, agentSidePanelLayoutAtomFamily, agentSidePanelLayoutMapAtom, agentSidePanelOpenAtomFamily, agentWorkspaceTabIdsAtom } from '@/atoms/agent-atoms'
    import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
    import '@/styles/globals.css'
    document.head.insertAdjacentHTML('beforeend','<style>html,body,#root{height:100%;margin:0}#root{width:800px;height:500px;display:flex}</style>')
    const delay = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async predicate => { for(let i=0;i<150;i++){if(predicate())return;await delay(10)}throw new Error('工作区布局未达到预期状态') }
    window.workspaceLayoutRegression = {
      delay, until, beginPaneResize, commitPaneResize, isPaneResizeProtected,
      async commitFixture(side) {
        const store=createStore(), widthAtom=(await import('jotai')).atom(300), root=createRoot(document.getElementById('root'));
        let start, finish;
        function Shell(){
          const width=useAtomValue(widthAtom), [preview,setPreview]=React.useState(null);
          start=value=>setPreview(value);
          finish=value=>commitPaneResize(()=>store.set(widthAtom,value),()=>setPreview(null));
          return React.createElement(WorkspacePanels,{workspaceSide:side,workspaceOpen:true,workspaceWidth:preview??width,minimumWidth:200,maximumWidth:600,resizing:preview!==null,onResizeStart:()=>{},onResizeKeyDown:()=>{},agent:React.createElement('div'),workspace:React.createElement('div')});
        }
        root.render(React.createElement(Provider,{store},React.createElement(Shell)));
        await until(()=>document.querySelector('[data-sidebar-region="workspace"]'));
        start(420);await until(()=>document.querySelector('[data-sidebar-region="workspace"]').style.width==='420px');
        const pane=document.querySelector('[data-sidebar-region="workspace"]'), widths=[];
        const observer=new MutationObserver(()=>widths.push(pane.style.width));observer.observe(pane,{attributes:true,attributeFilter:['style']});
        finish(420);await delay(50);observer.disconnect();
        const result={width:pane.style.width,stored:store.get(widthAtom),widths};root.unmount();return result;
      },
      async mount(layouts) {
        const store=createStore(), root=createRoot(document.getElementById('root')), calls=[], mounts={agent:0,workspace:0};
        window.electronAPI={setAgentBrowserLayout:async input=>calls.push(input)};
        store.set(currentAgentSessionIdAtom,'A');
        store.set(agentSidePanelOpenAtomFamily('A'),true);
        store.set(agentWorkspaceTabIdsAtom,new Map([['A',['terminal:layout']],['B',['terminal:layout']]]));
        store.set(agentSessionsAtom,[{id:'A',title:'会话A',updatedAt:2},{id:'B',title:'会话B',updatedAt:1}]);
        store.set(agentSidePanelLayoutMapAtom,layouts ?? {A:{width:300,hasOpenedWideWorkspace:false,widePanelWidthOverride:null}});
        const Draft=({name})=>{React.useEffect(()=>{mounts[name]++},[]);return React.createElement('input',{'aria-label':name+'草稿',defaultValue:name+'初稿'})};
        function Shell(){
          const sessionId=useAtomValue(currentAgentSessionIdAtom), layout=useAtomValue(agentSidePanelLayoutAtomFamily(sessionId)), open=useAtomValue(agentSidePanelOpenAtomFamily(sessionId));
          const side=layout.workspaceSide==='left'?'left':'right';
          const setWidth=width=>store.set(agentSidePanelLayoutAtomFamily(sessionId),previous=>({...previous,width:clampRightPanelWidth(width,800,240,0,true)}));
          const resizeStart=event=>{const start=event.clientX, width=layout.width;const move=next=>setWidth(getWorkspaceResizeWidth(width,start,next.clientX,side));const finish=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish)};document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish)};
          const resizeKey=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setWidth(getWorkspaceResizeWidth(layout.width,0,event.key==='ArrowLeft'?-24:24,side))}};
          return React.createElement(WorkspacePanels,{workspaceSide:side,workspaceOpen:open,workspaceWidth:layout.width,minimumWidth:240,maximumWidth:480,onResizeStart:resizeStart,onResizeKeyDown:resizeKey,
            agent:React.createElement(React.Fragment,null,React.createElement(AgentHeader,{sessionId}),React.createElement(Draft,{name:'agent'})),
            workspace:React.createElement('div',{style:{width:layout.width,height:'100%',display:'flex',flexDirection:'column',overflow:'hidden'}},React.createElement(DiffPanelTabBar,{tabs:[{id:'terminal:layout',label:'终端',icon:null}],activeTab:'terminal:layout',onTabChange:()=>{},onCloseTab:()=>{},onOpenBrowser:()=>{},onOpenFile:()=>{},onClose:()=>store.set(agentSidePanelOpenAtomFamily(sessionId),false)}),React.createElement(Draft,{name:'workspace'}),React.createElement(BrowserSlot,{sessionId,tabId:'native-browser'}))
          });
        }
        const render=()=>root.render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(Shell))));render();
        await until(()=>document.querySelector('[aria-label="交换 Agent 与工作区位置"]'));
        await until(()=>document.querySelector('[data-sidebar-region="workspace"]').getBoundingClientRect().width===store.get(agentSidePanelLayoutAtomFamily('A')).width&&calls.at(-1)?.visible&&calls.at(-1).bounds.width===store.get(agentSidePanelLayoutAtomFamily('A')).width);
        return {root,store,calls,mounts,render,
          side:()=>store.get(agentSidePanelLayoutAtomFamily(store.get(currentAgentSessionIdAtom))).workspaceSide ?? 'right',
          width:()=>store.get(agentSidePanelLayoutAtomFamily(store.get(currentAgentSessionIdAtom))).width,
          switchSession:id=>store.set(currentAgentSessionIdAtom,id),
          collapse:value=>store.set(sidebarCollapsedAtom,value),
          collapsed:()=>store.get(sidebarCollapsedAtom),
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
  test('When 收起侧栏并交换两侧工作区 Then 展开入口、唯一会话标题与工作区标签在同一行且避开红绿灯', async () => {
    const results = await renderer.run(`
      const api=window.workspaceLayoutRegression,fixture=await api.mount(),results=[];
      const draft=document.querySelector('[aria-label="agent草稿"]');draft.value='保留草稿';
      fixture.collapse(true);await api.delay();
      for(const side of ['right','left']) {
        if(fixture.side()!==side){fixture.swap();await api.until(()=>fixture.side()===side);await api.delay();}
        const button=document.querySelector('[aria-label="展开侧边栏"]');
        const title=document.querySelector('[aria-label="会话菜单：会话A"]'),tabs=document.querySelector('[role="tablist"]');
        const titleRect=title.getBoundingClientRect(),tabsRect=tabs.getBoundingClientRect();
        results.push({oneButton:document.querySelectorAll('[aria-label="展开侧边栏"]').length===1,
          oneTitle:document.querySelectorAll('[aria-label="会话菜单：会话A"]').length===1,
          sameRow:Math.abs((titleRect.top+titleRect.bottom)/2-(tabsRect.top+tabsRect.bottom)/2)<4,
          inset:!!button && button.getBoundingClientRect().left>=80,
          leading:!!button && button.closest('[data-workspace-pane]').dataset.workspacePane===(side==='left'?'workspace':'agent'),
          draftRetained:draft===document.querySelector('[aria-label="agent草稿"]')&&draft.value==='保留草稿'});
      }
      document.querySelector('[aria-label="展开侧边栏"]')?.click();await api.delay();
      results.push({expanded:!fixture.collapsed()});
      fixture.root.unmount();return results;
    `)
    expect(results).toEqual([
      {oneButton:true,oneTitle:true,sameRow:true,inset:true,leading:true,draftRetained:true},
      {oneButton:true,oneTitle:true,sameRow:true,inset:true,leading:true,draftRetained:true},
      {expanded:true},
    ])
  }, 30_000)
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
      handle.dispatchEvent(new PointerEvent('pointerdown',{clientX:500,bubbles:true}));document.dispatchEvent(new PointerEvent('pointermove',{clientX:540,bubbles:true}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await api.delay();const rightDrag=fixture.width();
      fixture.swap();await api.until(()=>fixture.side()==='left');handle=document.querySelector('[role="separator"]');const leftEdge=handle.classList.contains('right-0');
      handle.dispatchEvent(new PointerEvent('pointerdown',{clientX:260,bubbles:true}));document.dispatchEvent(new PointerEvent('pointermove',{clientX:300,bubbles:true}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await api.delay();const leftDrag=fixture.width();
      handle.focus();const keyboardReachable=document.activeElement===handle && handle.tabIndex===0;handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));await api.delay();const keyWidth=fixture.width();fixture.root.unmount();return {rightDrag,leftDrag,keyWidth,rightEdge,leftEdge,keyboardReachable};
    `)
    expect(result).toEqual({ rightDrag: 260, leftDrag: 300, keyWidth: 276, rightEdge: true, leftEdge: true, keyboardReachable: true })
  }, 30_000)
})


describe('Given 共享真实 pointer 分栏事务与 BrowserSlot', () => {
  test('When 两侧工作区松手提交预览宽度 Then 不出现旧宽度且保存最终值', async () => {
    for (const side of ['left', 'right']) {
      const result = await renderer.run(`return await window.workspaceLayoutRegression.commitFixture('${side}')`)
      expect(result).toEqual({ width: '420px', stored: 420, widths: [] })
    }
  }, 30_000)

  test('When 死区内点击、Escape、pointercancel、失焦或 capture 丢失 Then 回滚快照并解除原生与iframe保护', async () => {
    const results = await renderer.run(`
      const api=window.workspaceLayoutRegression,fixture=await api.mount(),results=[];
      for (const reason of ['deadzone','Escape','pointercancel','blur','lostpointercapture','commit']) {
        const target=document.querySelector('[role="separator"]');
        let width=300, sidebarOpen=true, saved=300, finishes=0;
        const start=fixture.calls.length;
        const cancel=api.beginPaneResize({target,pointerId:12,startX:100,
          move:x=>{width=300+x-100;sidebarOpen=false},
          finish:commit=>{finishes++;if(commit)saved=width;else{width=300;sidebarOpen=true}}});
        const protectedNative=fixture.calls.slice(start).some(call=>!call.visible&&call.preserveSessionOnHide);
        const shield=document.querySelector('[data-pane-resize-shield]');
        const shieldHit=shield===document.elementFromPoint(20,200);
        document.dispatchEvent(new PointerEvent('pointermove',{pointerId:99,clientX:200}));
        const otherPointerIgnored=width===300;
        const x=reason==='deadzone'?104:160;
        document.dispatchEvent(new PointerEvent('pointermove',{pointerId:12,clientX:x}));
        if(reason==='Escape')document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        else if(reason==='pointercancel')document.dispatchEvent(new PointerEvent('pointercancel',{pointerId:12}));
        else if(reason==='blur')window.dispatchEvent(new Event('blur'));
        else if(reason==='lostpointercapture')target.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:12}));
        else document.dispatchEvent(new PointerEvent('pointerup',{pointerId:12,clientX:x}));
        cancel();await api.delay(50);
        results.push({reason,protectedNative,shieldHit,otherPointerIgnored,width,saved,sidebarOpen,finishes,
          cleaned:!document.querySelector('[data-pane-resize-shield]')&&!api.isPaneResizeProtected(),
          restoredNative:fixture.calls.at(-1).visible});
      }
      fixture.root.unmount();return results;
    `)
    expect(results).toEqual(['deadzone', 'Escape', 'pointercancel', 'blur', 'lostpointercapture', 'commit'].map(reason => ({
      reason, protectedNative: true, shieldHit: true, otherPointerIgnored: true,
      width: reason === 'commit' ? 360 : 300, saved: reason === 'commit' ? 360 : 300,
      sidebarOpen: reason !== 'commit', finishes: 1, cleaned: true, restoredNative: true,
    })))
  }, 30_000)
})
