import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from '@gamma/shared';
    import {MessageResponse,UserMessageContent} from '@/components/ai-elements/message';
    import {RichTextInput} from '@/components/ai-elements/rich-text-input';
    import {LiveMarkdownEditor} from '@/components/markdown/LiveMarkdownEditor';
    import {MarkdownSourceEditor} from '@/components/markdown-workspace/MarkdownSourceEditor';
    import {MarkdownWorkspaceEditor} from '@/components/markdown-workspace/MarkdownWorkspaceEditor';
    import {markdownEditorStyle} from '@/components/markdown-workspace/markdown-editor-presentation';
    import {applyMarkdownFontSizeToDOM} from '@/atoms/markdown-font-size';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root'));
    const paragraph='安静的排版让阅读回到内容本身。Thoughtful typography keeps the words clear. '.repeat(15);
    const message=paragraph+'\\n\\n'+String.fromCharCode(96)+'inline'+String.fromCharCode(96)+'\\n\\n'+String.fromCharCode(96).repeat(3)+'typescript\\nconst value = 1\\n'+String.fromCharCode(96).repeat(3);
    window.electronAPI={getSettings:async()=>({})};
    window.typographyFixture={
      async mount(theme='',width=900){
        document.documentElement.className=theme;applyMarkdownFontSizeToDOM('medium');
        root.render(React.createElement(TooltipProvider,null,React.createElement('main',{id:'fixture',style:{width,maxWidth:'100vw'}},
          React.createElement('aside',{className:'gamma-sidebar'},React.createElement('button',{id:'ui'},'新建会话')),
          React.createElement('section',{id:'assistant'},React.createElement(MessageResponse,null,message)),
          React.createElement('section',{id:'user'},React.createElement(UserMessageContent,null,paragraph)),
          React.createElement('section',{id:'composer'},React.createElement(RichTextInput,{value:'编辑一段中文和 English prose',onChange:()=>{}})),
          React.createElement('section',{id:'live'},React.createElement(LiveMarkdownEditor,{value:'长文正文与 reading text',onChange:()=>{},readOnly:true})),
          React.createElement('section',{id:'workspace',style:markdownEditorStyle(DEFAULT_MARKDOWN_EDITOR_PREFERENCES)},React.createElement(MarkdownWorkspaceEditor,{documentId:'typography',value:'文档正文与 document text',editing:true,preferences:DEFAULT_MARKDOWN_EDITOR_PREFERENCES,onSave:()=>{},onChange:()=>{},resolveMedia:async()=>null,onError:()=>{}})),
          React.createElement('section',{id:'source'},React.createElement(MarkdownSourceEditor,{value:'# source',readOnly:false,onChange:()=>{}}))
        )));
        await new Promise(resolve=>setTimeout(resolve,700));await document.fonts.ready;
      },
      read(){
        const read=selector=>{const e=document.querySelector(selector);if(!e)throw new Error('缺少字体样本 '+selector);const s=getComputedStyle(e);return {family:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight,weight:s.fontWeight,width:e.getBoundingClientRect().width};};
        return {body:read('#assistant p'),user:read('#user p'),composer:read('#composer .ProseMirror p'),live:read('#live .cm-content'),workspace:read('#workspace .markdown-workspace-prose p'),ui:read('#ui'),toolbar:read('.code-block-wrapper button'),inline:read('#assistant p code'),code:read('#assistant pre'),source:read('#source .cm-content'),readingWidth:document.querySelector('#assistant>div').getBoundingClientRect().width,overflow:document.getElementById('fixture').scrollWidth>document.getElementById('fixture').clientWidth};
      }
    };
  `, { timeoutMs: 25_000 })
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

interface TextStyle { family: string; size: string; lineHeight: string; weight: string; width: number }
interface TypographySnapshot { body: TextStyle; user: TextStyle; composer: TextStyle; live: TextStyle; workspace: TextStyle; ui: TextStyle; toolbar: TextStyle; inline: TextStyle; code: TextStyle; source: TextStyle; readingWidth: number; overflow: boolean }

function expectBody(style: TextStyle): void {
  expect(style.family).toContain('Source Serif 4')
  expect(style.family).toContain('Noto Serif SC')
  expect(style.family).toContain('Songti SC')
  expect(style.size).toBe('15.5px')
  expect(parseFloat(style.lineHeight)).toBeCloseTo(26.35, 2)
  expect(style.weight).toBe('400')
}

describe('Given 正文衬线与 UI 无衬线的字体契约', () => {
  test('When 亮暗或历史主题显示消息和长文本 Then 正文统一为指定字体、15.5px、1.7、400', async () => {
    for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
      const snapshot = await renderer.run<TypographySnapshot>(`await window.typographyFixture.mount(${JSON.stringify(theme)});return window.typographyFixture.read();`)
      for (const style of [snapshot.body, snapshot.user, snapshot.composer, snapshot.live, snapshot.workspace]) expectBody(style)
      for (const style of [snapshot.ui, snapshot.toolbar]) { expect(style.family).toContain('Inter'); expect(style.family).toContain('PingFang SC'); expect(style.family).not.toContain('Source Serif') }
      for (const style of [snapshot.inline, snapshot.code, snapshot.source]) { expect(style.family).toMatch(/monospace|Menlo|Monaco/); expect(style.family).not.toContain('Source Serif') }
    }
  }, 60_000)

  test('When 在宽屏与窄屏阅读 Then 行宽不超过680px且不引入水平溢出', async () => {
    const snapshots = await renderer.run<TypographySnapshot[]>(`const f=window.typographyFixture;await f.mount('',900);const wide=f.read();document.getElementById('fixture').style.width='380px';await new Promise(r=>requestAnimationFrame(r));return [wide,f.read()];`)
    expect(snapshots[0]!.readingWidth).toBe(680)
    expect(snapshots[1]!.readingWidth).toBeLessThanOrEqual(380)
    for (const snapshot of snapshots) { expect(snapshot.overflow).toBe(false); expect(snapshot.workspace.width).toBeLessThanOrEqual(680) }
  }, 30_000)

  test('When 宽窄输入框包含占位符、中文或长连续文本 Then 编辑区域填满外框且不溢出', async () => {
    const results = await renderer.run<Array<{ width: number; editorWidth: number; paragraphWidth: number; contentWidth: number; overflow: boolean; readingWidth: number }>>(`
      const results=[];
      for (const theme of ['', 'dark']) {
        await window.typographyFixture.mount(theme);
        const host=document.querySelector('#composer');
        const editor=host.querySelector('.ProseMirror');
        for (const width of [1200,380]) {
          document.getElementById('fixture').style.width=width+'px';
          document.getElementById('fixture').style.maxWidth='none';
          for (const text of ['', '输入中文与 English 文本。'.repeat(60), 'abcdefghij'.repeat(100)]) {
            editor.editor.commands.setContent(text ? '<p>'+text+'</p>' : '');
            await new Promise(r=>requestAnimationFrame(r));
            const style=getComputedStyle(editor);
            results.push({width:host.clientWidth,editorWidth:editor.getBoundingClientRect().width,
              paragraphWidth:editor.querySelector('p').getBoundingClientRect().width,
              contentWidth:host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
              overflow:editor.scrollWidth>editor.clientWidth || host.scrollWidth>host.clientWidth,
              readingWidth:document.querySelector('#assistant>div').getBoundingClientRect().width});
          }
        }
      }
      return results;
    `)
    expect(results).toHaveLength(12)
    for (const result of results) {
      expect(result.editorWidth).toBeCloseTo(result.width, 0)
      expect(result.paragraphWidth).toBeCloseTo(result.contentWidth, 0)
      expect(result.overflow).toBe(false)
      expect(result.readingWidth).toBeLessThanOrEqual(680)
    }
  }, 30_000)

  test('When 长用户消息在新行高下折叠并展开 Then 仍按四行截断且不改变正文字体', async () => {
    const result = await renderer.run<{ collapsed: number; expanded: number; lineHeight: number; family: string }>(`
      const f=window.typographyFixture;await f.mount();
      const host=document.querySelector('#user .overflow-hidden'),button=document.querySelector('#user button');
      const collapsed=host.getBoundingClientRect().height,lineHeight=parseFloat(getComputedStyle(document.querySelector('#user p')).lineHeight);
      button.click();await new Promise(r=>setTimeout(r,250));
      return {collapsed,expanded:host.getBoundingClientRect().height,lineHeight,family:getComputedStyle(document.querySelector('#user p')).fontFamily};
    `)
    expect(result.collapsed).toBeCloseTo(result.lineHeight * 4, 1)
    expect(result.expanded).toBeGreaterThan(result.collapsed)
    expect(result.family).toContain('Source Serif 4')
  }, 30_000)

  test('When 加载中英文正文 Then 实际使用随应用打包的字体，不依赖公网字体服务', async () => {
    const fonts = await renderer.run<Array<{ family: string; status: string }>>(`await window.typographyFixture.mount();await document.fonts.load('400 15.5px "Source Serif 4"','Reading');await document.fonts.load('400 15.5px "Noto Serif SC"','中文正文');return [...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family.replaceAll('"',''),status:f.status}));`)
    expect(fonts.some(font => font.family === 'Source Serif 4')).toBe(true)
    expect(fonts.some(font => font.family === 'Noto Serif SC')).toBe(true)
  }, 30_000)
})
