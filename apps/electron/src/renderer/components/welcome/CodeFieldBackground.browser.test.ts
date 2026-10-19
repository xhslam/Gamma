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
    window.fieldSample = () => {
      const canvas = document.querySelector('canvas');
      const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let sum = 0, pixels = 0, contrastPixels = 0;
      const background = getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g).slice(0,3).map(Number);
      for (let i = 3; i < data.length; i += 4) {
        sum += data[i] * (i % 97); if (data[i]) pixels++;
        const contrast = Math.max(...background.map((value, channel) => Math.abs(data[i-3+channel]-value)*data[i]/255));
        if (contrast >= 12) contrastPixels++;
      }
      const style = getComputedStyle(canvas);
      return {sum,pixels,contrastPixels,width:canvas.width,height:canvas.height,pointer:style.pointerEvents,opacity:style.opacity,hidden:canvas.getAttribute('aria-hidden')};
    };
    window.clickField = (selector = '.welcome-empty-state', button = 0) => {
      const target = document.querySelector(selector);
      const bounds = target.getBoundingClientRect();
      target.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,button,isPrimary:true,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2}));
    };
    window.moveField = (selector = '.welcome-empty-state', options = {}) => {
      const target = document.querySelector(selector);
      const bounds = target.getBoundingClientRect();
      target.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,isPrimary:true,pointerType:'mouse',buttons:0,clientX:bounds.x+bounds.width/2,clientY:bounds.y+bounds.height/2,...options}));
    };
    window.unmountField = () => flushSync(() => root.unmount());
    window.mountField(true);
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

interface Sample { sum: number; pixels: number; contrastPixels: number; width: number; height: number; pointer: string; opacity: string; hidden: string }

