import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { EditorView } from '@codemirror/view'
    import { MarkdownWorkspaceEditor } from '@/components/markdown-workspace/MarkdownWorkspaceEditor'
    import { MarkdownWorkspaceView } from '@/components/markdown-workspace/MarkdownWorkspaceView'
    import { openMarkdownSourcePeek, commitMarkdownSourcePeek } from '@/components/markdown-workspace/vmark/sourcePeekInline/sourcePeekActions'
    import { clearInlineMathRenderCache, inlineMathRenderCacheSize } from '@/components/markdown-workspace/vmark/latex/inlineMathRenderCache'
    import '@/styles/globals.css'
    const delay = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (predicate) => { for (let i=0;i<300;i++) { if(predicate()) return; await delay(10) } throw new Error('UI 没有完成挂载：'+document.getElementById('root').innerHTML.slice(0,3000)) }
    document.head.insertAdjacentHTML('beforeend','<style>html,body,#root{height:100%;margin:0}</style>')
    let count = 0
    window.markdownRegression = {
      delay, until, openMarkdownSourcePeek, commitMarkdownSourcePeek, clearInlineMathRenderCache, inlineMathRenderCacheSize,
      cmView: node => EditorView.findFromDOM(node),
      click(text) { const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text); if(!button) throw new Error('找不到按钮 '+text); button.click() },
      async menu(triggerLabel, text) {
        const trigger=document.querySelector('[aria-label="'+triggerLabel+'"]'); if(!trigger) throw new Error('找不到菜单 '+triggerLabel);
        trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
        await until(()=>document.querySelector('[role^="menuitem"]'));
        const item=[...document.querySelectorAll('[role^="menuitem"]')].find(node=>node.textContent.trim()===text); if(!item) throw new Error('找不到菜单项 '+text);
        item.click(); await delay(80);
      },
      async mode(text) { await this.menu('切换 Markdown 视图',text) },
      async editor(source, editing = false, theme = 'github-dark', query = '') {
        const root = createRoot(document.getElementById('root')); const ref = React.createRef(); const changes = []; const errors = []; let saves=0
        const render = (edit) => root.render(React.createElement(MarkdownWorkspaceEditor, { ref, documentId:'A', value:source, editing:edit, theme, query, onChange:value=>{source=value;changes.push(value)}, onSave:()=>saves++, resolveMedia:async()=>null, onError:value=>errors.push(value) }))
        render(editing); await until(()=>ref.current?.editor()?.view?.dom)
        return { root, ref, changes, errors, saves:()=>saves, async editing(value) { editing=value; render(value); await delay(80) }, async theme(value) { theme=value; render(editing); await delay(80) }, async source(value) { source=value; render(editing); await delay(80) } }
      },
      async workspace(initialContent, saveDelay = 0, defaultMode = 'read') {
        const calls=[]; const root=createRoot(document.getElementById('root')); let content='# 原标题\\n\\n第一段\\n\\n第二段\\n'; if(initialContent !== undefined) content=initialContent; let revision='r1'
        window.electronAPI={ getSettings:async()=>({markdownEditor:{defaultMode}}), updateSettings:async updates=>updates, openExternal:async()=>{}, markdownWorkspace: async input => { calls.push(input);
          if(input.action==='choose') return {status:'source',source:{id:'file',name:'sample.md',kind:'file'}}
          if(input.action==='read') return {status:'document',document:{id:'doc',sourceId:'file',name:'sample.md',path:'',content,revision,writable:true,sourceOnly:false}}
          if(input.action==='save') { if(saveDelay) await delay(saveDelay); content=input.content; revision='r2'; return {status:'saved',document:{id:'doc',sourceId:'file',name:'sample.md',path:'',content,revision,writable:true,sourceOnly:false}} }
          return {status:'media',url:null}
        }}
        const props={workspaceId:'browser-'+(++count)}
        const render=()=>root.render(React.createElement(MarkdownWorkspaceView,props))
        render(); await until(()=>document.querySelector('[data-testid="markdown-workspace"]')); this.click('打开 Markdown'); await until(()=>document.querySelector('.ProseMirror'))
        return {root,calls, async hide(){root.render(React.createElement('div')); await delay()}, async show(){render(); await until(()=>document.querySelector('[data-testid="markdown-workspace"]')); await delay()} }
      }
    }
  `)
}, 240_000)
afterAll(async () => { await renderer?.dispose() })
describe('Given 真实 Chromium Markdown 编辑工作区', () => {
  test('When 旧配置未指定默认视图 Then 可写文档默认解锁并允许编辑', async () => {
    const result = await renderer.run<{ editable: boolean; unlocked: boolean; saves: number }>(`
      const api=window.markdownRegression;const fixture=await api.workspace('默认正文',0,null);
      const editable=document.querySelector('.ProseMirror').getAttribute('contenteditable')==='true';
      const unlocked=document.querySelector('[aria-label="结束编辑"]').getAttribute('aria-pressed')==='true';
      const saves=fixture.calls.filter(call=>call.action==='save').length;fixture.root.unmount();return{editable,unlocked,saves};
    `)
    expect(result).toEqual({ editable: true, unlocked: true, saves: 0 })
  }, 30_000)
  test('When 编辑嵌套列表且切换视图 Then 正文不空白且模式切换不写入草稿', async () => {
    const result = await renderer.run<{ text: string; strong: boolean; blank: boolean; saves: number }>(`
      const api=window.markdownRegression; const fixture=await api.workspace('* **计划**\\n\\n  * 早晨\\n');
      await api.mode('富文本'); await api.delay(80); await api.mode('源码'); await api.mode('富文本');
      const text=document.querySelector('.ProseMirror').textContent, strong=!!document.querySelector('.ProseMirror strong');
      const blank=!!document.querySelector('[role="alert"]'), saves=fixture.calls.filter(call=>call.action==='save').length;
      fixture.root.unmount(); return {text,strong,blank,saves};
    `)
    expect(result).toEqual({ text: '计划早晨', strong: true, blank: false, saves: 0 })
  }, 30_000)
  test('When 编辑态展示行内与块公式 Then 分数线、MathML、编号和无损源码均保留', async () => {
    const result = await renderer.run<{ formulas: number; mathml: number; errors: boolean; line: boolean; width: boolean; writes: number }>(`
      const api=window.markdownRegression; const source=String.raw\`行内 $\\frac{1}{2}$ 和 $\\centernot\\implies$\`+'\\n\\n$$\\n'+String.raw\`\\frac{1}{2}\\tag{1}\`+'\\n$$';
      const fixture=await api.editor(source,true); await api.until(()=>document.querySelectorAll('.katex').length===3);
      const formulas=document.querySelectorAll('.katex').length, mathml=document.querySelectorAll('.katex math').length, errors=!!document.querySelector('.katex-error');
      const frac=document.querySelector('.frac-line'); const line=parseFloat(getComputedStyle(frac).borderBottomWidth)>0;
      const block=document.querySelector('.notes-v2__math-block-preview'), display=block.querySelector('.katex-display'); const width=Math.abs(display.getBoundingClientRect().width-block.getBoundingClientRect().width)<2;
      const writes=fixture.changes.length; fixture.root.unmount(); return{formulas,mathml,errors,line,width,writes};
    `)
    expect(result).toEqual({ formulas: 3, mathml: 3, errors: false, line: true, width: true, writes: 0 })
  }, 30_000)
  test('When 粗体文字中包含公式并编辑正文 Then 公式格式保留且富文本不降级', async () => {
    const result = await renderer.run<{ marked: boolean; preserved: boolean; errors: number }>(`
      const api=window.markdownRegression;const source=String.raw\`**低频（$\\omega < \\frac{1}{T}$）**：增益为 $0\\text{ dB}$。\`;
      const fixture=await api.editor(source,true);await api.until(()=>document.querySelectorAll('.katex').length===2);
      const marked=!!document.querySelector('strong .notes-v2__math-inline');const editor=fixture.ref.current.editor();editor.commands.setTextSelection(editor.state.doc.content.size-1);editor.commands.insertContent('补充');
      const preserved=fixture.changes.at(-1).includes('**低频（$')&&fixture.changes.at(-1).includes('$）**');const errors=fixture.errors.length;
      fixture.root.unmount();return{marked,preserved,errors};
    `)
    expect(result).toEqual({ marked: true, preserved: true, errors: 0 })
  }, 30_000)
  test('When 点击或键盘编辑公式、取消、提交并撤销 Then 保留相邻正文与原生撤销', async () => {
    const result = await renderer.run<{ cancelled: boolean; inline: boolean; block: boolean; undone: boolean; readonly: boolean; writes: number }>(`
      const api=window.markdownRegression;const fixture=await api.editor('前文 $x$ 后文\\n\\n$$\\ny^2\\n$$',true);const editor=fixture.ref.current.editor();
      await api.until(()=>document.querySelectorAll('.katex').length===2);
      const open=async(kind)=>{document.querySelector('.notes-v2__math-'+kind).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await api.until(()=>document.querySelector('[aria-label="LaTeX 源码"]'));await api.delay(30);return document.querySelector('[aria-label="LaTeX 源码"]')};
      let input=await open('inline');input.value='cancel';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const cancelled=fixture.changes.length===0;
      input=await open('inline');input.value='z';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));const ime=fixture.changes.length===0;
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));const inline=ime&&fixture.changes.at(-1).includes('前文 $z$ 后文');
      input=await open('block');input.value='z^3';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true,cancelable:true}));const block=fixture.changes.at(-1).includes('z^3');
      const undone=editor.commands.undo()&&!fixture.changes.at(-1).includes('z^3');await fixture.editing(false);
      input=await open('inline');const readonly=input.readOnly;const writes=fixture.changes.length;input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));fixture.root.unmount();return{cancelled,inline,block,undone,readonly,writes};
    `)
    expect(result).toEqual({ cancelled: true, inline: true, block: true, undone: true, readonly: true, writes: 3 })
  }, 30_000)
  test('When 重复公式、宏定义与不可信命令 Then 缓存 DOM 独立且不跨公式污染或执行 HTML', async () => {
    const result = await renderer.run<{ cache: number; independent: boolean; isolated: boolean; unsafe: boolean; errors: number }>(`
      const api=window.markdownRegression;api.clearInlineMathRenderCache();
      const source=String.raw\`$x$ $x$ $\\gdef\\leaked{z}\\leaked$ $\\leaked$ $\\href{javascript:alert(1)}{x}$\`;
      const fixture=await api.editor(source,true);await api.until(()=>document.querySelectorAll('.notes-v2__math-inline-preview .katex, .notes-v2__math-inline-preview .katex-error').length===5);
      const cache=api.inlineMathRenderCacheSize();const previews=document.querySelectorAll('.notes-v2__math-inline-preview');previews[0].replaceChildren();
      const independent=!!previews[1].querySelector('.katex');const isolated=previews[3].querySelector('.katex-html').textContent.includes('leaked')&&!previews[3].querySelector('.katex-html').textContent.includes('z');
      const unsafe=!!document.querySelector('.ProseMirror a[href^="javascript:"],.ProseMirror script');const errors=fixture.errors.length;
      fixture.root.unmount();return{cache,independent,isolated,unsafe,errors};
    `)
    expect(result).toEqual({ cache: 4, independent: true, isolated: true, unsafe: false, errors: 0 })
  }, 30_000)
  test('When 转换被拒绝后修正源码 Then 始终展示原文且可以恢复富文本', async () => {
    const result = await renderer.run<{ fallback: boolean; original: boolean; recovered: boolean; writes: number }>(`
      const api=window.markdownRegression;const source='x'.repeat(1024*1024+1);const fixture=await api.editor(source,true);
      const fallback=!!document.querySelector('.cm-editor')&&!document.querySelector('.ProseMirror');const original=api.cmView(document.querySelector('.cm-editor')).state.doc.toString()===source;
      await fixture.source('# 恢复正文');await api.until(()=>document.querySelector('.ProseMirror h1'));const recovered=document.querySelector('.ProseMirror').textContent==='恢复正文';
      const writes=fixture.changes.length;fixture.root.unmount();return{fallback,original,recovered,writes};
    `)
    expect(result).toEqual({ fallback: true, original: true, recovered: true, writes: 0 })
  }, 30_000)
  test('When 完全撤销富文本修改 Then 恢复原始 Markdown 空白与换行格式', async () => {
    const result = await renderer.run<{ restored: boolean; changed: boolean; redone: boolean }>(`
      const api=window.markdownRegression;const original='# 标题'+String.fromCharCode(13,10,13,10)+'原始正文  '+String.fromCharCode(13,10);
      const fixture=await api.editor(original,true);const editor=fixture.ref.current.editor();editor.commands.setTextSelection(editor.state.doc.content.size-1);editor.commands.insertContent('临时改动');
      const changed=fixture.changes.at(-1).includes('临时改动');editor.commands.undo();const restored=fixture.changes.at(-1)===original;
      editor.commands.redo();const redone=fixture.changes.at(-1).includes('临时改动');fixture.root.unmount();return{restored,changed,redone};
    `)
    expect(result).toEqual({ restored: true, changed: true, redone: true })
  }, 30_000)

  test('When 开启查找后继续在正文末尾输入 Then 保留光标且不覆盖首个匹配', async () => {
    const result = await renderer.run<{ before: number; after: number; text: string }>(`
      const api=window.markdownRegression;const fixture=await api.editor('foo bar foo',true,'github-dark','foo');await api.delay();const editor=fixture.ref.current.editor();
      editor.commands.setTextSelection(editor.state.doc.content.size-1);editor.commands.insertContent('!');const before=editor.state.selection.from;await fixture.editing(true);const after=editor.state.selection.from;editor.commands.insertContent('?');const text=editor.state.doc.textContent;fixture.root.unmount();return {before,after,text};
    `)
    expect(result.after).toBe(result.before); expect(result.text).toBe('foo bar foo!?')
  }, 30_000)
  test('When 中文输入法处理查找框的取消键 Then 不关闭查找且组合结束后可正常退出', async () => {
    const result = await renderer.run<{ composing: boolean; grace: boolean; closed: boolean }>(`
      const api=window.markdownRegression;const fixture=await api.workspace();api.click('查找文本');await api.delay();const input=document.querySelector('input[aria-label="查找文本"]');
      input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const composing=!!document.querySelector('input[aria-label="查找文本"]');
      input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const grace=!!document.querySelector('input[aria-label="查找文本"]');await api.delay(80);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await api.delay();const closed=!document.querySelector('input[aria-label="查找文本"]');fixture.root.unmount();return {composing,grace,closed};
    `)
    expect(result).toEqual({ composing: true, grace: true, closed: true })
  }, 30_000)
  test('When 只读打开并切换源码/阅读 Then 不重写或写盘', async () => {
    const result = await renderer.run<{ saves: number; readonly: boolean; source: string }>(`
      const fixture=await window.markdownRegression.workspace(); const api=window.markdownRegression;
      const readonly=document.querySelector('.ProseMirror').getAttribute('contenteditable')==='false'; await api.mode('源码'); await api.until(()=>document.querySelector('.cm-editor'));
      const source=api.cmView(document.querySelector('.cm-editor')).state.doc.toString(); await api.mode('阅读'); await api.delay(80);
      const saves=fixture.calls.filter(call=>call.action==='save').length; fixture.root.unmount(); return {saves,readonly,source};
    `)
    expect(result.saves).toBe(0); expect(result.readonly).toBe(true); expect(result.source).toContain('# 原标题')
  }, 30_000)
  test('When 源码编辑、面板关闭再打开、手动保存 Then 草稿保留且携带原 revision', async () => {
    const result = await renderer.run<{ draft: string; content: string; revision: string }>(`
      const api=window.markdownRegression; const fixture=await api.workspace(); api.click('编辑'); await api.delay(80); await api.mode('源码'); await api.until(()=>document.querySelector('.cm-editor'));
      const view=api.cmView(document.querySelector('.cm-editor')); view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'# 草稿内容'}}); await api.delay(); await fixture.hide(); await fixture.show();
      await api.until(()=>document.querySelector('.cm-editor')); const draft=api.cmView(document.querySelector('.cm-editor')).state.doc.toString(); api.click('保存'); await api.delay(80);
      const call=fixture.calls.find(call=>call.action==='save'); fixture.root.unmount(); return {draft,content:call.content,revision:call.expectedRevision};
    `)
    expect(result).toEqual({ draft: '# 草稿内容', content: '# 草稿内容', revision: 'r1' })
  }, 30_000)
  test('When 段落 Source Peek 取消、跨文档拒绝或应用 Then 仅替换目标范围', async () => {
    const result = await renderer.run<{ cancelled: boolean; denied: boolean; changed: boolean; text: string }>(`
      const api=window.markdownRegression; const fixture=await api.editor('# 标题\\n\\n第一段\\n\\n第二段',true); const editor=fixture.ref.current.editor();
      editor.commands.setTextSelection(6); const peek=api.openMarkdownSourcePeek(editor.view,'A'); const before=editor.state.doc;
      api.click('段落源码'); await api.until(()=>document.querySelector('[role="region"][aria-label="段落源码"]')); api.click('取消'); await api.delay();
      const cancelled=editor.state.doc.eq(before); const denied=!api.commitMarkdownSourcePeek(editor.view,'B',peek,'改动');
      const changed=api.commitMarkdownSourcePeek(editor.view,'A',peek,'第一段改动'); const text=editor.state.doc.textContent; fixture.root.unmount(); return {cancelled,denied,changed,text};
    `)
    expect(result.cancelled).toBe(true); expect(result.denied).toBe(true); expect(result.changed).toBe(true); expect(result.text).toContain('第一段改动'); expect(result.text).toContain('第二段')
  }, 30_000)
  test('When 阅读数学、Mermaid 和未授权本地图片 Then 安全渲染并保留图片占位', async () => {
    const result = await renderer.run<{ math: boolean; mermaid: boolean; imageBlocked: boolean; imagePlaceholder: boolean; errors: string[] }>(`
      const api=window.markdownRegression; const fixture=await api.editor('公式 $x^2$\\n\\n__FENCE__mermaid\\ngraph TD\\nA-->B\\n__FENCE__\\n\\n![隐私图片](./private.png)');
      await api.until(()=>document.querySelector('.katex') && document.querySelector('.markdown-code-block svg'));
      const math=!!document.querySelector('.katex'), mermaid=!!document.querySelector('.markdown-code-block svg'), imageBlocked=!document.querySelector('img[src^="file:"]') && !document.querySelector('img[src*="private.png"]'), imagePlaceholder=document.querySelector('.ProseMirror').textContent.includes('隐私图片');
      const errors=fixture.errors; fixture.root.unmount(); return {math,mermaid,imageBlocked,imagePlaceholder,errors};
    `.replaceAll('__FENCE__', String.fromCharCode(96).repeat(3)))
    expect(result).toEqual({ math: true, mermaid: true, imageBlocked: true, imagePlaceholder: true, errors: [] })
  }, 30_000)
  test('When 窄面板和深浅主题切换 Then 格式收拢且高亮随主题更新', async () => {
    const result = await renderer.run<{ collapsed: boolean; expanded: boolean; themeChanged: boolean; writable: boolean; oneRow: boolean; bottom: boolean }>(`
      const api=window.markdownRegression; document.getElementById('root').style.width='320px';
      const fixture=await api.editor('正文',true); await api.delay(80); const toolbar=document.querySelector('.markdown-format-toolbar');
      const collapsed=getComputedStyle(toolbar.querySelector('[data-format-index="3"]')).display==='none' && getComputedStyle(toolbar.querySelector('.markdown-format-overflow')).display!=='none';
      const positions=[...toolbar.querySelectorAll('button')].filter(node=>getComputedStyle(node).display!=='none').map(node=>node.getBoundingClientRect().top);
      const oneRow=positions.every(top=>Math.abs(top-positions[0])<1) && toolbar.scrollWidth<=toolbar.clientWidth+1;
      const bottom=toolbar.getBoundingClientRect().top>=document.querySelector('.markdown-workspace-scroll').getBoundingClientRect().bottom-1;
      const writable=document.querySelector('.ProseMirror').getAttribute('contenteditable')==='true'; document.getElementById('root').style.width='800px'; await api.delay(80);
      const expanded=getComputedStyle(toolbar.querySelector('[data-format-index="3"]')).display!=='none' && getComputedStyle(toolbar.querySelector('.markdown-format-overflow')).display==='none'; fixture.root.unmount();
      const code=await api.editor('__FENCE__js\\nconst value = 1\\n__FENCE__',false,'github-light'); await api.until(()=>document.querySelector('.shiki'));
      const before=getComputedStyle(document.querySelector('.shiki')).backgroundColor; document.documentElement.classList.add('dark'); await code.theme('github-dark');
      await api.until(()=>document.querySelector('.shiki') && getComputedStyle(document.querySelector('.shiki')).backgroundColor!==before); const themeChanged=true;
      code.root.unmount(); document.documentElement.classList.remove('dark'); return {collapsed,expanded,themeChanged,writable,oneRow,bottom};
    `.replaceAll('__FENCE__', String.fromCharCode(96).repeat(3)))
    expect(result).toEqual({ collapsed: true, expanded: true, themeChanged: true, writable: true, oneRow: true, bottom: true })
  }, 30_000)
  test('When 标题源行号过期 Then 仍按当前目录顺序定位', async () => {
    const result = await renderer.run<{ heading: string; writes: number }>(`
      const api=window.markdownRegression; const fixture=await api.editor('# 第一节\\n\\n正文\\n\\n## 第二节',true);
      fixture.ref.current.scrollToLine(999,1); const heading=fixture.ref.current.editor().state.selection.$from.parent.textContent;
      const writes=fixture.changes.length; fixture.root.unmount(); return {heading,writes};
    `)
    expect(result).toEqual({ heading: '第二节', writes: 0 })
  }, 30_000)
  test('When 对选区切换粗体 Then 格式按钮同步可访问的激活状态', async () => {
    const result = await renderer.run<{ active: boolean; marked: boolean; inactive: boolean; cleared: boolean }>(`
      const api=window.markdownRegression; const fixture=await api.editor('选中的正文',true); const editor=fixture.ref.current.editor();
      editor.commands.setTextSelection({from:1,to:4}); api.click('粗体'); await api.delay(80);
      const button=document.querySelector('[aria-label="粗体"]'); const active=button.getAttribute('aria-pressed')==='true'; const marked=!!document.querySelector('.ProseMirror strong');
      api.click('粗体'); await api.delay(80); const inactive=button.getAttribute('aria-pressed')==='false'; const cleared=!document.querySelector('.ProseMirror strong');
      fixture.root.unmount(); return {active,marked,inactive,cleared};
    `)
    expect(result).toEqual({ active: true, marked: true, inactive: true, cleared: true })
  }, 30_000)
  test('When 窄分屏中确认/撤销中文排版 Then 仅改变草稿且不自动保存', async () => {
    const result = await renderer.run<{ vertical: boolean; changed: boolean; undo: string; saves: number }>(`
      const api=window.markdownRegression; const original='# 中文English排版\\n'; const fixture=await api.workspace(original);
      document.getElementById('root').style.width='320px'; api.click('编辑'); await api.delay(80); await api.mode('分屏'); await api.until(()=>document.querySelector('.markdown-workspace-split')); await api.delay(80);
      const panes=[...document.querySelector('.markdown-workspace-split').children].map(node=>node.getBoundingClientRect()); const vertical=panes[1].top>panes[0].top+10;
      const menu=async text=>api.menu('更多 Markdown 操作',text);
      await menu('中文排版…'); await api.until(()=>document.querySelector('[role="dialog"]')); api.click('取消'); await api.delay(80);
      await menu('中文排版…'); await api.until(()=>document.querySelector('[role="dialog"]')); api.click('应用到草稿'); await api.until(()=>document.querySelector('.cm-editor') && !document.querySelector('[role="dialog"]'));
      const changed=api.cmView(document.querySelector('.cm-editor')).state.doc.toString()!==original; await menu('撤销中文排版');
      const undo=api.cmView(document.querySelector('.cm-editor')).state.doc.toString(); const saves=fixture.calls.filter(call=>call.action==='save').length; fixture.root.unmount(); return {vertical,changed,undo,saves};
    `)
    expect(result).toEqual({ vertical: true, changed: true, undo: '# 中文English排版\n', saves: 0 })
  }, 30_000)
  test('When IME 确认键及恶意 HTML Then 不误保存且不执行脚本', async () => {
    const result = await renderer.run<{ saves: number; scripts: number; executed: boolean }>(`
      const api=window.markdownRegression; const fixture=await api.editor('<script>window.badMarkdownExecuted=true</script>\\n\\n正文',true); const editor=fixture.ref.current.editor();
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true}));
      const saves=fixture.saves(), scripts=document.querySelectorAll('.markdown-workspace-prose script').length, executed=window.badMarkdownExecuted===true; fixture.root.unmount(); return {saves,scripts,executed};
    `)
    expect(result).toEqual({ saves: 0, scripts: 0, executed: false })
  }, 30_000)
  test('When 切换只读和编辑 Then 保留富文本实例、光标和可撤销事务', async () => {
    const result = await renderer.run<{ sameInstance: boolean; readonly: boolean; cursor: boolean; undone: boolean; text: string }>(`
      const api=window.markdownRegression; const fixture=await api.editor('# 标题\\n\\n原始正文',true); const original=fixture.ref.current.editor();
      original.commands.setTextSelection(7); original.commands.insertContent('新内容'); await api.delay();
      original.commands.setTextSelection(8); const before=original.state.selection.from;
      await fixture.editing(false); const readonly=original.view.dom.getAttribute('contenteditable')==='false';
      await fixture.editing(true); const current=fixture.ref.current.editor();
      const sameInstance=current===original; const cursor=current.state.selection.from===before;
      const undone=current.commands.undo(); const text=current.state.doc.textContent; fixture.root.unmount(); return {sameInstance,readonly,cursor,undone,text};
    `)
    expect(result).toEqual({ sameInstance: true, readonly: true, cursor: true, undone: true, text: '标题原始正文' })
  }, 30_000)
  test('When 代码和任务列表从阅读切换编辑再切回 Then 节点视图同步编辑权限', async () => {
    const result = await renderer.run<{ codeEditable: boolean; taskEditable: boolean; codePreview: boolean; taskReadonly: boolean; writes: number }>(`
      const api=window.markdownRegression; const fixture=await api.editor('__FENCE__js\\nconst value = 1\\n__FENCE__\\n\\n- [ ] 任务');
      await api.until(()=>document.querySelector('.shiki') && document.querySelector('.markdown-task-item input'));
      await fixture.editing(true);
      const code=document.querySelector('.markdown-code-block'); const codeEditable=code.getAttribute('contenteditable')!=='false' && !code.querySelector('.shiki') && !!code.querySelector('code');
      const taskEditable=!document.querySelector('.markdown-task-item input').disabled;
      await fixture.editing(false); await api.until(()=>document.querySelector('.shiki'));
      const codePreview=document.querySelector('.markdown-code-block').getAttribute('contenteditable')==='false'; const taskReadonly=document.querySelector('.markdown-task-item input').disabled;
      const writes=fixture.changes.length; fixture.root.unmount(); return {codeEditable,taskEditable,codePreview,taskReadonly,writes};
    `.replaceAll('__FENCE__', String.fromCharCode(96).repeat(3)))
    expect(result).toEqual({ codeEditable: true, taskEditable: true, codePreview: true, taskReadonly: true, writes: 0 })
  }, 30_000)
  test('When 源码和富文本分别按 Mod+S Then 每次只提交一次保存', async () => {
    const result = await renderer.run<{ sourceSaves: number; richSaves: number; sourceRevision: string; richRevision: string }>(`
      const api=window.markdownRegression; const fixture=await api.workspace(undefined,40); api.click('编辑'); await api.delay(80); await api.mode('源码');
      await api.until(()=>document.querySelector('.cm-editor')); const view=api.cmView(document.querySelector('.cm-editor'));
      view.dispatch({changes:{from:view.state.doc.length,insert:'源码草稿'}}); await api.delay();
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'s',code:'KeyS',metaKey:true,bubbles:true,cancelable:true})); await api.delay(120);
      const sourceCalls=fixture.calls.filter(call=>call.action==='save'); const sourceSaves=sourceCalls.length;
      view.dispatch({changes:{from:view.state.doc.length,insert:'富文本草稿'}}); await api.delay(); await api.mode('富文本'); await api.until(()=>document.querySelector('.ProseMirror'));
      document.querySelector('.ProseMirror').dispatchEvent(new KeyboardEvent('keydown',{key:'s',code:'KeyS',metaKey:true,bubbles:true,cancelable:true})); await api.delay(120);
      const allCalls=fixture.calls.filter(call=>call.action==='save'); const richSaves=allCalls.length-sourceSaves;
      fixture.root.unmount(); return {sourceSaves,richSaves,sourceRevision:sourceCalls[0]?.expectedRevision,richRevision:allCalls[sourceSaves]?.expectedRevision};
    `)
    expect(result).toEqual({ sourceSaves: 1, richSaves: 1, sourceRevision: 'r1', richRevision: 'r2' })
  }, 30_000)
  test('When F5 查看段落、Escape 取消或 Mod+Enter 应用 Then 在正文旁操作且不误保存', async () => {
    const result = await renderer.run<{ inline: boolean; cancelled: boolean; applied: boolean; saves: number }>(`
      const api=window.markdownRegression; const fixture=await api.editor('# 标题\\n\\n第一段\\n\\n第二段',true); const editor=fixture.ref.current.editor();
      editor.commands.setTextSelection(6); const original=editor.state.doc;
      const open=async()=>{editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'F5',bubbles:true,cancelable:true})); await api.until(()=>document.querySelector('[role="region"][aria-label="段落源码"]'))};
      await open(); const inline=!document.querySelector('[role="dialog"]');
      document.querySelector('[aria-label="段落源码"] .cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await api.delay(80);
      const cancelled=!document.querySelector('[role="region"][aria-label="段落源码"]') && editor.state.doc.eq(original);
      await open(); const view=api.cmView(document.querySelector('[aria-label="段落源码"] .cm-editor'));
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'第一段改动'}}); await api.delay();
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true,cancelable:true})); await api.delay(80);
      const applied=!document.querySelector('[role="region"][aria-label="段落源码"]') && editor.state.doc.textContent.includes('第一段改动') && editor.state.doc.textContent.includes('第二段');
      const saves=fixture.saves(); fixture.root.unmount(); return {inline,cancelled,applied,saves};
    `)
    expect(result).toEqual({ inline: true, cancelled: true, applied: true, saves: 0 })
  }, 30_000)
  test('When 使用 F6/F10 或输入法组合键 Then 可切换视图和编辑权限且保护输入法', async () => {
    const result = await renderer.run<{ imePreserved: boolean; sourceOpened: boolean; readerRestored: boolean; editable: boolean; imeLockPreserved: boolean; saves: number }>(`
      const api=window.markdownRegression; const fixture=await api.workspace(); const rich=document.querySelector('.ProseMirror');
      rich.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',isComposing:true,bubbles:true,cancelable:true})); await api.delay(80);
      const imePreserved=!document.querySelector('.markdown-workspace-rich-pane').hidden && document.querySelector('.markdown-workspace-source-pane').hidden;
      rich.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',bubbles:true,cancelable:true})); await api.until(()=>!document.querySelector('.markdown-workspace-source-pane').hidden); const sourceOpened=true;
      document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'F6',bubbles:true,cancelable:true})); await api.until(()=>!document.querySelector('.markdown-workspace-rich-pane').hidden);
      const readerRestored=document.querySelector('.ProseMirror').getAttribute('contenteditable')==='false';
      rich.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',bubbles:true,cancelable:true})); await api.delay(80); const editable=rich.getAttribute('contenteditable')==='true';
      rich.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',isComposing:true,bubbles:true,cancelable:true})); await api.delay(80); const imeLockPreserved=rich.getAttribute('contenteditable')==='true';
      const saves=fixture.calls.filter(call=>call.action==='save').length; fixture.root.unmount(); return {imePreserved,sourceOpened,readerRestored,editable,imeLockPreserved,saves};
    `)
    expect(result).toEqual({ imePreserved: true, sourceOpened: true, readerRestored: true, editable: true, imeLockPreserved: true, saves: 0 })
  }, 30_000)
  test('When 大屏阅读或窄栏编辑 Then 正文居中、操作在底部且不挤压正文', async () => {
    const result = await renderer.run<{ centered: boolean; fontSize: number; quiet: boolean; bottom: boolean; narrowFits: boolean; sidebarOutline: boolean; noDuplicateOutline: boolean }>(`
      const api=window.markdownRegression; document.getElementById('root').style.width='1280px'; const fixture=await api.workspace('# 一篇正文\\n\\n阅读和写作应当以正文为中心。'); await api.delay(80);
      const canvas=document.querySelector('.markdown-workspace-view').getBoundingClientRect(); const prose=document.querySelector('.ProseMirror').getBoundingClientRect();
      const centered=prose.width<canvas.width-100 && Math.abs((prose.left-canvas.left)-(canvas.right-prose.right))<3;
      const fontSize=parseFloat(getComputedStyle(document.querySelector('.ProseMirror')).fontSize);
      const quiet=!document.querySelector('.markdown-workspace-view > header') && !document.querySelector('.markdown-workspace-view > nav') && !document.querySelector('.markdown-format-toolbar');
      const footer=document.querySelector('.markdown-workspace-view > footer'); const bottom=footer.getBoundingClientRect().top>=document.querySelector('[data-testid="markdown-rich-editor"]').getBoundingClientRect().bottom-1;
      const noDuplicateOutline=!footer.querySelector('[aria-label="文档目录"]');
      if(!document.querySelector('.markdown-sidebar')) { api.click('文件来源'); await api.delay(80) }
      api.click('文档大纲'); await api.delay(80);
      const sidebarOutline=document.querySelector('.markdown-sidebar [aria-label="文档大纲"]').getAttribute('aria-pressed')==='true' && [...document.querySelectorAll('.markdown-sidebar button')].some(button=>button.textContent.trim()==='一篇正文');
      api.click('收起侧边栏'); await api.delay(80);
      document.getElementById('root').style.width='320px'; api.click('编辑'); await api.delay(80);
      const narrowFits=footer.scrollWidth<=footer.clientWidth+1 && !document.querySelector('.markdown-format-toolbar');
      if(!narrowFits) throw new Error('窄栏尺寸：'+JSON.stringify({width:footer.clientWidth,scrollWidth:footer.scrollWidth,children:[...footer.children].map(node=>({tag:node.tagName,label:node.getAttribute('aria-label'),width:node.getBoundingClientRect().width,display:getComputedStyle(node).display,position:getComputedStyle(node).position}))}));
      fixture.root.unmount(); return {centered,fontSize,quiet,bottom,narrowFits,sidebarOutline,noDuplicateOutline};
    `)
    expect(result).toEqual({ centered: true, fontSize: 18, quiet: true, bottom: true, narrowFits: true, sidebarOutline: true, noDuplicateOutline: true })
  }, 30_000)
})
