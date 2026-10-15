import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import { Conversation,ConversationContent,ConversationScrollButton } from '@/components/ai-elements/conversation';
    import {useStickToBottomContext} from 'use-stick-to-bottom';
    const wait=(ms=60)=>new Promise(r=>setTimeout(r,ms));
    function Controls(){const context=useStickToBottomContext();window.scrollContext=context;return React.createElement(ConversationScrollButton)}
    window.conversationRegression={wait,async mount(){const root=createRoot(document.getElementById('root'));let setHeight;
      function Fixture(){const [height,update]=React.useState(1200);setHeight=update;return React.createElement(Conversation,{style:{height:300,width:400,position:'relative'}},React.createElement(ConversationContent,{style:{padding:0}},React.createElement('div',{'data-content':true,style:{height}},'流式长内容')),React.createElement(Controls))}
      root.render(React.createElement(Fixture));await wait(250);const el=window.scrollContext.scrollRef.current;
      return {root,el,grow:()=>setHeight(h=>h+120),distance:()=>el.scrollHeight-el.clientHeight-el.scrollTop,jump:()=>document.querySelector('[aria-label="跳至最新消息"]')};}}
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 Chromium 流式会话', () => {
  test('When 用户上滚后内容持续增长 Then 不抢位置且显式跳转恢复跟随', async () => {
    const result = await renderer.run(`
      const api=window.conversationRegression,f=await api.mount();const initial=f.distance()<3;
      f.el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));f.el.scrollTop-=200;await api.wait(40);const held=f.el.scrollTop;
      f.grow();await api.wait(220);const stayed=Math.abs(f.el.scrollTop-held)<3,button=!!f.jump();f.jump()?.click();await api.wait(1500);const jumped=f.distance()<3;
      f.grow();await api.wait(200);const follows=f.distance()<3;f.root.unmount();return {initial,stayed,button,jumped,follows};
    `)
    expect(result).toEqual({ initial: true, stayed: true, button: true, jumped: true, follows: true })
  }, 30_000)
  test('When 只离底部 80px 或 130px Then 跳转按钮使用独立120px阈值', async () => {
    const result = await renderer.run(`
      const api=window.conversationRegression,f=await api.mount();window.scrollContext.stopScroll();f.el.scrollTop=f.el.scrollHeight-f.el.clientHeight-80;await api.wait();const near=!f.jump();
      f.el.scrollTop-=50;await api.wait();const far=!!f.jump();f.root.unmount();return {near,far};
    `)
    expect(result).toEqual({ near: true, far: true })
  }, 30_000)
  test('When 程序定位历史并有图片延后撑高 Then 保留历史锚点而非恢复跟随', async () => {
    const result = await renderer.run(`
      const api=window.conversationRegression,f=await api.mount();window.scrollContext.stopScroll();f.el.scrollTop=300;await api.wait();const before=f.el.scrollTop;
      f.grow();await api.wait(220);const held=Math.abs(f.el.scrollTop-before)<3;
      const detached=!window.scrollContext.isAtBottom;f.root.unmount();return {held,detached};
    `)
    expect(result).toEqual({ held: true, detached: true })
  }, 30_000)
  test('When 鼠标开始选中文本 Then 内容增长不移动阅读位置', async () => {
    const result = await renderer.run(`
      const api=window.conversationRegression,f=await api.mount();const content=f.el.querySelector('[data-content]');content.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0,bubbles:true}));
      const before=f.el.scrollTop;f.grow();await api.wait(220);const held=Math.abs(f.el.scrollTop-before)<3;
      window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:0}));f.grow();await api.wait(180);const remainsHeld=Math.abs(f.el.scrollTop-before)<3;f.root.unmount();return {held,remainsHeld};
    `)
    expect(result).toEqual({ held: true, remainsHeld: true })
  }, 30_000)
  test('When 拖动原生滚动条并在最后滚动后松手 Then 无需新scroll事件也恢复跟随', async () => {
    const result = await renderer.run(`
      const api=window.conversationRegression,f=await api.mount();window.scrollContext.stopScroll();f.el.scrollTop=100;await api.wait();
      f.el.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0,bubbles:true}));
      f.el.scrollTop=f.el.scrollHeight-f.el.clientHeight-20;await api.wait(200);const paused=!window.scrollContext.isAtBottom;
      window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse',button:0}));await api.wait(100);const resumed=f.distance()<3;
      f.grow();await api.wait(100);const follows=f.distance()<3;f.root.unmount();return {paused,resumed,follows};
    `)
    expect(result).toEqual({ paused: true, resumed: true, follows: true })
  }, 30_000)
  test('When 向下回到40px内 Then 冷却期间不抢滚动且之后恢复', async () => {
    const result = await renderer.run(`
      const api=window.conversationRegression,f=await api.mount();f.el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}));f.el.scrollTop-=200;await api.wait(200);
      f.el.dispatchEvent(new WheelEvent('wheel',{deltaY:180,bubbles:true}));f.el.scrollTop=f.el.scrollHeight-f.el.clientHeight-20;await api.wait(50);const cooling=f.distance()>10;
      await api.wait(200);const resumed=f.distance()<3;f.root.unmount();return {cooling,resumed};
    `)
    expect(result).toEqual({ cooling: true, resumed: true })
  }, 30_000)
})
