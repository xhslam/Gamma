import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { AgyPermissionNotice } from '@/components/tabs/AgyPermissionNotice'
    import '@/styles/globals.css'
    localStorage.clear()
    let store=createStore(),root=createRoot(document.getElementById('root'))
    const render=(visible=true,active=true)=>root.render(React.createElement(Provider,{store},visible?React.createElement(AgyPermissionNotice,{active,embedded:true}):null))
    const delay=()=>new Promise(resolve=>setTimeout(resolve,30))
    const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await delay()}throw new Error('一次性权限提示未达到预期状态')}
    window.noticeTest={render,delay,until,notice:()=>document.querySelector('[aria-label="AGY 权限提示"]'),restart:()=>{root.unmount();store=createStore();root=createRoot(document.getElementById('root'));render()},stored:()=>localStorage.getItem('gamma-agy-permission-notice-seen-v1')}
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('AGY 一次性权限说明', () => {
  test('Given 首次展示 When 点击叉号 Then 立即隐藏且重挂载和全新 Store 均不再出现', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.noticeTest;api.render();await api.until(()=>api.notice());
      const first=!!document.querySelector('button[aria-label="关闭权限提示"]');
      document.querySelector('button[aria-label="关闭权限提示"]').click();await api.until(()=>!api.notice());
      api.render(false);await api.delay();api.render();await api.delay();const reopened=!!api.notice();
      api.restart();await api.delay();return {first,reopened,restarted:!!api.notice(),stored:api.stored()};
    `)).toEqual({ first: true, reopened: false, restarted: false, stored: 'true' })
  }, 20_000)
  test('Given 已展示但没有手动关闭 When 离开再进入 Then 提示也只出现首次一次', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.noticeTest;api.render();await api.until(()=>api.notice());
      api.render(false);await api.delay();api.render();await api.delay();
      return {visible:!!api.notice(),stored:api.stored()};
    `)).toEqual({ visible: false, stored: 'true' })
  }, 20_000)
  test('Given 仅后台挂载 When 真正激活后 Then 才消费首次说明且再次激活不会重复', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.noticeTest;api.render(true,false);await api.delay();const background={visible:!!api.notice(),stored:api.stored()};
      api.render(true,true);await api.until(()=>api.notice());api.render(true,false);await api.until(()=>!api.notice());
      api.render(true,true);await api.delay();return {background,reopened:!!api.notice(),stored:api.stored()};
    `)).toEqual({ background: { visible: false, stored: null }, reopened: false, stored: 'true' })
  }, 20_000)
})
