import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
let reducedMotionRenderer: ElectronRendererHarness
const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {flushSync} from 'react-dom';
  import {Provider,createStore} from 'jotai';
  import {SidebarTransition} from '@/components/app-shell/SidebarTransition';
  import {WorkspacePanels} from '@/components/app-shell/WorkspacePanels';
  import {BrowserSlot} from '@/components/browser/BrowserSlot';
  import '@/styles/globals.css';
  const root=createRoot(document.getElementById('root')),store=createStore(),calls=[];
  window.electronAPI={setAgentBrowserLayout:async input=>calls.push(input)};
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await frame()}throw new Error('侧栏动画未达到预期状态')};
  const mounts={count:0};
  function Draft(){React.useEffect(()=>{mounts.count++},[]);return React.createElement('input',{'aria-label':'保留草稿',defaultValue:'终端历史与草稿'})}
  let options={collapsed:true,width:300,resizing:false,region:'workspace',revision:0};
  const render=changes=>{options={...options,...changes};flushSync(()=>root.render(React.createElement(Provider,{store},
    React.createElement('div',{style:{display:'flex',width:800,height:400}},
      React.createElement(SidebarTransition,options,React.createElement('section',{style:{width:options.width,height:'100%',display:'flex',flexDirection:'column'}},React.createElement(Draft),React.createElement(BrowserSlot,{sessionId:'animation',tabId:'browser'}))),
      React.createElement('button',null,'中心区域')))));};
  const shell=()=>document.querySelector('[data-sidebar-transition]');
  const sample=()=>({width:shell().getBoundingClientRect().width,opacity:Number(getComputedStyle(shell().querySelector('[data-sidebar-transition-content]')).opacity),visibility:getComputedStyle(shell()).visibility});
  window.fadeFixture={render,shell,sample,until,frame,mounts,calls,
    renderJoined(collapsed){flushSync(()=>root.render(React.createElement(Provider,{store},
      React.createElement('div',{style:{display:'flex',width:800,height:400}},
        React.createElement(SidebarTransition,{collapsed,width:256},React.createElement('button',null,'导航')),
        React.createElement(WorkspacePanels,{workspaceSide:'left',workspaceOpen:true,workspaceWidth:300,minimumWidth:240,maximumWidth:600,onResizeStart:()=>{},onResizeKeyDown:()=>{},
          agent:React.createElement('button',null,'中心区域'),workspace:React.createElement('section',{style:{width:300,height:'100%',display:'flex',flexDirection:'column'}},React.createElement(BrowserSlot,{sessionId:'animation',tabId:'browser'}))})))));},
    open:()=>until(()=>sample().width===options.width&&sample().opacity===1),
    closed:()=>until(()=>sample().width===0&&sample().opacity===0&&sample().visibility==='hidden')};
