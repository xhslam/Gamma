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
    import {settingsTabAtom,channelFormDirtyAtom} from '@/atoms/settings-tab';
    import {DEFAULT_MARKDOWN_EDITOR_PREFERENCES} from '@gamma/shared';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import '@/styles/globals.css';
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.mountSettings=async (theme, tab='markdown-editor')=>{
      document.documentElement.className='gamma-main-window '+theme;
      const host=document.getElementById('root');host.style.width='760px';host.style.height='400px';
      let closeCalls=0, requestClose, navigate;
      window.electronAPI={
        getSettings:async()=>({markdownEditor:DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),
        updateSettings:async updates=>updates,
        listChannels:async()=>[],
        onSettingsWindowCloseRequested: callback=>{requestClose=callback;return ()=>{}},
        onSettingsWindowNavigate: callback=>{navigate=callback;return ()=>{}}
      };
      const store=createStore();store.set(settingsTabAtom,tab);
      const root=createRoot(host);
      root.render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(SettingsPanel,{onClose:()=>closeCalls++}))));
      await wait(250);
      const nav=document.querySelector('nav[aria-label="设置分类"]');
      const rows=[...nav.querySelectorAll('button')];
      const content=document.querySelector('[data-panel="settings-content"]');
      return { root,host,nav,rows,content,wait,requestClose:()=>requestClose(),navigate:tab=>navigate(tab),closeCalls:()=>closeCalls,tab:()=>store.get(settingsTabAtom),dirty:()=>store.set(channelFormDirtyAtom,true) };
    };
  `)
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given VMark 式独立设置内容', () => {
  test('When 使用深浅主题 Then 两栏共用一条边界且设置内容独立滚动', async () => {
    for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
      const result = await renderer.run(`
        const {root,host,nav,rows,content,wait}=await window.mountSettings(${JSON.stringify(theme)});
        const panel=nav.closest('aside'),a=panel.getBoundingClientRect(),b=content.getBoundingClientRect();
        const viewport=content.querySelector('[data-radix-scroll-area-viewport]');viewport.scrollTop=100;
        rows.at(-1).focus();await wait(30);
        const result={labels:rows.map(row=>row.textContent.trim()),width:a.width,gap:b.left-a.right,search:!!panel.querySelector('input[type=search]'),focus:document.activeElement===rows.at(-1),scrolls:viewport.scrollTop>0,fits:host.scrollWidth<=host.clientWidth};
        root.unmount();return result;
      `)
      expect(result).toEqual({
        labels: ['通用设置', '模型配置', '长期记忆', '外观设置', '文档设置', '快捷键管理', '磁盘管理', '关于/更新'],
        width: 208, gap: 0, search: true, focus: true, scrolls: true, fits: true,
      })
    }
  }, 30_000)

  test('When 窗口收到关闭或跳转请求且渠道未保存 Then 要求确认', async () => {
    const result = await renderer.run(`
      const f=await window.mountSettings('dark','channels');
      const button=label=>[...document.querySelectorAll('[role=alertdialog] button')].find(item=>item.textContent===label);
      f.dirty();await f.wait(40);
      f.requestClose();await f.wait(70);
      const prompted=!!button('留在当前页'), before=f.closeCalls();
      button('留在当前页').click();await f.wait(80);
      f.navigate('appearance');await f.wait(80);
      const guarded=f.tab()==='channels'&&!!button('放弃并离开');
      button('放弃并离开').click();await f.wait(110);
      const tab=f.tab();
      f.requestClose();await f.wait(45);
      const closed=f.closeCalls();
      f.root.unmount();
      return {prompted,before,guarded,tab,closed};
    `)
    expect(result).toEqual({ prompted: true, before: 0, guarded: true, tab: 'appearance', closed: 1 })
  }, 30_000)
})
