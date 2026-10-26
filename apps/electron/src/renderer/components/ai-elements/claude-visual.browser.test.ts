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
    import { Button } from '@/components/ui/button';
    import { inputToolbarSendButtonClass, inputToolbarDisabledButtonClass } from '@/components/ai-elements/input-toolbar-styles';
    import '@fontsource-variable/inter/index.css';
    import '@/styles/globals.css';
    let disabledClicks = 0;
    flushSync(() => createRoot(document.getElementById('root')).render(
      React.createElement('main', {style:{padding:32,maxWidth:780}},
        React.createElement('header', {className:'gamma-ui',style:{display:'flex',alignItems:'center',gap:16,marginBottom:32}},
          React.createElement('h1', {className:'font-semibold',style:{fontSize:24}}, 'Gamma · 当前会话'),
          React.createElement('span', {id:'medium',className:'font-medium'}, '进行中的探索'),
          React.createElement('span', {id:'bold',className:'font-bold'}, '重点')),
        React.createElement('div', {className:'message-item is-user',style:{marginBottom:24}},
          React.createElement('div', {id:'bubble',className:'relative inline-block rounded-[10px] bg-primary/10 px-3.5 py-2.5'}, '中文与 English 消息')),
        React.createElement('div', {'data-input-mode':'agent'},
          React.createElement('div', {id:'composer',className:'rounded-[17px] border-[0.5px] border-border',style:{padding:16}},
            React.createElement('textarea', {id:'editor','aria-label':'输入消息',placeholder:'向 Gamma 提问…',style:{display:'block',width:'100%',height:80,background:'transparent',outline:'none',resize:'none'}}),
            React.createElement('div', {style:{display:'flex',justifyContent:'end',gap:8}},
              React.createElement(Button, {id:'disabled',variant:'ghost',disabled:true,className:inputToolbarDisabledButtonClass,onClick:()=>disabledClicks++}, '×'),
              React.createElement(Button, {id:'send',variant:'ghost',className:inputToolbarSendButtonClass}, '↑')))),
        React.createElement('div', {className:'gamma-ui',style:{display:'flex',alignItems:'center',gap:8,marginTop:24}},
          React.createElement('span', {id:'count',className:'ui-numeric tabular-nums'}, '111'),
          React.createElement(Button, {id:'adjacent',variant:'outline'}, '详情')),
        React.createElement('pre', {id:'code',style:{fontFamily:'monospace',marginTop:24}}, 'const tokens = 12345'),
        React.createElement('article', {className:'prose dark:prose-invert'}, React.createElement('strong', {id:'markdown'}, '用户 Markdown 粗体')),
        React.createElement('div', {id:'terminal',className:'xterm',style:{fontFamily:'monospace',fontWeight:600}}, '终端 $ echo Gamma'))));
    window.disabledClicks = () => disabledClicks;
    window.setTheme = theme => { document.documentElement.className = theme; };
    window.visual = async () => {
      await document.fonts.ready;
      await new Promise(resolve => setTimeout(resolve, 220));
      const style = id => getComputedStyle(document.getElementById(id));
      const root = getComputedStyle(document.documentElement);
      return { dpr:devicePixelRatio, hairline:root.getPropertyValue('--hairline-width').trim(),
        primary:root.getPropertyValue('--primary').trim(), surface:root.getPropertyValue('--surface-2').trim(),
        inputBackground:style('composer').backgroundColor, inputRadius:style('composer').borderRadius,
        inputBorder:style('composer').borderTopWidth, shadow:style('composer').boxShadow,
        bubbleRadius:style('bubble').borderRadius, buttonRadius:style('send').borderRadius,
        medium:style('medium').fontVariationSettings, semibold:document.querySelector('h1') && getComputedStyle(document.querySelector('h1')).fontVariationSettings,
        bold:style('bold').fontVariationSettings, code:style('code').fontVariationSettings,
        terminal:style('terminal').fontVariationSettings, markdown:style('markdown').fontVariationSettings,
        duration:style('send').transitionDuration, inputDuration:style('composer').transitionDuration,
        reduced:matchMedia('(prefers-reduced-motion: reduce)').matches };
    };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

interface VisualResult {
  dpr: number
  hairline: string
  primary: string
  surface: string
  inputBackground: string
  inputRadius: string
  inputBorder: string
  shadow: string
  bubbleRadius: string
  buttonRadius: string
  medium: string
  semibold: string
  bold: string
  code: string
  terminal: string
  markdown: string
  duration: string
  inputDuration: string
  reduced: boolean
}

