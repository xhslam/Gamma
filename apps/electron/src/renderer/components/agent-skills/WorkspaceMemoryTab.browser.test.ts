import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider, createStore } from 'jotai';
    import { TooltipProvider } from '@/components/ui/tooltip';
    import { WorkspaceMemoryTab } from '@/components/agent-skills/WorkspaceMemoryTab';
    import { memoryFileNavigationAtom } from '@/atoms/memory-change-atoms';
    import { automaticMemoryNavigationAtom } from '@/atoms/automatic-memory-atoms';
    import '@/styles/globals.css';
    const store=createStore();
    window.electronAPI={
      getWorkspaceMemorySummary:async()=>({agentsMd:{path:'/demo/AGENTS.md'},autoMemory:{directory:'/demo/memory',fileCount:1}}),
      listWorkspaceAutoMemoryFiles:async()=>[{name:'MEMORY.md',relativePath:'MEMORY.md',type:'file',size:20}],
      readWorkspaceAgentsMd:async()=>({content:'# 项目规则'}),
      readWorkspaceAutoMemoryFile:async()=>({relativePath:'MEMORY.md',content:'# 协作索引'}),
      onAutomaticMemoryChanged:()=>()=>{},
      getAutomaticMemorySnapshot:async()=>({settings:{enabled:false,includeSensitive:false},entries:[],revision:1}),
    };
    document.getElementById('root').style.cssText='width:560px;height:700px;padding:12px';
    createRoot(document.getElementById('root')).render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(WorkspaceMemoryTab,{workspaceSlug:'demo',embedded:true}))));
    window.memoryViewTest={
      wait:async(predicate)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20))}throw new Error('等待页面超时：'+document.body.innerText)},
      file:()=>store.set(memoryFileNavigationAtom,{workspaceSlug:'demo',relativePath:'MEMORY.md',mode:'file'}),
      classified:()=>store.set(automaticMemoryNavigationAtom,{workspaceSlug:'demo',entryId:'missing'}),
    };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

const setup = `
  const t=window.memoryViewTest;
  const visible=(el)=>Boolean(el&&el.getBoundingClientRect().height);
  await t.wait(()=>document.body.innerText.includes('还没有保存的记忆'));
  await t.wait(()=>document.querySelector('[role="tabpanel"][data-state="inactive"]')?.textContent.includes('项目指令与长期记忆'));
  const tab=(name)=>Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent===name);
  const select=(name)=>{const el=tab(name);el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));el.click()};
`

describe('Given 项目记忆的分类与文件双视图', () => {
  test('When 默认打开和来回切换 Then 只展示当前视图且文件编辑器保持挂载', async () => {
    const result = await renderer.run(`${setup}
      const files=document.querySelector('[role="tabpanel"][data-state="inactive"]');
      const initiallyHidden=!visible(files);
      select('记忆文件');await t.wait(()=>visible(files));
      const editor=files.querySelector('[contenteditable="true"]');
      select('分类记忆');await t.wait(()=>!visible(files));
      select('记忆文件');await t.wait(()=>visible(files));
      return {initiallyHidden,editorKept:Boolean(editor)&&files.contains(editor),overflow:document.getElementById('root').scrollWidth>560};
    `)
    expect(result).toEqual({ initiallyHidden: true, editorKept: true, overflow: false })
  }, 30_000)

  test('When 从外部定位文件或分类条目 Then 自动进入对应视图', async () => {
    const result = await renderer.run(`${setup}
      t.file();await t.wait(()=>tab('记忆文件').getAttribute('aria-selected')==='true');
      await t.wait(()=>document.body.innerText.includes('/demo/memory/MEMORY.md'));
      const fileOpened=document.body.innerText.includes('协作索引');
      t.classified();await t.wait(()=>tab('分类记忆').getAttribute('aria-selected')==='true');
      return {fileOpened,classifiedVisible:document.body.innerText.includes('还没有保存的记忆')};
    `)
    expect(result).toEqual({ fileOpened: true, classifiedVisible: true })
  }, 30_000)
  test('When 在窄面板切换深浅主题 Then 文件视图不横向溢出', async () => {
    const result = await renderer.run(`${setup}
      const root=document.getElementById('root');root.style.width='360px';
      select('记忆文件');
      await t.wait(()=>tab('记忆文件').getAttribute('aria-selected')==='true');
      const lightOverflow=root.scrollWidth>root.clientWidth;
      document.documentElement.classList.add('dark');
      await new Promise(r=>requestAnimationFrame(r));
      return {lightOverflow,darkOverflow:root.scrollWidth>root.clientWidth};
    `)
    expect(result).toEqual({ lightOverflow: false, darkOverflow: false })
  }, 30_000)

})
