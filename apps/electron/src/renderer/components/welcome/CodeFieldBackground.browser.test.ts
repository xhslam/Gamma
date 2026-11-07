import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createVisualRendererHarness } from '../../../test-utils/visual-renderer'
import type { VisualRendererHarness } from '../../../test-utils/visual-renderer'

let renderer: VisualRendererHarness
const artifacts = process.env.GAMMA_VISUAL_ARTIFACT_DIR
beforeAll(async () => {
  if (artifacts) await mkdir(artifacts, { recursive: true })
  renderer = await createVisualRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { CodeFieldBackground } from '@/components/welcome/CodeFieldBackground';
    import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
    import '@/styles/globals.css';
    // 测试宿主的原生窗口默认隐藏，主动模拟前台页面。
    Object.defineProperty(document, 'hidden', {value:false,configurable:true});
    const root = createRoot(document.getElementById('root'));
    window.mountField = dark => {
      document.documentElement.classList.toggle('dark', dark);
      flushSync(() => root.render(React.createElement('main', {style:{height:'100vh',display:'flex',flexDirection:'column',padding:24}},
        React.createElement('header', {style:{height:40}}, '新会话'),
        React.createElement('div', {id:'field',style:{position:'relative',display:'flex',flex:1,minHeight:0}},
          React.createElement(CodeFieldBackground),
          React.createElement(Conversation, null, React.createElement(ConversationContent, {className:'h-full'},
            React.createElement('div', {className:'welcome-empty-state flex h-full items-center justify-center'},
              React.createElement('h1', {className:'text-3xl font-medium tracking-tight'}, '下午好，今天想做些什么？'))))),
        React.createElement('input', {id:'input',placeholder:'输入消息…',className:'gamma-composer bg-background',style:{padding:24}}))));
    };
    function FullField() {
      const [container, setContainer] = React.useState(null);
      return React.createElement('div',{className:'gamma-workbench flex',style:{height:'100vh'}},
        React.createElement('div',{className:'gamma-workbench-frame'},
        React.createElement('aside',{id:'sidebar',style:{width:208,flexShrink:0}}),
        React.createElement('main',{id:'panel','data-panel':'content',className:'gamma-panel h-full min-w-0 flex-1 overflow-hidden'},
        React.createElement('div', {ref:setContainer,'data-agent-conversation-root':'',className:'relative isolate flex h-full flex-col overflow-hidden'},
        React.createElement('header', {style:{height:40,flexShrink:0}}, '新会话'),
        React.createElement('div', {id:'column',className:'flex min-h-0 flex-1 flex-col w-full mx-auto',style:{maxWidth:560}},
          React.createElement('div', {id:'field',className:'relative flex min-h-0 flex-1'},
            React.createElement(CodeFieldBackground, {container}),
            React.createElement(Conversation, null, React.createElement(ConversationContent, {className:'h-full'},
              React.createElement('div', {className:'welcome-empty-state flex h-full items-center justify-center'},
                React.createElement('h1', null, '下午好'))))),
          React.createElement('input', {id:'input',placeholder:'输入消息…',className:'gamma-composer bg-background',style:{padding:24}}))))));
    }
    window.mountFullField = () => flushSync(() => root.render(React.createElement(FullField)));
    window.fieldSample = () => {
      const canvas = document.querySelector('canvas');
      const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let sum = 0, pixels = 0, blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i+3] * ((i % 97) + 1);
        if (data[i+3]) pixels++;
        if (data[i+3] > 12 && data[i+2] - data[i] > 30) blue++;
      }
      const style = getComputedStyle(canvas);
      return {sum,pixels,blue,pointer:style.pointerEvents,hidden:canvas.getAttribute('aria-hidden')};
    };
    window.unmountField = () => flushSync(() => root.unmount());
    window.mountField(true);
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

interface Sample { sum: number; pixels: number; blue: number; pointer: string; hidden: string }

describe('Given 逐源帧驱动的新会话字符背景', () => {
  test('When 内容栏限宽 Then 背景覆盖全会话且输入区仍可点击和聚焦', async () => {
    const result = await renderer.run<{ covers: boolean; touchesSidebar: boolean; limited: boolean; behind: boolean; focused: boolean }>(`
      window.mountFullField();
      await new Promise(resolve => setTimeout(resolve, 160));
      const panel = document.getElementById('panel');
      const canvas = document.querySelector('canvas');
      const bounds = canvas.getBoundingClientRect();
      const area = panel.getBoundingClientRect();
      const input = document.getElementById('input');
      const inputBounds = input.getBoundingClientRect();
      const behind = document.elementFromPoint(inputBounds.x+20,inputBounds.y+20) === input;
      input.focus();
      return {
        covers:bounds.x===area.x && bounds.y===area.y && bounds.width===area.width && bounds.height===area.height,
        touchesSidebar:document.getElementById('sidebar').getBoundingClientRect().right===bounds.left,
        limited:document.getElementById('column').getBoundingClientRect().width===560 && area.width>560,
        behind,focused:document.activeElement===input
      };
    `)
    expect(result).toEqual({ covers: true, touchesSidebar: true, limited: true, behind: true, focused: true })
  }, 30_000)

  for (const dark of [true, false]) {
    test(`When 使用${dark ? '深' : '浅'}色主题 Then 原片光带按时间轴在字符中起亮`, async () => {
      const result = await renderer.run<{ before: Sample; peak: Sample; later: Sample }>(`
        window.mountField(${dark});
        await new Promise(resolve => setTimeout(resolve, 300));
        const before = window.fieldSample();
        await new Promise(resolve => setTimeout(resolve, 3050));
        const peak = window.fieldSample();
        await new Promise(resolve => setTimeout(resolve, 100));
        return {before,peak,later:window.fieldSample()};
      `, { screenshot: artifacts ? join(artifacts, `gamma-motion-${dark ? 'dark' : 'light'}.png`) : undefined })
      expect(result.before.pixels).toBeGreaterThan(1000)
      expect(result.before.blue).toBe(0)
      expect(result.peak.blue).toBeGreaterThan(1000)
      expect(result.later.sum).not.toBe(result.peak.sum)
      expect(result.peak.pointer).toBe('none')
      expect(result.peak.hidden).toBe('true')
    }, 30_000)
  }

  test('When 系统要求减少动态效果 Then 静态字符保持可见且不响应点击', async () => {
    const result = await renderer.run<{ before: Sample; after: Sample }>(`
      await new Promise(resolve => setTimeout(resolve, 200));
      const before = window.fieldSample();
      document.getElementById('field').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,isPrimary:true,button:0,clientX:180,clientY:160}));
      await new Promise(resolve => setTimeout(resolve, 3200));
      return {before,after:window.fieldSample()};
    `, { reducedMotion: true })
    expect(result.before.pixels).toBeGreaterThan(1000)
    expect(result.after).toEqual(result.before)
  }, 30_000)

  test('When 窗口隐藏 Then 停止合成并显示静态底纹', async () => {
    const result = await renderer.run<{ peak: number; hidden: Sample; later: Sample }>(`
      await new Promise(resolve => setTimeout(resolve, 3300));
      const peak = window.fieldSample().blue;
      Object.defineProperty(document, 'hidden', {value:true});
      document.dispatchEvent(new Event('visibilitychange'));
      const hidden = window.fieldSample();
      await new Promise(resolve => setTimeout(resolve, 200));
      return {peak,hidden,later:window.fieldSample()};
    `)
    expect(result.peak).toBeGreaterThan(1000)
    expect(result.hidden.blue).toBe(0)
    expect(result.later).toEqual(result.hidden)
  }, 30_000)
})