`

beforeAll(async () => {
  renderer = await createElectronRendererHarness(entry)
  reducedMotionRenderer = await createElectronRendererHarness(entry, {
    mainWindowSetup: `window.webContents.once('did-finish-load',()=>{window.webContents.debugger.attach('1.3');void window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});});`,
  })
}, 120_000)
afterAll(async () => { await Promise.all([renderer?.dispose(), reducedMotionRenderer?.dispose()]) })

describe('Given 两侧常驻内容的动画外壳', () => {
  test('When 展开、无关更新、收起并快速反向 Then 两个方向均出现中间透明度且草稿不重挂载', async () => {
    const results = await renderer.run(`
      const f=window.fadeFixture,results=[];
      for(const region of ['navigation','workspace']){
        f.render({collapsed:true,region});await f.closed();
        const input=document.querySelector('input');input.value='保留终端历史';const mounts=f.mounts.count;
        f.render({collapsed:false});await f.until(()=>{const s=f.sample();return s.width>0&&s.width<300&&s.opacity>0&&s.opacity<1});const opening=f.sample();
        f.render({revision:1});await f.open();
        f.render({collapsed:true});await f.until(()=>{const s=f.sample();return s.width>0&&s.width<300&&s.opacity>0&&s.opacity<1});const closing=f.sample();
        f.render({revision:2});await f.closed();input.focus();
        const hidden=f.shell().hasAttribute('inert')&&f.shell().getAttribute('aria-hidden')==='true'&&document.activeElement!==input;
        f.render({collapsed:false});await f.until(()=>f.sample().opacity>0&&f.sample().opacity<0.9);
        f.render({collapsed:true});await f.closed();f.render({collapsed:false});await f.open();
        results.push({region,opening:opening.width>0&&opening.opacity>0,closing:closing.width>0&&closing.opacity<1,hidden,
          retained:input===document.querySelector('input')&&input.value==='保留终端历史'&&f.mounts.count===mounts,
          restored:!f.shell().hasAttribute('inert')&&f.sample().opacity===1});
      }return results;
    `)
    expect(results).toEqual(['navigation', 'workspace'].map(region => ({ region, opening: true, closing: true, hidden: true, retained: true, restored: true })))
  }, 30_000)

  test('When 首次打开、拖动调宽和收起原生浏览器 Then 首次淡入、调宽立即生效且隐藏视图保留会话', async () => {
    const result = await renderer.run(`
      const f=window.fadeFixture;f.render({collapsed:false});
      await f.until(()=>f.sample().opacity>0&&f.sample().opacity<1);const firstFade=f.sample().opacity<1;await f.open();
      f.render({width:420,resizing:true});const immediate=f.sample().width===420;
      await f.until(()=>f.calls.at(-1)?.visible&&f.calls.at(-1)?.bounds.width===420);
      const slot=document.querySelector('[aria-label="受管浏览器页面"]');f.render({collapsed:true,resizing:false});
      await f.until(()=>f.calls.at(-1)?.visible===false&&f.calls.at(-1)?.preserveSessionOnHide===true);await f.closed();
      const hidden=f.calls.at(-1).visible===false;f.render({collapsed:false});await f.open();
      await f.until(()=>f.calls.at(-1)?.visible&&f.calls.at(-1)?.bounds.width===420);
      return {firstFade,immediate,hidden,restored:slot===document.querySelector('[aria-label="受管浏览器页面"]')&&f.calls.at(-1).visible};
    `)
    expect(result).toEqual({ firstFade: true, immediate: true, hidden: true, restored: true })
  }, 30_000)

  test('When 系统减少动态效果 Then 取消宽度移动但保留展开和收起的短暂淡入淡出', async () => {
    const result = await reducedMotionRenderer.run(`
      const f=window.fadeFixture;await f.until(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);f.render({collapsed:true});await f.closed();
      f.render({collapsed:false});await f.until(()=>f.sample().opacity>0&&f.sample().opacity<1);const opening=f.sample();await f.open();
      f.render({collapsed:true});await f.until(()=>f.sample().opacity>0&&f.sample().opacity<1);const closing=f.sample();await f.closed();
      return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,openingFade:opening.opacity>0&&opening.opacity<1,closingFade:closing.opacity>0&&closing.opacity<1,
        noWidthMotion:opening.width===300&&closing.width===300,finished:f.sample().width===0};
    `)
    expect(result).toEqual({ reduced: true, openingFade: true, closingFade: true, noWidthMotion: true, finished: true })
  }, 30_000)

  test('When 工作区位于左侧且主导航收放 Then 原生浏览器坐标跟随动画且实例不重挂载', async () => {
    const result = await renderer.run(`
      const f=window.fadeFixture;f.renderJoined(false);
      await f.until(()=>f.calls.at(-1)?.visible&&f.calls.at(-1).bounds.x===256&&f.calls.at(-1).bounds.width===300);
      const slot=document.querySelector('[aria-label="受管浏览器页面"]');f.renderJoined(true);
      await f.until(()=>f.calls.at(-1)?.visible&&f.calls.at(-1).bounds.x===0&&f.calls.at(-1).bounds.width===300);
      const collapsed=f.calls.at(-1).bounds.x===0;f.renderJoined(false);
      await f.until(()=>f.calls.at(-1)?.visible&&f.calls.at(-1).bounds.x===256&&f.calls.at(-1).bounds.width===300);
      return {collapsed,expanded:f.calls.at(-1).bounds.x===256,retained:slot===document.querySelector('[aria-label="受管浏览器页面"]')};
    `)
    expect(result).toEqual({ collapsed: true, expanded: true, retained: true })
  }, 30_000)
})
