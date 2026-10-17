import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'; import { createRoot } from 'react-dom/client'; import { createStore, Provider } from 'jotai';
    import { EditorView } from '@codemirror/view';
    import { MarkdownWorkspaceView } from '@/components/markdown-workspace/MarkdownWorkspaceView';
    import { MarkdownEditorSettings } from '@/components/settings/MarkdownEditorSettings';
    import { markdownEditorPreferencesAtom, updateMarkdownEditorPreferencesAtom } from '@/atoms/markdown-editor-preferences';
    import { DEFAULT_MARKDOWN_EDITOR_PREFERENCES, mergeMarkdownEditorPreferences } from '@gamma/shared';
    import '@/styles/globals.css';
    const delay=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await delay(10)}throw new Error('等待 UI 失败：'+document.body.innerHTML.slice(-4000))};
    const click=label=>{if(label==='编辑'&&document.querySelector('[aria-label="结束编辑"]'))return;const button=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent.trim()===label);if(!button)throw new Error('找不到 '+label);button.click()};
    const choose=async(label,value)=>{await until(()=>document.querySelector('[role="combobox"][aria-label="'+label+'"]'));const button=document.querySelector('[role="combobox"][aria-label="'+label+'"]');button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await until(()=>document.querySelector('[role="option"]'));const option=[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent.trim()===value);if(!option)throw new Error('找不到选项 '+value);option.click();await delay(100)};
    const menu=async(label,value)=>{document.querySelector('[aria-label="'+label+'"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await until(()=>document.querySelector('[role^="menuitem"]'));[...document.querySelectorAll('[role^="menuitem"]')].find(node=>node.textContent.trim()===value).click();await delay(100)};
    document.head.insertAdjacentHTML('beforeend','<style>html,body,#root{height:100%;margin:0}</style>');
    window.markdownPreferencesFixture=async(initial={})=>{
      let saved=mergeMarkdownEditorPreferences(DEFAULT_MARKDOWN_EDITOR_PREFERENCES,initial);const writes=[];let documentSaves=0;let fail=false;
      window.electronAPI={getSettings:async()=>({markdownEditor:saved}),updateSettings:async updates=>{if(fail)throw new Error('磁盘不可写');saved=mergeMarkdownEditorPreferences(saved,updates.markdownEditor);writes.push(saved);return {markdownEditor:saved}},openExternal:async()=>{},markdownWorkspace:async input=>{
        if(input.action==='choose')return {status:'source',source:{id:'source',name:'sample.md',kind:'file'}};
        if(input.action==='read')return {status:'document',document:{id:'doc',sourceId:'source',name:'sample.md',path:'',content:'# 标题\\n\\n原始正文\\n',revision:'r1',writable:true,sourceOnly:false}};
        if(input.action==='save'){documentSaves++;return {status:'error',code:'test',message:'test'}};return {status:'media',url:null};}};
      const store=createStore();const root=createRoot(document.getElementById('root'));const mount=kind=>root.render(React.createElement(Provider,{store},kind==='settings'?React.createElement(MarkdownEditorSettings):React.createElement(MarkdownWorkspaceView,{workspaceId:'preferences-fixture'})));
      mount('workspace');await until(()=>document.querySelector('[aria-label="打开 Markdown"]'));await delay(100);click('打开 Markdown');await until(()=>document.querySelector('.ProseMirror'));await delay(80);
      return {root,store,writes,saved:()=>saved,documentSaves:()=>documentSaves,fail(value){fail=value},click,choose,menu,delay,until,cm:()=>EditorView.findFromDOM(document.querySelector('.cm-editor')),async settings(){await menu('更多 Markdown 操作','文档设置…');await until(()=>document.querySelector('[data-testid="markdown-editor-settings"]'))},async close(){const button=[...document.querySelectorAll('[role="dialog"] button')].find(node=>node.textContent.trim()==='关闭');button.click();await delay(80)}};
    };
  `)
}, 240_000)
afterAll(async () => { await renderer?.dispose() })
describe('Given VMark 风格文档设置与真实 Chromium 编辑器', () => {
  test('When 选择主题和排版 Then 正文立即更新、设置持久化且文档不自动写盘', async () => {
    const result = await renderer.run<{ font: string; family: string; background: string; theme: string; size: number; saves: number; dialog: boolean }>(`
      const f=await window.markdownPreferencesFixture();await f.settings();f.click('薄荷主题');await f.delay(100);f.click('编辑器');await f.choose('字体大小','22px');await f.choose('CJK 字体','楷体');
      const dialog=!!document.querySelector('[role="dialog"]');await f.close();const style=getComputedStyle(document.querySelector('.ProseMirror'));const background=getComputedStyle(document.querySelector('[data-testid="markdown-workspace"]')).backgroundColor;
      const result={font:style.fontSize,family:style.fontFamily,background,theme:f.saved().theme,size:f.saved().fontSize,saves:f.documentSaves(),dialog};f.root.unmount();return result;
    `)
    expect(result.font).toBe('22px'); expect(result.family).toContain('Kaiti SC'); expect(result.background).toBe('rgb(204, 230, 208)')
    expect(result.theme).toBe('mint'); expect(result.size).toBe(22); expect(result.saves).toBe(0); expect(result.dialog).toBe(true)
  }, 30_000)
  test('When 调整源码行号、换行、制表符 Then 编辑器与撤销历史保留', async () => {
    const result = await renderer.run<{ same: boolean; gutters: boolean; tab: number; nowrap: boolean; restored: string }>(`
      const f=await window.markdownPreferencesFixture();f.click('编辑');await f.delay();await f.menu('切换 Markdown 视图','源码');const original=f.cm();original.dispatch({changes:{from:original.state.doc.length,insert:'新增草稿'}});await f.delay();
      await f.settings();f.click('编辑器');await f.delay();f.click('源码行号');f.click('源码自动换行');await f.choose('制表符大小','4 个空格');await f.close();const current=f.cm();const same=current===original;const gutters=!!document.querySelector('.cm-lineNumbers');const tab=current.state.tabSize;const nowrap=getComputedStyle(current.contentDOM).whiteSpace==='pre';
      current.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));await f.delay();const restored=current.state.doc.toString();f.root.unmount();return {same,gutters,tab,nowrap,restored};
    `)
    expect(result.same).toBe(true); expect(result.gutters).toBe(false); expect(result.tab).toBe(4); expect(result.nowrap).toBe(true); expect(result.restored).not.toContain('新增草稿')
  }, 30_000)
  test('When 自定义模式快捷键与搜索设置 Then 新键生效、冲突有提示且弹窗不触发底层文档', async () => {
    const result = await renderer.run<{ conflict: boolean; protected: boolean; oldIgnored: boolean; newWorks: boolean; empty: boolean }>(`
      const f=await window.markdownPreferencesFixture();await f.settings();f.click('快捷键');await f.choose('切换源码视图快捷键','F5');const conflict=document.querySelector('[role="alert"]').textContent.includes('已用于');await f.choose('切换源码视图快捷键','F7');
      document.querySelector('[data-testid="markdown-editor-settings"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F7',bubbles:true,cancelable:true}));await f.delay();const protected=document.querySelector('.markdown-workspace-source-pane').hidden;
      const input=document.querySelector('[aria-label="搜索文档设置"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'不存在的选项');input.dispatchEvent(new Event('input',{bubbles:true}));await f.delay();const empty=document.body.textContent.includes('没有匹配的设置');await f.close();
      const root=document.querySelector('[data-testid="markdown-workspace"]');root.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',bubbles:true,cancelable:true}));await f.delay();const oldIgnored=document.querySelector('.markdown-workspace-source-pane').hidden;
      root.dispatchEvent(new KeyboardEvent('keydown',{key:'F7',bubbles:true,cancelable:true}));await f.delay();const newWorks=!document.querySelector('.markdown-workspace-source-pane').hidden;f.root.unmount();return {conflict,protected,oldIgnored,newWorks,empty};
    `)
    expect(result).toEqual({ conflict: true, protected: true, oldIgnored: true, newWorks: true, empty: true })
  }, 30_000)
  test('When 设置保存失败 Then 提示错误并可重试且保留文档草稿', async () => {
    const result = await renderer.run<{ error: boolean; retried: boolean; draft: boolean }>(`
      const f=await window.markdownPreferencesFixture();f.click('编辑');await f.delay();await f.menu('切换 Markdown 视图','源码');const cm=f.cm();cm.dispatch({changes:{from:cm.state.doc.length,insert:'保留我的草稿'}});await f.delay();await f.settings();f.fail(true);f.click('纸张主题');await f.delay(150);const error=document.body.textContent.includes('设置保存失败');f.fail(false);f.click('夜间主题');await f.delay(150);const retried=f.saved().theme==='night';await f.close();const draft=f.cm().state.doc.toString().includes('保留我的草稿');f.root.unmount();return {error,retried,draft};
    `)
    expect(result).toEqual({ error: true, retried: true, draft: true })
  }, 30_000)
  test('When 搜索描述文字 Then 显示匹配设置且不同时显示空状态', async () => {
    const result = await renderer.run<{ table: boolean; empty: boolean }>(`
      const f=await window.markdownPreferencesFixture();await f.settings();const input=document.querySelector('[aria-label="搜索文档设置"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'约束');input.dispatchEvent(new Event('input',{bubbles:true}));await f.delay();
      const result={table:!!document.querySelector('[aria-label="表格适应宽度"]'),empty:document.body.textContent.includes('没有匹配的设置')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ table: true, empty: false })
  }, 30_000)
})
