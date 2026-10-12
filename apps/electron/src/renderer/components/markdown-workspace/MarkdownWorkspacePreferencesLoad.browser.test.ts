import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES } from '@gamma/shared'
    import { MarkdownWorkspaceView } from '@/components/markdown-workspace/MarkdownWorkspaceView'
    import { markdownWorkspaceStateAtomFamily } from '@/atoms/markdown-workspace-atoms'
    import { markdownEditorPreferencesErrorAtom } from '@/atoms/markdown-editor-preferences'
    import '@/styles/globals.css'
    const delay=()=>new Promise(resolve=>setTimeout(resolve,80))
    const until=async(predicate)=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('工作区没有完成操作')}
    window.markdownLoadRegression={DEFAULT_MARKDOWN_EDITOR_PREFERENCES,delay,until,async open(){
      const root=createRoot(document.getElementById('root'));const store=createStore();const scope={workspaceId:'delayed-preferences'};
      let resolveSettings,rejectSettings,read=false,writes=0;const settings=new Promise((resolve,reject)=>{resolveSettings=resolve;rejectSettings=reject});
      window.electronAPI={getSettings:()=>settings,updateSettings:async()=>{writes++;throw new Error('打开文档不能保存偏好')},openExternal:async()=>{},markdownWorkspace:async input=>{
        if(input.action==='choose')return{status:'source',source:{id:'slow',name:'slow.md',kind:'file'}};
        if(input.action==='read'){read=true;return{status:'document',document:{id:'slow-doc',sourceId:'slow',name:'slow.md',path:'',content:'正文',revision:'r1',writable:true,sourceOnly:false}}}
        if(input.action==='save'){writes++;throw new Error('打开文档不能写盘')}
        return{status:'media',url:null};
      }};
      root.render(React.createElement(Provider,{store},React.createElement(MarkdownWorkspaceView,scope)));
      await until(()=>document.querySelector('[data-testid="markdown-workspace"]'));const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='打开 Markdown');button.click();
      await until(()=>read);await delay();const stateAtom=markdownWorkspaceStateAtomFamily(JSON.stringify(scope));
      return{root,resolveSettings,rejectSettings,state:()=>store.get(stateAtom),error:()=>store.get(markdownEditorPreferencesErrorAtom),writes:()=>writes};
    }};
  `)
}, 240_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 首次文档打开与异步偏好加载', () => {
  test('When 文件先于已保存设置返回 Then 等待偏好并按富文本默认视图打开而不写盘', async () => {
    const result = await renderer.run<{ pendingMode: string | null; mode: string; editing: boolean; writes: number }>(`
      const api=window.markdownLoadRegression;const fixture=await api.open();const pending=fixture.state();const pendingMode=pending.activeId?pending.documents[pending.activeId].mode:null;
      fixture.resolveSettings({markdownEditor:{...api.DEFAULT_MARKDOWN_EDITOR_PREFERENCES,defaultMode:'rich'}});await api.until(()=>fixture.state().activeId);await api.delay();
      const state=fixture.state(),active=state.documents[state.activeId];fixture.root.unmount();return{pendingMode,mode:active.mode,editing:active.editing,writes:fixture.writes()};
    `)
    expect(result).toEqual({ pendingMode: null, mode: 'rich', editing: true, writes: 0 })
  }, 30_000)

  test('When 首次偏好加载失败 Then 文档按安全默认视图打开且保留可见偏好错误', async () => {
    const result = await renderer.run<{ mode: string; editing: boolean; error: string | null; writes: number }>(`
      const api=window.markdownLoadRegression;const fixture=await api.open();fixture.rejectSettings(new Error('设置读取暂不可用'));
      await api.until(()=>fixture.state().activeId);const state=fixture.state(),active=state.documents[state.activeId];const error=fixture.error();fixture.root.unmount();return{mode:active.mode,editing:active.editing,error,writes:fixture.writes()};
    `)
    expect(result).toEqual({ mode: 'rich', editing: true, error: '设置读取暂不可用', writes: 0 })
  }, 30_000)
})
