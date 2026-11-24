import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider, createStore, useAtomValue } from 'jotai';
    import { TooltipProvider } from '@/components/ui/tooltip';
    import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
    import { applyThemeToDOM, chatWallpaperAtom, customThemeAtom, themeModeAtom } from '@/atoms/theme';
    import '@/styles/globals.css';
    const delay=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await delay(10)}throw new Error('外观设置未达到预期状态：'+JSON.stringify(window.activeAppearance?.writes)+' '+document.body.innerText)};
    window.mountAppearance=async()=>{
      let settings={themeMode:'light',themeStyle:'default',chatWallpaper:'default',customTheme:{accent:'#458588',background:'#282828',foreground:'#EBDBB2'}};
      const writes=[];
      window.electronAPI={
        getSettings:async()=>settings,
        updateSettings:async update=>{writes.push(update);settings={...settings,...update};return settings},
      };
      const root=createRoot(document.getElementById('root'));
      function Fixture(){
        const mode=useAtomValue(themeModeAtom),wallpaper=useAtomValue(chatWallpaperAtom),colors=useAtomValue(customThemeAtom);
        React.useLayoutEffect(()=>applyThemeToDOM(mode,false,wallpaper,colors),[mode,wallpaper,colors]);
        return React.createElement(React.Fragment,null,
          React.createElement('div',{'data-theme-probe':true,className:'bg-background'}),
          React.createElement(AppearanceSettings));
      }
      root.render(React.createElement(Provider,{store:createStore()},React.createElement(TooltipProvider,null,React.createElement(Fixture))));
      await until(()=>document.body.textContent.includes('跟随系统'));
      return {root,writes,delay,until};
    };
  `)
}, 240_000)

afterAll(async () => { await renderer?.dispose() })

describe('Given Carpus 外观设置', () => {
  test('When 选择自定义并编辑颜色 Then 保存三项颜色、实时应用令牌且非法输入不落盘', async () => {
    const result = await renderer.run<{
      options: string[]
      background: string
      dark: boolean
      accent: string
      writes: unknown[]
      invalidBlocked: boolean
      restored: string
    }>(`
      const f=await window.mountAppearance();window.activeAppearance=f;
      const options=['跟随系统','浅色','深色','自定义'];
      const modeOptions=[...document.querySelectorAll('button')].filter(node=>options.includes(node.textContent)).map(node=>node.textContent);
      [...document.querySelectorAll('button')].find(node=>node.textContent==='自定义').click();
      await f.until(()=>document.querySelector('[data-custom-theme-settings]'));
      const background=getComputedStyle(document.querySelector('[data-theme-probe]')).backgroundColor;
      const dark=document.documentElement.classList.contains('dark');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      const accent=document.querySelector('[aria-label="强调色十六进制色值"]');
      accent.focus();setter.call(accent,'#A1B2C3');accent.dispatchEvent(new Event('input',{bubbles:true}));accent.dispatchEvent(new Event('change',{bubbles:true}));await f.delay(30);accent.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
      await f.until(()=>f.writes.length===2&&document.documentElement.style.getPropertyValue('--color-accent')==='#A1B2C3'&&!document.querySelector('[data-custom-theme-settings] fieldset').disabled);
      const accentValue=document.documentElement.style.getPropertyValue('--color-accent');
      accent.focus();setter.call(accent,'red');accent.dispatchEvent(new Event('input',{bubbles:true}));accent.dispatchEvent(new Event('change',{bubbles:true}));await f.delay(30);accent.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await f.delay(50);
      const invalidBlocked=f.writes.length===2&&document.body.textContent.includes('请输入 6 位十六进制颜色');
      [...document.querySelectorAll('button')].find(node=>node.textContent==='恢复默认').click();
      await f.until(()=>f.writes.length===3&&document.documentElement.style.getPropertyValue('--color-accent')==='#458588');
      const restored=document.documentElement.style.getPropertyValue('--color-accent');
      const result={options:modeOptions,background,dark,accent:accentValue,writes:f.writes,invalidBlocked,restored};
      f.root.unmount();return result;
    `)

    expect(result).toEqual({
      options: ['跟随系统', '浅色', '深色', '自定义'],
      background: 'rgb(40, 40, 40)',
      dark: true,
      accent: '#A1B2C3',
      writes: [
        { themeMode: 'custom' },
        { customTheme: { accent: '#A1B2C3', background: '#282828', foreground: '#EBDBB2' } },
        { customTheme: { accent: '#458588', background: '#282828', foreground: '#EBDBB2' } },
      ],
      invalidBlocked: true,
      restored: '#458588',
    })
  }, 30_000)
})