describe('Given 新会话的字符流场背景', () => {
  for (const dark of [true, false]) {
    test(`When 使用${dark ? '深' : '浅'}色主题 Then 字符持续变化且输入框仍可聚焦`, async () => {
      const result = await renderer.run<{ before: Sample; after: Sample; focused: boolean }>(`
        window.mountField(${dark});
        await new Promise(resolve => setTimeout(resolve, 160));
        const before = window.fieldSample();
        await new Promise(resolve => setTimeout(resolve, 600));
        document.getElementById('input').focus();
        return {before,after:window.fieldSample(),focused:document.activeElement.id==='input'};
      `, { screenshot: artifacts ? join(artifacts, `code-field-${dark ? 'dark' : 'light'}.png`) : undefined })
      expect(result.before.pixels).toBeGreaterThan(1000)
      expect(result.after.sum).not.toBe(result.before.sum)
      expect(result.before.opacity).toBe('1')
      expect(result.before.contrastPixels).toBeGreaterThan(1000)
      expect(result.before.hidden).toBe('true')
      expect(result.before.pointer).toBe('none')
      expect(result.focused).toBe(true)
    }, 30_000)
  }
  test('When 系统要求减少动态效果 Then 保留静态纹理且不再变换字符', async () => {
    const result = await renderer.run<{ before: Sample; after: Sample }>(`
      await new Promise(resolve => setTimeout(resolve, 160));
      const before = window.fieldSample();
      window.clickField();
      window.moveField();
      await new Promise(resolve => setTimeout(resolve, 300));
      return {before,after:window.fieldSample()};
    `, { reducedMotion: true })
    expect(result.before.pixels).toBeGreaterThan(1000)
    expect(result.after.sum).toBe(result.before.sum)
  }, 30_000)
  test('When 鼠标划过背景 Then 产生柔和波纹且连续事件不会同步重绘', async () => {
    const result = await renderer.run<{ before: number; after: number; burst: number; paints: number }>(`
      await new Promise(resolve => setTimeout(resolve, 160));
      const now = performance.now();
      performance.now = () => now;
      document.dispatchEvent(new Event('visibilitychange'));
      const before = window.fieldSample().sum;
      const context = document.querySelector('canvas').getContext('2d');
      const clear = context.clearRect.bind(context);
      let paints = 0;
      context.clearRect = (...args) => { paints++; clear(...args); };
      window.moveField();
      const synchronousPaints = paints;
      document.dispatchEvent(new Event('visibilitychange'));
      const after = window.fieldSample().sum;
      window.moveField();
      for (let i=0;i<200;i++) window.moveField('.welcome-empty-state',{clientX:60+i*3,clientY:200});
      document.dispatchEvent(new Event('visibilitychange'));
      return {before,after,burst:window.fieldSample().sum,paints:synchronousPaints};
    `)
    expect(result.after).not.toBe(result.before)
    expect(result.paints).toBe(0)
    // 重复移动位于同一波心，后续高频事件应被节流，没有额外的波纹。
    expect(result.burst).toBe(result.after)
  }, 30_000)
  test('When 鼠标经过输入控件、触屏移动或拖动 Then 背景不响应', async () => {
    const result = await renderer.run<{ before: number; after: number }>(`
      await new Promise(resolve => setTimeout(resolve, 160));
      const now = performance.now(); performance.now = () => now;
      document.dispatchEvent(new Event('visibilitychange'));
      const before = window.fieldSample().sum;
      const button = document.createElement('button'); button.id='hover-button';
      button.textContent='按钮'; document.querySelector('.welcome-empty-state').append(button);
      window.moveField('#hover-button');
      window.moveField('.welcome-empty-state',{pointerType:'touch'});
      window.moveField('.welcome-empty-state',{buttons:1});
      document.dispatchEvent(new Event('visibilitychange'));
      return {before,after:window.fieldSample().sum};
    `)
    expect(result.after).toBe(result.before)
  }, 30_000)
  for (const theme of ['theme-ocean-light', 'theme-forest-light', 'theme-slate-light']) {
    test(`When 切换到明亮主题 ${theme} Then 字符仍有可辨识对比度`, async () => {
      const result = await renderer.run<Sample>(`
        window.mountField(false);
        document.documentElement.className=${JSON.stringify(theme)};
        await new Promise(resolve => setTimeout(resolve, 160));
        return window.fieldSample();
      `, { screenshot: artifacts ? join(artifacts, 'code-field-' + theme + '.png') : undefined })
      expect(result.opacity).toBe('1')
      expect(result.contrastPixels).toBeGreaterThan(1000)
    }, 30_000)
  }
  test('When 点击上层空白内容 Then 涟漪立即在穿透画布上呈现', async () => {
    const result = await renderer.run<{ before: number; after: number; blocked: boolean }>(`
      await new Promise(resolve => setTimeout(resolve, 160));
      const before = window.fieldSample().sum;
      let blocked = false;
      document.getElementById('field').addEventListener('pointerdown', event => { blocked = event.defaultPrevented; });
      window.clickField();
      const after = window.fieldSample().sum;
      await new Promise(resolve => setTimeout(resolve, 320));
      return {before,after,blocked};
    `, { screenshot: artifacts ? join(artifacts, 'code-field-ripple.png') : undefined })
    expect(result.after).not.toBe(result.before)
    expect(result.blocked).toBe(false)
  }, 30_000)
  test('When 点击按钮、输入区或右键 Then 不触发背景涟漪', async () => {
    const result = await renderer.run<{ before: number; after: number }>(`
      await new Promise(resolve => setTimeout(resolve, 160));
      const field = document.querySelector('.welcome-empty-state');
      for (const tag of ['button','input','a','div']) {
        const control = document.createElement(tag);
        control.id = 'control-' + tag;
        if (tag === 'div') control.contentEditable = 'true';
        control.textContent = '交互控件';
        field.append(control);
      }
      const before = window.fieldSample().sum;
      for (const tag of ['button','input','a','div']) window.clickField('#control-' + tag);
      window.clickField('.welcome-empty-state', 2);
      return {before,after:window.fieldSample().sum};
    `)
    expect(result.after).toBe(result.before)
  }, 30_000)
  test('When 缩窄面板并卸载 Then 画布跟随容器且释放动画', async () => {
    const result = await renderer.run<{ width: number; height: number; removed: boolean; paintsAfterUnmount: number }>(`
      document.getElementById('field').style.width='320px';
      await new Promise(resolve => setTimeout(resolve, 160));
      const sample = window.fieldSample();
      let paints = 0;
      const context = document.querySelector('canvas').getContext('2d');
      const clear = context.clearRect.bind(context);
      context.clearRect = (...args) => { paints++; clear(...args); };
      window.unmountField();
      await new Promise(resolve => setTimeout(resolve, 160));
      return {width:sample.width,height:sample.height,removed:!document.querySelector('canvas'),paintsAfterUnmount:paints};
    `, { dpr: 3 })
    expect(result.width).toBe(640)
    expect(result.height).toBeGreaterThan(0)
    expect(result.removed).toBe(true)
    expect(result.paintsAfterUnmount).toBe(0)
  }, 30_000)
})
