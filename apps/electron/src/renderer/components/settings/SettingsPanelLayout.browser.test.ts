import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai';
    import {SettingsPanel} from '@/components/settings/SettingsPanel';
    import {settingsTabAtom} from '@/atoms/settings-tab';
    import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from '@gamma/shared';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import '@/styles/globals.css';
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.addEventListener('error',event=>{window.settingsError=event.error?.stack??event.message});
    window.settingsLayout=async theme=>{
      document.documentElement.className='gamma-main-window '+theme;
      const host=document.getElementById('root');host.style.width='760px';host.style.height='360px';
      window.electronAPI={getSettings:async()=>({markdownEditor:DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),updateSettings:async updates=>updates};
      const store=createStore();store.set(settingsTabAtom,'markdown-editor');
      const root=createRoot(host);root.render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(SettingsPanel))));
      await wait(250);
      const navPanel=document.querySelector('[data-panel="settings-nav"]'),content=document.querySelector('[data-panel="settings-content"]');
      if(!navPanel||!content)throw new Error(window.settingsError??'设置面板未挂载');
      const nav=navPanel.querySelector('nav'),rows=[...nav.querySelectorAll('button')],last=rows.at(-1);
      const heights=rows.map(row=>row.getBoundingClientRect().height),a=navPanel.getBoundingClientRect(),b=content.getBoundingClientRect();
      last.focus();await wait(50);
      const viewport=content.querySelector('[data-radix-scroll-area-viewport]');viewport.scrollTop=100;
      const result={heights,gap:b.left-a.right,padding:getComputedStyle(content).padding,radius:getComputedStyle(content).borderRadius,navScrolls:nav.scrollTop>0,focused:document.activeElement===last,focusVisible:last.getBoundingClientRect().bottom<=nav.getBoundingClientRect().bottom+1,contentScrolls:viewport.scrollTop>0,fits:host.scrollWidth<=host.clientWidth,documentStill:document.documentElement.scrollTop===0};
      root.unmount();return result;
    };
  `)
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实设置面板的短窗口布局', () => {
  test('When 在亮暗主题中滚动到末尾导航并聚焦 Then 行高34px、面板间隔8px且两侧独立滚动', async () => {
    for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
      const result = await renderer.run<{ heights: number[]; gap: number; padding: string; radius: string; navScrolls: boolean; focused: boolean; focusVisible: boolean; contentScrolls: boolean; fits: boolean; documentStill: boolean }>(`return window.settingsLayout(${JSON.stringify(theme)});`)
      expect(result.heights.length).toBeGreaterThan(10)
      for (const height of result.heights) expect(height).toBe(34)
      expect(result.gap).toBe(8)
      expect(result.padding).toBe('16px')
      expect(result.radius).toBe('12px')
      expect(result.navScrolls).toBe(true)
      expect(result.focused).toBe(true)
      expect(result.focusVisible).toBe(true)
      expect(result.contentScrolls).toBe(true)
      expect(result.fits).toBe(true)
      expect(result.documentStill).toBe(true)
    }
  }, 30_000)
})