describe('Given 真实 Chromium 渲染的会话 UI', () => {
  for (const dpr of [1, 2, 3]) {
    test(`When DPR=${dpr} Then 阴影轮廓保持一个物理像素且布局 border 不重复`, async () => {
      const result = await renderer.run<VisualResult>('return window.visual()', { dpr })
      expect(result.dpr).toBeCloseTo(dpr, 1)
      expect(result.inputBorder).toBe('0px')
      expect(result.shadow).toContain(`0px 0px 0px ${dpr === 1 ? '1' : dpr === 2 ? '0.5' : '0.333333'}px`)
      expect(result.inputRadius).toBe('20px')
      expect(result.bubbleRadius).toBe('18px')
      expect(result.buttonRadius).toBe('8px')
    }, 30_000)
  }
  for (const dark of [false, true]) {
    test(`When 使用默认${dark ? '深' : '浅'}色 Then 主题暖色、字重补偿且代码 Markdown 终端不受影响`, async () => {
      const result = await renderer.run<VisualResult>(`window.setTheme('${dark ? 'dark' : ''}'); return window.visual()`, {
        screenshot: artifacts ? join(artifacts, `claude-${dark ? 'dark' : 'light'}.png`) : undefined,
      })
      expect(result.primary).toBe('14.76923077 63.10679612% 59.60784314%')
      expect(result.medium).toBe(`"wght" ${dark ? 465 : 500}`)
      expect(result.semibold).toBe(`"wght" ${dark ? 560 : 600}`)
      expect(result.bold).toBe(`"wght" ${dark ? 660 : 700}`)
      expect(result.code).toBe('normal')
      expect(result.terminal).toBe('normal')
      expect(result.markdown).toBe('normal')
    }, 30_000)
  }
  for (const theme of ['theme-ocean-light', 'dark theme-ocean-dark', 'theme-forest-light', 'dark theme-forest-dark', 'theme-slate-light', 'dark theme-slate-dark', 'dark theme-terminal-dark']) {
    test(`When 选择历史主题 ${theme} Then 使用统一暖色强调色并保留控件几何`, async () => {
      const result = await renderer.run<VisualResult>(`window.setTheme(${JSON.stringify(theme)}); return window.visual()`)
      expect(result.primary).toBe('14.76923077 63.10679612% 59.60784314%')
      if (theme.includes('terminal')) {
        expect(result.inputRadius).toBe('0px')
        expect(result.medium).toBe('normal')
      } else {
        expect(result.inputRadius).toBe('20px')
      }
    }, 30_000)
  }
  test('When 输入框 hover/focus Then 细轮廓反馈仍清晰且不增加模糊阴影', async () => {
    const resting = await renderer.run<VisualResult>('return window.visual()')
    const hovering = await renderer.run<VisualResult>('return window.visual()', { hoverSelector: '#composer' })
    const focused = await renderer.run<VisualResult>("document.getElementById('editor').focus(); return window.visual()")
    expect(hovering.shadow).not.toBe(resting.shadow)
    expect(focused.shadow).not.toBe(resting.shadow)
    expect(focused.shadow).toContain('inset')
    expect(focused.inputBorder).toBe('0px')
  }, 30_000)
  test('When 使用 disabled 按钮或键盘聚焦图标按钮 Then 禁用不响应且可见焦点保留', async () => {
    const result = await renderer.run<{ clicks: number; disabled: boolean; ring: string }>(`
      document.getElementById('disabled').click();
      const button = document.getElementById('send'); button.focus();
      await new Promise(resolve => setTimeout(resolve, 200));
      return { clicks:window.disabledClicks(), disabled:document.getElementById('disabled').disabled, ring:getComputedStyle(button).boxShadow };
    `, { keyboard: true })
    expect(result.clicks).toBe(0)
    expect(result.disabled).toBe(true)
    expect(result.ring).not.toBe('none')
  }, 30_000)
  test('When 开启 reduced-motion Then 输入和控件停止过渡', async () => {
    const result = await renderer.run<VisualResult>('return window.visual()', { reducedMotion: true })
    expect(result.reduced).toBe(true)
    expect(result.duration).toBe('0s')
    expect(result.inputDuration).toBe('0s')
  }, 30_000)
  test('When 计数增长、倒计时或空状态 Then 三位内数字不移动相邻按钮、极大值仍可读', async () => {
    const result = await renderer.run<{ positions: number[]; widths: number[]; variant: string; largeVisible: boolean }>(`
      await document.fonts.ready;
      const count = document.getElementById('count'), adjacent = document.getElementById('adjacent');
      const positions = [], widths = [];
      for (const value of ['111', '888', '999', '10', '9', '0', '']) {
        count.textContent = value;
        positions.push(adjacent.getBoundingClientRect().left);
        widths.push(count.getBoundingClientRect().width);
      }
      count.textContent = '999999999999';
      return { positions, widths, variant:getComputedStyle(count).fontVariantNumeric,
        largeVisible:count.scrollWidth <= count.clientWidth && count.getBoundingClientRect().right <= adjacent.getBoundingClientRect().left };
    `)
    expect(new Set(result.positions).size).toBe(1)
    expect(new Set(result.widths).size).toBe(1)
    expect(result.variant).toBe('tabular-nums')
    expect(result.largeVisible).toBe(true)
  }, 30_000)
  test('When 默认深浅主题使用窗口、面板与下沉层 Then 精确使用既定色板且浮层为实体1px描边', async () => {
    const result = await renderer.run<{ palettes: string[][]; border: string; shadow: string }>(`
      const palettes = [];
      for (const theme of ['', 'dark']) {
        window.setTheme(theme);
        const colors = [];
        for (const token of ['background','panel','inset']) {
          const sample = document.createElement('div'); sample.style.background = 'hsl(var(--' + token + '))';
          document.body.append(sample); colors.push(getComputedStyle(sample).backgroundColor); sample.remove();
        }
        palettes.push(colors);
      }
      const floating = document.createElement('div'); floating.className = 'gamma-panel ui-floating-surface rounded-dialog'; floating.dataset.panel='floating'; document.body.append(floating);
      return { palettes, border:getComputedStyle(floating).borderTopWidth, shadow:getComputedStyle(floating).boxShadow };
    `, { dpr: 2 })
    expect(result.palettes).toEqual([
      ['rgb(250, 249, 245)', 'rgb(255, 255, 255)', 'rgb(240, 238, 230)'],
      ['rgb(31, 30, 29)', 'rgb(38, 38, 36)', 'rgb(48, 48, 46)'],
    ])
    expect(result.border).toBe('1px')
    expect(result.shadow).toBe('none')
  }, 30_000)
  test('When 普通字体回退或使用行内图标 Then 字重有静态回退且 flex 图标不偏移', async () => {
    const result = await renderer.run<{ fallback: string; weight: string; baseline: string; flexAlign: string }>(`
      window.setTheme('dark');
      const label = document.getElementById('medium'); label.style.fontFamily = 'Arial';
      const icon = document.createElement('span'); icon.className = 'ui-inline-icon'; icon.textContent = '↗'; label.append(icon);
      return { fallback:getComputedStyle(label).fontFamily, weight:getComputedStyle(label).fontWeight,
        baseline:getComputedStyle(icon).verticalAlign, flexAlign:getComputedStyle(document.getElementById('send')).alignItems };
    `)
    expect(result.fallback).toBe('Arial')
    expect(result.weight).toBe('500')
    expect(parseFloat(result.baseline)).toBeLessThan(0)
    expect(result.flexAlign).toBe('center')
  }, 30_000)
  test('When 计划模式或拖入文件 Then 保留单一虚线轮廓和拖放边框', async () => {
    const result = await renderer.run<{ planShadow: string; dragBorder: string; dragStyle: string }>(`
      const composer = document.getElementById('composer');
      composer.classList.add('plan-mode-border');
      await window.visual();
      const planShadow = getComputedStyle(composer).boxShadow;
      composer.classList.remove('plan-mode-border'); composer.classList.add('border-dashed', 'border-[2px]');
      return { planShadow, dragBorder:getComputedStyle(composer).borderTopWidth, dragStyle:getComputedStyle(composer).borderTopStyle };
    `)
    expect(result.planShadow).not.toContain('inset')
    expect(result.dragBorder).toBe('2px')
    expect(result.dragStyle).toBe('dashed')
  }, 30_000)
  for (const zoom of [1, 1.25, 1.5]) {
    test(`When 页面缩放 ${zoom * 100}% Then 输入仍在窄窗口内且可编辑`, async () => {
      const result = await renderer.run<{ inside: boolean; focused: boolean }>(`
        const input = document.getElementById('editor'); input.focus(); input.value = '未发送中文草稿';
        const rect = document.getElementById('composer').getBoundingClientRect();
        return { inside:rect.right <= innerWidth && rect.left >= 0, focused:document.activeElement === input && input.value === '未发送中文草稿' };
      `, { zoom })
      expect(result).toEqual({ inside: true, focused: true })
    }, 30_000)
  }
})
