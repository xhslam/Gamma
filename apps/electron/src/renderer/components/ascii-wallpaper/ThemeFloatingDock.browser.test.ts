import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { THEME_STYLES } from '../../../types'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import '@/styles/globals.css';
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {getDefaultStore} from 'jotai';
    import {applyThemeToDOM, chatWallpaperAtom, resolvedThemeAtom, themeModeAtom} from '@/atoms/theme';
    import {ThemeFloatingDock, ThemeDockTrigger} from '@/components/ascii-wallpaper/ThemeFloatingDock';
    import {ChatWallpaper} from '@/components/ascii-wallpaper/AsciiWallpaperCanvas';
    import {createAsciiWallpaperEngine} from '@/components/ascii-wallpaper/engines';
    import {Panel} from '@/components/app-shell/Panel';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import {RichTextInput} from '@/components/ai-elements/rich-text-input';
    const h=React.createElement, store=getDefaultStore();
    let sent=0, commands=0;
    window.electronAPI={updateSettings:async updates=>{
      const next={...JSON.parse(localStorage.getItem('fixture-settings') ?? '{"themeMode":"light"}'),...updates};
      localStorage.setItem('fixture-settings',JSON.stringify(next)); return next;
    }, getWorkspaceCapabilities:async()=>({skills:[]}),onVoiceDictationToggleForInput:()=>()=>{}};
    store.set(chatWallpaperAtom,JSON.parse(localStorage.getItem('fixture-settings') ?? '{}').chatWallpaper ?? 'default');
    store.set(themeModeAtom,'light');
    function Fixture({width}) {
      const [open,setOpen]=React.useState(false), [reveal,setReveal]=React.useState(null), [draft,setDraft]=React.useState('');
      const done=React.useCallback(()=>setReveal(null),[]);
      React.useLayoutEffect(()=>{
        const apply=()=>applyThemeToDOM('light',false,store.get(chatWallpaperAtom));
        apply();
        return store.sub(chatWallpaperAtom,apply);
      },[]);
      return h('div',{className:'gamma-workbench flex'},h('div',{className:'gamma-workbench-frame'},
        h('nav',{'data-sidebar-region':'navigation'},
          h('aside',{className:'gamma-panel','data-panel':'sidebar'},
            h('header',{className:'gamma-topbar gamma-sidebar-topbar',id:'sidebar-topbar'},'Gamma'))),
        h('div',{'data-workspace-pane':'agent',className:'relative z-[60] flex min-h-0 min-w-0 flex-col overflow-hidden',style:{width,height:540}},
          h(Panel,null,h('article',{'data-agent-conversation-root':'',className:'relative isolate flex h-full flex-col overflow-hidden'},
            h(ChatWallpaper,{reveal,onRevealComplete:done}),
            h('header',{className:'gamma-topbar'},'聊天'),
            h('div',{className:'flex-1',id:'transcript'},'一条历史消息'),
            h(ThemeFloatingDock,{open,onOpenChange:setOpen,onCloseAutoFocus:()=>{},onSelect:(style,point,previousStyle)=>{if(point && style!=='default')setReveal({style,point,previousStyle});setOpen(false)}},
              h('div',{style:{height:80}},h(RichTextInput,{value:draft,onChange:setDraft,onSubmit:()=>sent++,workspaceSlug:'demo',enableMentions:true,
                onLocalCommand:text=>{if(text.trim()!=='/theme')return false;commands++;setDraft('');setOpen(true);return true}
              }),h(ThemeDockTrigger))
            )
          ))
        ),
        h('section',{id:'terminal',className:'flex-1 bg-background',tabIndex:0},'终端工作台')
      ));
    }
    const root=createRoot(document.getElementById('root'));
    window.fixture={
      createMoonPainter:()=>{
        const canvas=document.createElement('canvas');
        canvas.width=640;canvas.height=360;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        const engine=createAsciiWallpaperEngine('moonlit');
        engine.init(ctx,canvas.width,canvas.height);
        return (time,still)=>{
          engine.paint(time,still);
          return ctx.getImageData(415,40,84,76).data;
        };
      },
      mount:width=>root.render(h(TooltipProvider,null,h(Fixture,{width}))),
      until:async check=>{for(let i=0;i<180;i++){const result=check();if(result)return result;await new Promise(r=>setTimeout(r,15))}throw Error('条件未满足 '+JSON.stringify({sent,commands,text:document.body.innerText,edit:document.querySelector('[contenteditable]')?.innerHTML,dock:document.querySelector('[role=dialog]')?.getBoundingClientRect().toJSON()}))},
      sendKey:(el,key,attrs={})=>el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...attrs})),
      counters:()=>({sent,commands}),
      theme:()=>store.get(resolvedThemeAtom),
      resetWallpaper:()=>store.set(chatWallpaperAtom,'default'),
    };
  `)
}, 60_000)

afterAll(async () => { await renderer?.dispose() })

describe('聊天壁纸', () => {
  test('Given 位置固定的月亮 When 重绘场景 Then 字符独立亮灭且静止模式的画面不变', async () => {
    const result = await renderer.run<{ blinking: number; mixed: boolean; still: boolean }>(`
      const paint=window.fixture.createMoonPainter();
      const reference=paint(0,true);
      const frames=Array.from({length:21},(_,i)=>paint(i*180,false));
      const symbols=[];
      for(let i=0;i<reference.length;i+=4) if(reference[i]>100) symbols.push(i);
      const blinking=symbols.filter(i=>frames.some(f=>f[i]<36)&&frames.some(f=>f[i]>100)).length;
      const mixed=frames.some(f=>symbols.some(i=>f[i]<36)&&symbols.some(i=>f[i]>100));
      return {blinking,mixed,still:paint(1590,true).every((value,i)=>value===reference[i])};
    `)
    expect(result.blinking).toBeGreaterThan(20)
    expect(result.mixed).toBe(true)
    expect(result.still).toBe(true)
  }, 30_000)

  test('Given 八套场景 When 在同一窗口切换 Then 侧栏和顶栏各有八种配色且云朵使用浅色文字体系', async () => {
    const styles = THEME_STYLES.filter(style => style !== 'default')
    const colors = await renderer.run<{ scene: string; sidebar: string; topbar: string; mode: string }[]>(`
      const f=window.fixture; f.mount(760);
      const trigger=await f.until(()=>document.querySelector('[aria-label="选择场景主题"]'));
      const sidebar=document.querySelector('[data-panel="sidebar"]');
      const topbar=document.querySelector('#sidebar-topbar');
      const colors=[];
      for (const scene of ${JSON.stringify(styles)}) {
        trigger.click();
        (await f.until(()=>document.querySelector('[data-wallpaper-choice="'+scene+'"]'))).click();
        await f.until(()=>document.documentElement.dataset.sceneTheme===scene&&!document.querySelector('[data-wallpaper-reveal]')&&!document.querySelector('[role="dialog"]'));
        colors.push({scene,sidebar:getComputedStyle(sidebar).backgroundColor,topbar:getComputedStyle(topbar).backgroundColor,mode:f.theme()});
      }
      return colors;
    `)
    expect(colors.map(({ scene, mode }) => [scene, mode])).toEqual(styles.map(scene => [scene, scene === 'cloud-drift' ? 'light' : 'dark']))
    expect(new Set(colors.map(({ sidebar }) => sidebar)).size).toBe(styles.length)
    expect(new Set(colors.map(({ topbar }) => topbar)).size).toBe(styles.length)
    expect(colors.every(({ sidebar, topbar }) => sidebar !== topbar)).toBe(true)
  }, 30_000)

  test('Given 窄聊天栏和分屏终端 When 选择碧海绿龟 Then 画布贴边、侧栏与终端同步切换深色配色', async () => {
    const result = await renderer.run<{
      width: number; bounds: boolean; transcript: string; terminal: boolean; loaded: boolean; base: string
      sidebar: string; topbar: string; tint: boolean; theme: string
    }>(`
      localStorage.removeItem('fixture-settings');
      const f=window.fixture; f.resetWallpaper(); f.mount(340);
      const trigger=await f.until(()=>document.querySelector('[aria-label="选择场景主题"]'));
      const terminal=document.getElementById('terminal');
      const terminalColor=getComputedStyle(terminal).backgroundColor;
      trigger.click();
      const first=await f.until(()=>document.querySelector('[data-wallpaper-choice]'));
      const buttons=[...document.querySelectorAll('[data-wallpaper-choice]')];
      const loaded=await f.until(()=>buttons.every(b=>b.querySelector('img').naturalWidth>0));
      const dock=first.closest('[role="dialog"]');
      await f.until(()=>dock.getAnimations().length===0 && dock.getBoundingClientRect().width>280);
      const width=Math.round(dock.getBoundingClientRect().width);
      first.focus({preventScroll:true}); f.sendKey(first,'ArrowRight'); f.sendKey(document.activeElement,'ArrowRight');
      document.activeElement.click();
      await f.until(()=>document.querySelector('[data-wallpaper-scene="honu-lagoon"]'));
      await f.until(()=>!document.querySelector('[data-wallpaper-reveal]'));
      const settled=document.querySelector('[data-wallpaper-scene="honu-lagoon"]');
      const box=settled.getBoundingClientRect(), pane=document.querySelector('[data-workspace-pane="agent"]').getBoundingClientRect();
      if(box.left!==pane.left||box.right!==pane.right||box.bottom!==pane.bottom) throw Error(JSON.stringify({box,pane,css:getComputedStyle(document.querySelector('[data-panel=content]')).padding}));
      return {
        width,bounds:box.left===pane.left&&box.right===pane.right&&box.bottom===pane.bottom,
        transcript:document.getElementById('transcript').textContent,
        terminal:getComputedStyle(terminal).backgroundColor!==terminalColor,loaded,
        base:JSON.parse(localStorage.getItem('fixture-settings')).themeMode,
        sidebar:getComputedStyle(document.querySelector('[data-panel="sidebar"]')).backgroundColor,
        topbar:getComputedStyle(document.querySelector('#sidebar-topbar')).backgroundColor,
        tint:getComputedStyle(document.querySelector('[data-sidebar-region="navigation"]')).backgroundImage.includes('radial-gradient'),
        theme:f.theme()
      };
    `)
    expect(result).toEqual({
      width: 308, bounds: true, transcript: '一条历史消息', terminal: true, loaded: true, base: 'light',
      sidebar: 'rgba(26, 94, 87, 0.68)', topbar: 'rgba(47, 117, 108, 0.62)', tint: true, theme: 'dark',
    })
  }, 30_000)

  test('Given 选择器已打开 When 在别的控件使用方向键与回车 Then 不拦截按键或应用壁纸', async () => {
    const result = await renderer.run<{ left: boolean; enter: boolean; closed: boolean }>(`
      const f=window.fixture; f.mount(760);
      const trigger=await f.until(()=>document.querySelector('[aria-label="选择场景主题"]'));trigger.click();
      const first=await f.until(()=>document.querySelector('[data-wallpaper-choice]'));
      const terminal=document.getElementById('terminal');
      const left=f.sendKey(terminal,'ArrowLeft'), enter=f.sendKey(terminal,'Enter');
      first.focus();f.sendKey(first,'Escape');
      const closed=await f.until(()=>!document.querySelector('[role="dialog"]'));
      return {left,enter,closed};
    `)
    expect(result).toEqual({ left: true, enter: true, closed: true })
  }, 30_000)

  test('Given 已启用场景主题 When 关闭主题并重新加载 Then 画布移除且恢复原来的浅色配色', async () => {
    const result = await renderer.run<{ before: boolean; after: boolean }>(`
      const f=window.fixture; f.mount(520);
      const trigger=await f.until(()=>document.querySelector('[aria-label="选择场景主题"]'));
      trigger.click();(await f.until(()=>document.querySelector('[data-wallpaper-choice="moonlit"]'))).click();
      await f.until(()=>document.querySelector('[data-wallpaper-scene="moonlit"]')&&!document.querySelector('[role="dialog"]'));
      trigger.click();(await f.until(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='关闭场景主题'))).click();
      return await f.until(()=>!document.querySelector('[data-wallpaper-scene]')&&!document.documentElement.dataset.sceneTheme&&f.theme()==='light'&&JSON.parse(localStorage.getItem('fixture-settings')).chatWallpaper==='default');
    `, `
      const f=window.fixture; f.mount(520);
      await f.until(()=>document.querySelector('#transcript'));
      return !document.querySelector('[data-wallpaper-scene]')&&!document.documentElement.dataset.sceneTheme&&f.theme()==='light'
        &&getComputedStyle(document.querySelector('[data-sidebar-region="navigation"]')).backgroundImage==='none'
        &&getComputedStyle(document.querySelector('[data-panel="sidebar"]')).backgroundColor.startsWith('rgb(');
    `)
    expect(result).toEqual({ before: true, after: true })
  }, 30_000)

  test('Given 聊天输入框启用 Skill 建议 When 键入独立 /theme 并回车 Then 打开壁纸而不发送消息', async () => {
    const result = await renderer.run<{ sent: number; commands: number; wrapped: number }>(`
      const f=window.fixture; f.mount(760);
      const editor=await f.until(()=>document.querySelector('.tiptap')?.editor && document.querySelector('.tiptap'));
      editor.editor.commands.focus();editor.editor.commands.insertContent('/theme');
      f.sendKey(editor,'Enter',{isComposing:true});
      if(f.counters().commands) throw Error('IME 被当作发送');
      f.sendKey(editor,'Enter');
      if(!f.counters().commands) throw Error(JSON.stringify({state:editor.editor.state.doc.toJSON(),counters:f.counters()}));
      const first=await f.until(()=>document.querySelector('[data-wallpaper-choice]'));
      await f.until(()=>first.closest('[role="dialog"]').getBoundingClientRect().width>690);
      const wrapped=new Set([...document.querySelectorAll('[data-wallpaper-choice]')].map(e=>e.offsetTop)).size;
      return {...f.counters(),wrapped};
    `)
    expect(result).toEqual({ sent: 0, commands: 1, wrapped: 1 })
  }, 30_000)
})
