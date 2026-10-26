import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {CodeBlock,MermaidBlock} from '@gamma/ui';
    import {MarkdownSourceEditor} from '@/components/markdown-workspace/MarkdownSourceEditor';
    import {LiveMarkdownEditor} from '@/components/markdown/LiveMarkdownEditor';
    import {markdownThemeStyle} from '@/components/markdown-workspace/markdown-editor-presentation';
    import {getTerminalAppearanceOptions} from '@/lib/terminal-theme';
    import {PIERRE_DIFF_CSS} from '@/components/agent/tool-result-renderers/pierre-styles';
    import '@/styles/globals.css';
    import '@/components/markdown-workspace/markdown-workspace.css';
    const root=createRoot(document.getElementById('root'));
    window.paletteFixture={
      async mount(theme,local='inherit'){
        document.documentElement.className=theme;
        root.render(React.createElement('section',{id:'local',style:markdownThemeStyle(local)},
          React.createElement('article',{className:'prose dark:prose-invert'},React.createElement('h2',null,'标题'),React.createElement('p',null,'正文 ',React.createElement('strong',null,'强调')),React.createElement('blockquote',null,'引用')),
          React.createElement('div',{id:'source'},React.createElement(MarkdownSourceEditor,{value:'# 标题\\n**正文** \\u0060代码\\u0060',readOnly:false,onChange:()=>{}})),
          React.createElement('div',{id:'ink'},React.createElement(LiveMarkdownEditor,{value:'# 标题\\n**正文**',onChange:()=>{},readOnly:false})),
          React.createElement(CodeBlock,null,React.createElement('code',{className:'language-typescript'},'const count = 1')),
          React.createElement('div',{id:'flow'},React.createElement(MermaidBlock,{code:'graph TD\\nA[开始] --> B[完成]'})),
          React.createElement('div',{id:'fallback'},React.createElement(MermaidBlock,{code:'gantt\\ntitle 项目计划\\ndateFormat YYYY-MM-DD\\nsection 研发\\n执行 :crit, 2026-10-26, 1d'})),
          React.createElement('div',{id:'pierrefixture'})
        ));
        await new Promise(r=>setTimeout(r,2000));
        const shadow=document.getElementById('pierrefixture').attachShadow({mode:'open'});
        shadow.innerHTML='<style>'+PIERRE_DIFF_CSS+'</style><div data-line><span style="--diffs-token-light: red;--diffs-token-dark: blue">const value = 1</span></div>';
        return {flow:!!document.querySelector('#flow svg'),fallback:!!document.querySelector('#fallback .mermaid-svg svg')};
      },
      async localTheme(theme){const style=document.getElementById('local').style;for(const [name,value] of Object.entries(markdownThemeStyle(theme))){if(name.startsWith('--'))style.setProperty(name,String(value));else style[name]=value;}await new Promise(r=>setTimeout(r,1200));},
      colors(){
        const selectors=['.prose h2','.prose p','.prose strong','.prose blockquote','#source .cm-content','#source .cm-content span','#ink .cm-content','#ink .cm-content span','.code-block-wrapper pre','.code-block-wrapper .line span'];
        const text=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(e=>({selector,color:getComputedStyle(e).color})));
        const diagrams=[...document.querySelectorAll('.mermaid-svg svg')].map(svg=>({background:getComputedStyle(svg).backgroundColor,text:[...svg.querySelectorAll('text')].map(e=>getComputedStyle(e).fill),shapes:[...svg.querySelectorAll('rect,path,polygon,circle,line')].flatMap(e=>[getComputedStyle(e).fill,getComputedStyle(e).stroke])}));
        return {text,diagrams,pierre:getComputedStyle(document.getElementById('pierrefixture').shadowRoot.querySelector('[data-line] span')).color,terminal:getTerminalAppearanceOptions().theme};
      }
    };
  `, { timeoutMs: 25_000 })
}, 90_000)
afterAll(async () => { await renderer?.dispose() })

interface ConsumerSnapshot {
  text: Array<{ selector: string; color: string }>
  diagrams: Array<{ background: string; text: string[]; shapes: string[] }>
  pierre: string
  terminal: Record<string, string>
}

const allowedChannels = new Set(['31,30,29', '38,38,36', '48,48,46', '240,238,230', '176,174,165', '133,131,123', '217,119,87', '250,249,245', '255,255,255', '20,20,19', '94,93,89', '138,136,127'])
function channels(color: string): string | null {
  if (color === 'none' || color === 'transparent' || /,\s*0\)$/.test(color)) return null
  if (color.startsWith('color(srgb ')) return color.slice(11).split(/[\s/)]/).filter(Boolean).slice(0, 3).map(value => Math.round(Number(value) * 255)).join(',')
  return color.match(/[\d.]+/g)?.slice(0, 3).map(Number).join(',') ?? color
}

describe('Given 第三方渲染器消费全局设计令牌', () => {
  test('When 亮暗主题渲染正文、两种编辑器、代码与 Shadow DOM Then 使用对应暖色文字且不引入独立色板', async () => {
    for (const theme of ['', 'dark']) {
      const result = await renderer.run<ConsumerSnapshot>(`const fixture=window.paletteFixture;await fixture.mount(${JSON.stringify(theme)});return fixture.colors();`)
      expect(result.text.length).toBeGreaterThan(8)
      for (const item of result.text) expect(allowedChannels.has(channels(item.color) ?? '')).toBe(true)
      expect(result.pierre).toBe(theme ? 'rgb(240, 238, 230)' : 'rgb(20, 20, 19)')
      expect(result.terminal.background?.toLowerCase()).toBe(theme ? '#1f1e1d' : '#faf9f5')
      expect(result.diagrams).toHaveLength(2)
      for (const diagram of result.diagrams) {
        for (const color of [diagram.background, ...diagram.text, ...diagram.shapes]) {
          const base = channels(color)
          if (base) expect({ color, allowed: allowedChannels.has(base) }).toEqual({ color, allowed: true })
        }
      }
    }
  }, 60_000)

  test('When 全局亮色中切换文档局部主题 Then Mermaid 读取宿主令牌并重新绘制', async () => {
    const result = await renderer.run<{ before: string; after: string }>(`
      const fixture=window.paletteFixture;await fixture.mount('','paper');
      const before=getComputedStyle(document.querySelector('#flow .mermaid-svg svg')).backgroundColor;
      await fixture.localTheme('night');
      return {before,after:getComputedStyle(document.querySelector('#flow .mermaid-svg svg')).backgroundColor};
    `)
    expect(result).toEqual({ before: 'rgb(250, 249, 245)', after: 'rgb(31, 30, 29)' })
  }, 30_000)
})
