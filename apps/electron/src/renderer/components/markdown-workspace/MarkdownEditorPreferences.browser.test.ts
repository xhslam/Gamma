import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { undo } from '@codemirror/commands'
    import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES } from '@gamma/shared'
    import { MarkdownWorkspaceEditor } from '@/components/markdown-workspace/MarkdownWorkspaceEditor'
    import { MarkdownSourceEditor } from '@/components/markdown-workspace/MarkdownSourceEditor'
    import { initShortcutRegistry, registerShortcut, updateShortcutOverrides } from '@/lib/shortcut-registry'
    import '@/styles/globals.css'
    const delay=()=>new Promise(resolve=>setTimeout(resolve,80))
    const until=async(predicate)=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('编辑器没有完成挂载')}
    const mod=navigator.userAgent.includes('Mac')?{metaKey:true}:{ctrlKey:true}
    window.markdownPreferencesRegression={React,createRoot,undo,DEFAULT_MARKDOWN_EDITOR_PREFERENCES,MarkdownWorkspaceEditor,MarkdownSourceEditor,initShortcutRegistry,registerShortcut,updateShortcutOverrides,delay,until,mod}
  `)
}, 240_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 Chromium 文档偏好与快捷键', () => {
  test('When 输入法按键先于组合开始事件到达 Then 源码不误保存或缩进且正常快捷键仍可用', async () => {
    const result = await renderer.run<{ savesDuringIme: number; textDuringIme: string; savesAfter: number }>(`
      const api=window.markdownPreferencesRegression;const root=api.createRoot(document.getElementById('root'));const ref=api.React.createRef();let saves=0;
      root.render(api.React.createElement(api.MarkdownSourceEditor,{ref,value:'正文',readOnly:false,onChange:()=>{},onSave:()=>saves++}));await api.until(()=>ref.current?.view());
      const view=ref.current.view();view.focus();
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'s',...api.mod,isComposing:true,bubbles:true,cancelable:true}));
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',keyCode:229,bubbles:true,cancelable:true}));
      const savesDuringIme=saves,textDuringIme=view.state.doc.toString();view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'s',...api.mod,bubbles:true,cancelable:true}));
      root.unmount();return {savesDuringIme,textDuringIme,savesAfter:saves};
    `)
    expect(result).toEqual({ savesDuringIme: 0, textDuringIme: '正文', savesAfter: 1 })
  }, 30_000)

  test('When 富文本中按原生加粗键 Then 编辑器加粗且应用侧栏不捕获；焦点移出后侧栏仍可切换', async () => {
    const result = await renderer.run<{ bold: boolean; insideCalls: number; outsideCalls: number }>(`
      const api=window.markdownPreferencesRegression; const root=api.createRoot(document.getElementById('root'));const ref=api.React.createRef();let sidebar=0;
      api.updateShortcutOverrides({'toggle-sidebar':'CmdOrCtrl+B'});api.initShortcutRegistry();const unregister=api.registerShortcut('toggle-sidebar',()=>sidebar++);
      root.render(api.React.createElement(api.MarkdownWorkspaceEditor,{ref,documentId:'keyboard',value:'正文',editing:true,onChange:()=>{},resolveMedia:async()=>null,onError:()=>{}}));
      await api.until(()=>ref.current?.editor()?.view?.dom);const editor=ref.current.editor();editor.commands.setTextSelection({from:1,to:3});editor.view.focus();
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'b',...api.mod,bubbles:true,cancelable:true}));await api.delay();
      const bold=editor.isActive('bold'),insideCalls=sidebar;const outside=document.createElement('button');document.body.append(outside);outside.focus();
      outside.dispatchEvent(new KeyboardEvent('keydown',{key:'b',...api.mod,bubbles:true,cancelable:true}));const outsideCalls=sidebar;
      unregister();outside.remove();root.unmount();return{bold,insideCalls,outsideCalls};
    `)
    expect(result).toEqual({ bold: true, insideCalls: 0, outsideCalls: 1 })
  }, 30_000)

  test('When 源码中保存与查找 Then 命令留在文档，编辑器外的查找继续使用应用注册表', async () => {
    const result = await renderer.run<{ sourceSaves: number; globalFindsInside: number; bubbleFinds: number; globalFindsOutside: number }>(`
      const api=window.markdownPreferencesRegression;const root=api.createRoot(document.getElementById('root'));const ref=api.React.createRef();let saves=0,finds=0,bubbleFinds=0;
      api.initShortcutRegistry();const unregister=api.registerShortcut('file-find',()=>finds++);
      root.render(api.React.createElement(api.MarkdownSourceEditor,{ref,value:'正文',readOnly:false,onChange:()=>{},onSave:()=>saves++}));await api.until(()=>ref.current?.view());
      const view=ref.current.view();view.focus();view.contentDOM.addEventListener('keydown',event=>{if(event.key==='f')bubbleFinds++});
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'s',...api.mod,bubbles:true,cancelable:true}));
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'f',...api.mod,bubbles:true,cancelable:true}));
      const globalFindsInside=finds;const outside=document.createElement('button');document.body.append(outside);outside.focus();outside.dispatchEvent(new KeyboardEvent('keydown',{key:'f',...api.mod,bubbles:true,cancelable:true}));
      const result={sourceSaves:saves,globalFindsInside,bubbleFinds,globalFindsOutside:finds};unregister();outside.remove();root.unmount();return result;
    `)
    expect(result).toEqual({ sourceSaves: 1, globalFindsInside: 0, bubbleFinds: 1, globalFindsOutside: 1 })
  }, 30_000)

  test('When 实时修改源码行号、折行、缩进与字体 Then 保留编辑实例、选区和撤销且不新增文本变更', async () => {
    const result = await renderer.run<{ same: boolean; anchor: number; tabSize: number; noGutter: boolean; wrap: string; fontSize: string; fontFamily: string; changes: number; undone: string }>(`
      const api=window.markdownPreferencesRegression;const root=api.createRoot(document.getElementById('root'));const ref=api.React.createRef();let value='原正文',changes=0;
      let preferences=api.DEFAULT_MARKDOWN_EDITOR_PREFERENCES;const render=()=>root.render(api.React.createElement(api.MarkdownSourceEditor,{ref,value,readOnly:false,preferences,onChange:source=>{value=source;changes++}}));
      render();await api.until(()=>ref.current?.view());const before=ref.current.view();before.dispatch({changes:{from:0,to:before.state.doc.length,insert:'修改后的正文'},selection:{anchor:3}});await api.delay();
      preferences={...preferences,sourceLineNumbers:false,sourceWordWrap:false,tabSize:4,fontSize:22,monoFont:'menlo'};render();await api.delay();const view=ref.current.view();
      const result={same:view===before,anchor:view.state.selection.main.anchor,tabSize:view.state.tabSize,noGutter:!view.dom.querySelector('.cm-lineNumbers'),wrap:getComputedStyle(view.contentDOM).whiteSpace,fontSize:getComputedStyle(view.scrollDOM).fontSize,fontFamily:getComputedStyle(view.scrollDOM).fontFamily,changes};
      api.undo(view);result.undone=view.state.doc.toString();root.unmount();return result;
    `)
    expect(result.same).toBe(true)
    expect(result.anchor).toBe(3)
    expect(result.tabSize).toBe(4)
    expect(result.noGutter).toBe(true)
    expect(result.wrap).toBe('pre')
    expect(result.fontSize).toBe('22px')
    expect(result.fontFamily).toContain('Menlo')
    expect(result.changes).toBe(1)
    expect(result.undone).toBe('原正文')
  }, 30_000)

  test('When 源码使用四空格 Tab 后切为只读 Then 缩进按偏好生效且只读不修改文本', async () => {
    const result = await renderer.run<{ indented: string; readonly: string; changes: number }>(`
      const api=window.markdownPreferencesRegression;const root=api.createRoot(document.getElementById('root'));const ref=api.React.createRef();let value='正文',changes=0;
      const preferences={...api.DEFAULT_MARKDOWN_EDITOR_PREFERENCES,tabSize:4};const render=readOnly=>root.render(api.React.createElement(api.MarkdownSourceEditor,{ref,value,readOnly,preferences,onChange:source=>{value=source;changes++}}));
      render(false);await api.until(()=>ref.current?.view());const view=ref.current.view();view.focus();view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));await api.delay();
      const indented=view.state.doc.toString();render(true);await api.delay();view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      const readonly=view.state.doc.toString();root.unmount();return{indented,readonly,changes};
    `)
    expect(result).toEqual({ indented: '    正文', readonly: '    正文', changes: 1 })
  }, 30_000)
})
