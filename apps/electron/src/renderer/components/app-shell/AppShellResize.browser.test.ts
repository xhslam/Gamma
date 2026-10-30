import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  const moduleStubs: Record<string, string> = {}
  for (const [path, name] of [
    ['components/app-shell/LeftSidebar.tsx', 'LeftSidebar'],
    ['components/app-shell/CollapsedSidebarHeader.tsx', 'CollapsedSidebarHeader'],
    ['components/app-shell/RightSidePanel.tsx', 'RightSidePanel'],
    ['components/tabs/MainArea.tsx', 'MainArea'],
    ['components/agent-skills/WorkspaceMemoryChangeObserver.tsx', 'WorkspaceMemoryChangeObserver'],
    ['components/tabs/TerminalLifecycleObserver.tsx', 'TerminalLifecycleObserver'],
    ['components/WindowControls.tsx', 'WindowControls'],
    ['components/settings/SettingsPanel.tsx', 'SettingsPanel'],
    ['components/computer-use/index.ts', 'ComputerModals'],
    ['components/ui/sonner.tsx', 'Toaster'],
  ]) moduleStubs[path!] = `export function ${name}(){return null}`
  moduleStubs['hooks/useProjectActions.ts'] = 'export function useProjectActions(){return {workspaces:[],currentWorkspaceId:null}}'
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai';
    import {AppShell} from '@/components/app-shell/AppShell';
    import {currentAgentSessionIdAtom,agentSessionsAtom,agentSidePanelLayoutMapAtom,agentSidePanelLayoutAtomFamily,currentSessionSidePanelOpenAtom,agentDiffPanelTabAtom} from '@/atoms/agent-atoms';
    import {sidebarCollapsedAtom} from '@/atoms/tab-atoms';
    import '@/styles/globals.css';
    const delay=(ms=30)=>new Promise(r=>setTimeout(r,ms));
    window.resizeFixture={async mount(side='right',wide=true,collapsed=true){
      const store=createStore(),root=createRoot(document.getElementById('root'));
      store.set(currentAgentSessionIdAtom,'resize');
      store.set(agentSessionsAtom,[{id:'resize',title:'调宽',createdAt:1,updatedAt:1}]);
      store.set(agentSidePanelLayoutMapAtom,{resize:{width:300,hasOpenedWideWorkspace:wide,widePanelWidthOverride:wide?400:null,workspaceSide:side}});
      store.set(agentDiffPanelTabAtom,new Map([['resize',wide?'delegation':'files']]));
      store.set(currentSessionSidePanelOpenAtom,true);
      store.set(sidebarCollapsedAtom,collapsed);
      root.render(React.createElement(Provider,{store},React.createElement(AppShell)));
      await delay(500);
      const events=[];
      for(const type of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture','blur','dblclick'])window.addEventListener(type,e=>events.push({type,x:e.clientX}),true);
      return {root,store,events,delay,layout:()=>store.get(agentSidePanelLayoutAtomFamily('resize'))};
    }};
  `, {
    moduleStubs,
    mainProcessSetup: `const {ipcMain}=require('electron');ipcMain.handle('shell-resize-input',async(event,input)=>{const d=event.sender.debugger;if(!d.isAttached())d.attach('1.3');const type={mouseDown:'mousePressed',mouseUp:'mouseReleased',mouseMove:'mouseMoved'}[input.type];await d.sendCommand('Input.dispatchMouseEvent',{type,x:input.x,y:input.y,button:input.button??'none',buttons:input.type==='mouseUp'?0:input.button==='left'?1:0,clickCount:input.clickCount??0});await new Promise(r=>setTimeout(r,35));});`,
    preloadSource: `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('shellResizeInput',input=>ipcRenderer.invoke('shell-resize-input',input));`,
  })
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 AppShell 宽度预览与持久化', () => {
  test('When 双击序列中任一次发生拖动 Then 松手仍保留拖动宽度，不触发双击重置', async () => {
    for (const deltas of [[30,30], [30,0], [0,30]]) {
      const result=await renderer.run<{preview:number;final:number;doubleClick:boolean;captured:boolean}>(`
      const f=await window.resizeFixture.mount('right',true);
      const handle=document.querySelector('[role="separator"]');
      let preview;
      const deltas=${JSON.stringify(deltas)};
      for(const clickCount of [1,2]){
        const delta=deltas[clickCount-1];
        const box=handle.getBoundingClientRect(),x=Math.round(box.x+box.width/2),y=200;
        await window.shellResizeInput({type:'mouseMove',x,y});
        await window.shellResizeInput({type:'mouseDown',x,y,button:'left',clickCount});
        await window.shellResizeInput({type:'mouseMove',x:x-delta,y,button:'left'});
        preview=Number(handle.getAttribute('aria-valuenow'));
        await window.shellResizeInput({type:'mouseUp',x:x-delta,y,button:'left',clickCount});
      }
      await f.delay(400);
      const result={preview,final:Number(handle.getAttribute('aria-valuenow')),doubleClick:f.events.some(e=>e.type==='dblclick'),captured:f.events.some(e=>e.type==='gotpointercapture')};f.root.unmount();return result;
    `)
      expect(result.doubleClick).toBe(true)
      expect(result.captured).toBe(true)
      expect(result.final).toBe(result.preview)
    }
  },30_000)

  test('When 拖动完成后双击分隔条 Then 保持当前宽度不重置', async () => {
    const result=await renderer.run<number>(`
      const f=await window.resizeFixture.mount('right',true);
      const handle=document.querySelector('[role="separator"]');
      let box=handle.getBoundingClientRect(),x=Math.round(box.x+box.width/2),y=200;
      await window.shellResizeInput({type:'mouseMove',x,y});
      await window.shellResizeInput({type:'mouseDown',x,y,button:'left',clickCount:1});
      await window.shellResizeInput({type:'mouseMove',x:x-60,y,button:'left'});
      await window.shellResizeInput({type:'mouseUp',x:x-60,y,button:'left',clickCount:1});
      for(const clickCount of [1,2]){
        box=handle.getBoundingClientRect();x=Math.round(box.x+box.width/2);
        await window.shellResizeInput({type:'mouseDown',x,y,button:'left',clickCount});
        await window.shellResizeInput({type:'mouseUp',x,y,button:'left',clickCount});
      }
      await f.delay(400);const width=Number(handle.getAttribute('aria-valuenow'));f.root.unmount();return width;
    `)
    expect(result).toBe(460)
  },30_000)
  test('When 两侧普通和扩展工作区拖动后松手 Then 最终宽度与预览一致', async () => {
    for (const side of ['right', 'left']) {
      for (const wide of [false, true]) {
        const result = await renderer.run<{ before: number; preview: number; final: number; stored: number; events: unknown[] }>(`
          const f=await window.resizeFixture.mount('${side}',${wide});
          const handle=document.querySelector('[role="separator"]');if(!handle)throw new Error(document.body.innerHTML);
          const box=handle.getBoundingClientRect(),x=Math.round(box.x+box.width/2),y=200;
          const before=Number(handle.getAttribute('aria-valuenow'));
          const delta='${side}'==='left'?60:-60;
          await window.shellResizeInput({type:'mouseMove',x,y});
          await window.shellResizeInput({type:'mouseDown',x,y,button:'left',clickCount:1});
          await window.shellResizeInput({type:'mouseMove',x:x+delta,y,button:'left'});
          await f.delay();const preview=Number(handle.getAttribute('aria-valuenow'));
          await window.shellResizeInput({type:'mouseUp',x:x+delta,y,button:'left',clickCount:1});
          await f.delay(400);
          const result={before,preview,final:Number(handle.getAttribute('aria-valuenow')),stored:${wide}?f.layout().widePanelWidthOverride:f.layout().width,events:f.events};
          f.root.unmount();return result;
        `)
        expect(result.preview).toBe(result.before + 60)
        expect(result.final).toBe(result.preview)
        expect(result.stored).toBe(result.preview)
      }
    }
  }, 30_000)
})
