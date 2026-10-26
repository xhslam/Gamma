import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {getDefaultStore} from 'jotai';
    import {richTextRenderingEnabledAtom} from '@/atoms/ui-preferences';
    import {undo} from '@codemirror/commands';
    import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from '@gamma/shared';
    import {MessageResponse,UserMessageContent} from '@/components/ai-elements/message';
    import {RichTextInput} from '@/components/ai-elements/rich-text-input';
    import {LiveMarkdownEditor} from '@/components/markdown/LiveMarkdownEditor';
    import {MarkdownRichEditor} from '@/components/diff/MarkdownRichEditor';
    import {MarkdownWorkspaceEditor} from '@/components/markdown-workspace/MarkdownWorkspaceEditor';
    import {markdownEditorStyle} from '@/components/markdown-workspace/markdown-editor-presentation';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import '@/styles/globals.css';
    window.addEventListener('error',event=>{window.inlineError=event.error?.stack??event.message;});
    const root=createRoot(document.getElementById('root')),liveRef=React.createRef();
    const tick=String.fromCharCode(96),inline='正文 '+tick+'const value = 1'+tick+' 后文';
    const source=inline+'\\n\\n'+tick.repeat(3)+'typescript\\nconst block = 2\\n'+tick.repeat(3);
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const selectors=['#assistant p code','#user p code','#composer p code','#rich p code','#workspace p code','#live .cm-code:not(.cm-code-open,.cm-code-close)','#nested code'];
    window.electronAPI={getSettings:async()=>({}),resolveFilePath:async path=>path.startsWith('/available/')?{resolvedPath:path}:null};
    window.inlineFixture={source,undo,liveRef,wait,
      async mount(theme='',local='inherit',size=15.5){
        document.documentElement.className=theme;
        getDefaultStore().set(richTextRenderingEnabledAtom,true);
        const preferences={...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,theme:local,fontSize:size};
        root.render(React.createElement(TooltipProvider,null,React.createElement('main',{id:'fixture',style:{width:'900px',maxWidth:'100vw'}},
          React.createElement('section',{id:'assistant'},React.createElement(MessageResponse,null,source)),
          React.createElement('section',{id:'user'},React.createElement(UserMessageContent,null,inline)),
          React.createElement('section',{id:'composer'},React.createElement(RichTextInput,{value:'<p>正文 <code>const value = 1</code> 后文</p>',onChange:()=>{}})),
          React.createElement('section',{id:'rich'},React.createElement(MarkdownRichEditor,{value:inline,editing:true,showToolbar:false,onChange:()=>{},onSave:()=>{},onCancel:()=>{}})),
          React.createElement('section',{id:'workspace',style:markdownEditorStyle(preferences)},React.createElement(MarkdownWorkspaceEditor,{documentId:'inline-code',value:inline,editing:true,showToolbar:false,preferences,onSave:()=>{},onChange:()=>{},resolveMedia:async()=>null,onError:()=>{}})),
          React.createElement('section',{id:'live'},React.createElement(LiveMarkdownEditor,{ref:liveRef,value:source,onChange:()=>{},readOnly:false})),
          React.createElement('section',{id:'nested',style:{fontSize:'20px'}},React.createElement('p',null,'嵌套 ',React.createElement('code',{className:'rounded bg-muted px-1 py-0.5 text-sm font-mono'},React.createElement('span',{className:'text-primary'},'const token = 1')))),
          React.createElement('section',{id:'path'},React.createElement(MessageResponse,null,tick+'/not-authorized/missing-file.txt'+tick)),
          React.createElement('section',{id:'available'},React.createElement(MessageResponse,null,tick+'/available/file.md'+tick)),
          React.createElement('section',{id:'long',className:'reading-body',style:{width:'240px'}},React.createElement('p',null,'长代码 ',React.createElement('code',null,'long_inline_identifier_'.repeat(8))))
        )));
        await wait(700);
        if(!document.getElementById('nested'))throw new Error(window.inlineError??'行内代码测试组件未挂载');
        document.querySelector('#composer .tiptap').editor.commands.setContent('<p>正文 <code>const value = 1</code> 后文</p>');
        await wait(50);await document.fonts.ready;
      },
      read(selector){const e=document.querySelector(selector);if(!e)throw new Error('缺少行内代码样本：'+selector);const s=getComputedStyle(e),p=getComputedStyle(e.parentElement);return {selector,family:s.fontFamily,size:parseFloat(s.fontSize),parentSize:parseFloat(p.fontSize),color:s.color,parentColor:p.color,background:s.backgroundColor,border:s.borderTopWidth,borderStyle:s.borderTopStyle,borderColor:s.borderTopColor,radii:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius],padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),display:s.display};},
      samples(){return selectors.map(selector=>this.read(selector));}
    };
  `, { timeoutMs: 25_000 })
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

interface InlineStyle {
  selector: string; family: string; size: number; parentSize: number
  color: string; parentColor: string; background: string; border: string; borderStyle: string; borderColor: string
  radii: string[]; padding: number[]; display: string
}
function expectInline(style: InlineStyle, dark = false): void {
  expect(style.family).toMatch(/monospace|Menlo|Monaco/)
  expect(style.size).toBeCloseTo(style.parentSize * 0.875, 3)
  expect(style.background).toBe(dark ? 'rgb(48, 48, 46)' : 'rgb(240, 238, 230)')
  expect(style.color).toBe(style.parentColor)
  expect(style.border).toBe('1px')
  expect(style.borderStyle).toBe('solid')
  expect(style.borderColor).toBe(dark ? 'rgba(250, 249, 245, 0.08)' : 'rgba(20, 20, 19, 0.08)')
  expect(style.radii).toEqual(['6px', '6px', '6px', '6px'])
  for (const index of [0, 2]) expect(style.padding[index]!).toBeCloseTo(style.size * 0.1, 3)
  for (const index of [1, 3]) expect(style.padding[index]!).toBeCloseTo(style.size * 0.4, 3)
}

describe('Given 第3步统一的行内代码样式', () => {
  test('When 各消息与编辑器在亮暗或历史主题渲染 Then 同为等宽0.875em、下沉层、细边框和指定圆角内边距', async () => {
    for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
      const samples = await renderer.run<InlineStyle[]>(`await window.inlineFixture.mount(${JSON.stringify(theme)});return window.inlineFixture.samples();`)
      expect(samples).toHaveLength(7)
      for (const sample of samples) expectInline(sample, !!theme)
    }
  }, 60_000)

  test('When 文档局部主题与全局相反且字号改变 Then 使用局部下沉层/边框并按0.875em缩放', async () => {
    const result = await renderer.run<{ dark: InlineStyle }>(`
      const f=window.inlineFixture;await f.mount('','night',22);const dark=f.read('#workspace p code');
      return {dark};
    `)
    expectInline(result.dark, true)
    expect(result.dark.size).toBeCloseTo(19.25, 3)
    const light = await renderer.run<InlineStyle>(`const f=window.inlineFixture;await f.mount('dark','paper',20);return f.read('#workspace p code');`)
    expectInline(light)
    expect(light.size).toBeCloseTo(17.5, 3)
  }, 30_000)

  test('When 行内代码含语法span且字号来自父级 Then 不添加高亮色或再次缩小子字号', async () => {
    const result = await renderer.run<{ code: InlineStyle; child: InlineStyle }>(`const f=window.inlineFixture;await f.mount();return {code:f.read('#nested code'),child:f.read('#nested code span')};`)
    expectInline(result.code)
    expect(result.child.size).toBe(result.code.size)
    expect(result.child.color).toBe(result.code.color)
    expect(result.child.background).toBe('rgba(0, 0, 0, 0)')
  }, 30_000)

  test('When 同一段Markdown含fenced代码块和未解析文件路径 Then 不为代码块叠加行内边框，路径保留回退与文本', async () => {
    const result = await renderer.run<{ block: InlineStyle; prePadding: string; path: InlineStyle; pathText: string; pathButtons: number; availableCode: number; availableButtons: number }>(`
      const f=window.inlineFixture;await f.mount();return {block:f.read('#assistant pre code'),prePadding:getComputedStyle(document.querySelector('#assistant pre')).padding,path:f.read('#path code'),pathText:document.getElementById('path').textContent,pathButtons:document.querySelectorAll('#path button').length,availableCode:document.querySelectorAll('#available code').length,availableButtons:document.querySelectorAll('#available button').length};
    `)
    expect(result.block.border).toBe('0px')
    expect(result.block.padding).toEqual([0, 0, 0, 0])
    expect(result.block.radii).toEqual(['0px', '0px', '0px', '0px'])
    expect(result.prePadding).toBe('16px')
    expectInline(result.path)
    expect(result.pathText).toBe('/not-authorized/missing-file.txt')
    expect(result.pathButtons).toBe(0)
    expect(result.availableCode).toBe(0)
    expect(result.availableButtons).toBe(1)
  }, 30_000)

  test('When 长行内代码在窄正文换行 Then 不撑开正文或改变胶囊参数', async () => {
    const result = await renderer.run<{ style: InlineStyle; width: number; fragments: number[]; overflow: boolean }>(`
      const f=window.inlineFixture;await f.mount();const p=document.querySelector('#long p'),code=p.querySelector('code');
      return {style:f.read('#long code'),width:p.getBoundingClientRect().width,fragments:[...code.getClientRects()].map(rect=>rect.width),overflow:p.scrollWidth>p.clientWidth};
    `)
    expectInline(result.style)
    expect(result.fragments.length).toBeGreaterThan(1)
    expect(result.overflow).toBe(false)
    for (const width of result.fragments) expect(width).toBeLessThanOrEqual(result.width + 1)
  }, 30_000)

  test('When ink-mde聚焦行内代码并编辑撤销 Then 只给内容一个胶囊，反引号不单独画框且源码保留', async () => {
    const result = await renderer.run<{ inner: InlineStyle; markers: Array<{ border: string; background: string; padding: string }>; changed: string; restored: string }>(`
      const f=window.inlineFixture;await f.mount();const view=f.liveRef.current.getView();
      view.dispatch({selection:{anchor:f.source.indexOf('value')}});view.focus();
      // 测试窗口不向系统抢焦点，显式投递编辑器 focus 事件以检查活动行的源码标记。
      view.contentDOM.dispatchEvent(new FocusEvent('focus'));await f.wait(80);
      const inner=f.read('#live .cm-code:not(.cm-code-open,.cm-code-close)');
      const markers=[...document.querySelectorAll('#live .cm-code-open,#live .cm-code-close')].map(e=>{const s=getComputedStyle(e);return {border:s.borderTopWidth,background:s.backgroundColor,padding:s.padding}});
      const at=f.source.indexOf('1');view.dispatch({changes:{from:at,to:at+1,insert:'3'},userEvent:'input.type'});const changed=view.state.doc.toString();f.undo(view);await f.wait(80);
      return {inner,markers,changed,restored:view.state.doc.toString()};
    `)
    expectInline(result.inner)
    expect(result.markers.length).toBeGreaterThanOrEqual(2)
    for (const marker of result.markers) expect(marker).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)', padding: '0px' })
    expect(result.changed).toContain('const value = 3')
    expect(result.restored).toContain('const value = 1')
    expect(result.restored).toContain('const block = 2')
  }, 30_000)
})
