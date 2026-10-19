import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { AutomaticMemoryNotice } from '@/components/agent-skills/AutomaticMemoryNotice'
    import { automaticMemoryChangesAtom } from '@/atoms/automatic-memory-atoms'
    import { appendAutomaticMemoryChange } from '@/lib/automatic-memory-presentation'
    import '@/styles/globals.css'
    const root=createRoot(document.getElementById('root'));
    const store=createStore();let listener,deleteCalls=0;
    window.electronAPI={
      onAutomaticMemoryChanged:(callback)=>{listener=callback;return()=>{listener=null}},
      getAutomaticMemorySnapshot:async()=>({settings:{enabled:true,includeSensitive:false},revision:1,entries:[{id:'entry',category:'profile',title:'回答偏好',content:'回答简洁清晰',facts:[],revision:1,createdAt:1,updatedAt:2,manuallyEdited:false}]}),
      deleteAutomaticMemoryEntry:async()=>{deleteCalls++},
    };
    const wait=async(predicate)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20))}throw new Error('等待 UI 超时：'+document.body.innerText)};
    const change=(patch={})=>({workspaceSlug:'demo',source:{kind:'agent',sessionId:'session',messageId:'message',createdAt:1},entryId:'entry',category:'profile',title:'回答偏好',action:'added',changedAt:2,...patch});
    window.noticeTest={
      wait,change,
      mount:async(sessionId='session')=>{root.render(React.createElement(Provider,{store},React.createElement(AutomaticMemoryNotice,{kind:'agent',sessionId})));await wait(()=>listener);await new Promise(r=>setTimeout(r,40));},
      unmount:async()=>{root.render(null);await wait(()=>!listener)},
      seed:(changes)=>store.set(automaticMemoryChangesAtom,changes),
      emit:(value)=>listener(value),
      append:(value)=>store.set(automaticMemoryChangesAtom,(previous)=>appendAutomaticMemoryChange(previous,value)),
      events:()=>store.get(automaticMemoryChangesAtom),
      deleteCalls:()=>deleteCalls,
    };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

const helpers = `
  const t=window.noticeTest;
  const notice=()=>document.querySelector('[aria-label="本会话记忆保存结果"]');
  const close=()=>document.querySelector('[aria-label="关闭记忆保存提示"]');
`

describe('Given 消息区域的真实记忆保存提示', () => {
  test('When 关闭后重挂载或收到重复事件 Then 不再显示旧提示且不删除记忆，新更新仍会出现', async () => {
    const result = await renderer.run(`${helpers}
      const saved=t.change();t.seed([saved]);await t.mount();await t.wait(()=>close());
      close().click();await t.wait(()=>!notice());
      const afterClose={events:t.events().length,deleteCalls:t.deleteCalls()};
      await t.unmount();await t.mount();const hiddenAfterRemount=!notice();
      t.emit(structuredClone(saved));await new Promise(r=>setTimeout(r,50));const hiddenAfterDuplicate=!notice();
      t.emit(t.change({action:'updated',changedAt:3}));await t.wait(()=>notice());
      return {afterClose,hiddenAfterRemount,hiddenAfterDuplicate,rows:notice().querySelectorAll('[role="status"] button').length,updated:notice().textContent.includes('已更新')};
    `)
    expect(result).toEqual({ afterClose: { events: 1, deleteCalls: 0 }, hiddenAfterRemount: true, hiddenAfterDuplicate: true, rows: 1, updated: true })
  }, 30_000)

  test('When 当前无结果或关闭某会话提示 Then 空状态不占位且其他会话不受影响', async () => {
    const result = await renderer.run(`${helpers}
      await t.mount();const empty=!notice();
      t.emit(t.change());t.emit(t.change({source:{kind:'agent',sessionId:'other',messageId:'message',createdAt:1}}));
      await t.wait(()=>close());close().click();await t.wait(()=>!notice());
      await t.mount('other');await t.wait(()=>notice());const otherVisible=notice().textContent.includes('回答偏好');
      await t.mount();await t.wait(()=>!notice());
      return {empty,otherVisible,stillDismissed:!notice(),events:t.events().length};
    `)
    expect(result).toEqual({ empty: true, otherVisible: true, stillDismissed: true, events: 2 })
  }, 30_000)

  test('When 点击保存记录 Then 原有记忆详情仍可打开', async () => {
    const result = await renderer.run(`${helpers}
      t.seed([t.change()]);await t.mount();notice().querySelector('[role="status"] button').click();
      await t.wait(()=>document.querySelector('[role="dialog"]')?.textContent.includes('回答简洁清晰'));
      return {dialogOpen:true,deleteCalls:t.deleteCalls()};
    `)
    expect(result).toEqual({ dialogOpen: true, deleteCalls: 0 })
  }, 30_000)

  test('When 单条提示、窄屏长标题和深浅主题 Then 间距紧凑、关闭按钮可聚焦且内容不横向溢出', async () => {
    const result = await renderer.run(`${helpers}
      t.seed([t.change()]);await t.mount();
      const height=notice().getBoundingClientRect().height;
      const style=getComputedStyle(notice());const paddingY=[style.paddingTop,style.paddingBottom];
      close().focus();const focusable=document.activeElement===close();
      const light=style.backgroundColor;document.documentElement.classList.add('dark');await new Promise(r=>setTimeout(r,40));
      const dark=getComputedStyle(notice()).backgroundColor;
      document.getElementById('root').style.width='320px';
      t.seed([t.change({title:'LongUnbrokenMemoryTitle'.repeat(20)})]);await t.wait(()=>notice().textContent.includes('LongUnbrokenMemoryTitle'));
      return {compact:height<=56,paddingY,focusable,differentThemes:light!==dark,noOverflow:notice().scrollWidth<=notice().clientWidth+1};
    `)
    expect(result).toEqual({ compact: true, paddingY: ['6px', '6px'], focusable: true, differentThemes: true, noOverflow: true })
  }, 30_000)
})
