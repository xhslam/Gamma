import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { AutomaticMemoryPanel } from '@/components/agent-skills/AutomaticMemoryPanel'
    import { automaticMemoryNavigationAtom } from '@/atoms/automatic-memory-atoms'
    import '@/styles/globals.css'
    const entry=(id,category,title,content,manuallyEdited=false)=>({id,category,title,content,manuallyEdited,facts:[],revision:2,createdAt:1,updatedAt:1792288800000});
    const defaults=[entry('one','profile','回答偏好','回答应简洁清晰，保留必要技术术语。'),entry('two','areas','界面设计','采用低对比表面和温暖强调色。'),entry('three','areas','很长的标题'.repeat(12),'长内容'.repeat(300),true)];
    let snapshot,store,calls=[],fail=false,listener;
    const root=createRoot(document.getElementById('root'));
    window.electronAPI={
      onAutomaticMemoryChanged:(callback)=>{listener=callback;return()=>{listener=null}},
      getAutomaticMemorySnapshot:async()=>structuredClone(snapshot),
      updateAutomaticMemorySettings:async(slug,patch)=>{calls.push({type:'settings',slug,patch});snapshot.settings={...snapshot.settings,...patch};snapshot.revision++},
      editAutomaticMemoryEntry:async(slug,id,text,revision)=>{calls.push({type:'edit',slug,id,text,revision});if(fail)throw new Error('并发修改，请复制草稿后刷新');snapshot.entries=snapshot.entries.map(e=>e.id===id?{...e,content:text,manuallyEdited:true}:e);snapshot.revision++},
      deleteAutomaticMemoryEntry:async(slug,id,revision)=>{calls.push({type:'delete',slug,id,revision});snapshot.entries=snapshot.entries.filter(e=>e.id!==id);snapshot.revision++},
    };
    const wait=async(predicate)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20))}throw new Error('等待 UI 超时：'+document.body.innerText)};
    window.memoryTest={
      mount:async(options={})=>{snapshot={settings:{enabled:!options.disabled,includeSensitive:false},entries:options.empty?[]:defaults,revision:17};store=createStore();calls=[];fail=false;root.render(React.createElement(Provider,{store},React.createElement(AutomaticMemoryPanel,{workspaceSlug:'demo',entryId:options.entryId})));await wait(()=>options.empty?document.body.innerText.includes('还没有保存的记忆'):document.querySelector('[aria-label="搜索记忆"]'));},
      wait,calls:()=>calls,setFail:(value)=>{fail=value},
      navigate:(entryId)=>store.set(automaticMemoryNavigationAtom,{workspaceSlug:'demo',entryId}),
      input:(element,value)=>{Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));},
    };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

const helpers = `
  const t=window.memoryTest;await t.mount();
  const button=(name)=>Array.from(document.querySelectorAll('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent.trim()===name);
  const visible=(el)=>Boolean(el&&el.getBoundingClientRect().height&&getComputedStyle(el).visibility!=='hidden');
`

describe('Given Claude 风格的原位置记忆面板', () => {
  test('When 点击列表条目并返回 Then 展示独立详情且返回分组列表', async () => {
    expect(await renderer.run<unknown>(`${helpers}
      button('查看 回答偏好').click();await t.wait(()=>document.body.innerText.includes('上次更新'));
      const detail=document.body.innerText.includes('详情')&&!document.querySelector('[aria-label="搜索记忆"]');
      button('返回记忆列表').click();await t.wait(()=>document.querySelector('[aria-label="搜索记忆"]'));
      return {detail,count:document.querySelectorAll('[data-memory-entry-id]').length};
    `)).toEqual({detail:true,count:3})
  }, 30_000)

  test('When 搜索没有匹配并清除 Then 恢复全部条目', async () => {
    expect(await renderer.run<unknown>(`${helpers}
      t.input(document.querySelector('[aria-label="搜索记忆"]'),'不存在');await t.wait(()=>document.body.innerText.includes('没有找到匹配的记忆'));
      button('清空搜索').click();await t.wait(()=>document.querySelectorAll('[data-memory-entry-id]').length===3);
      return document.querySelectorAll('[data-memory-entry-id]').length;
    `)).toBe(3)
  }, 30_000)

  test('When 编辑冲突并返回列表 Then 保留草稿和原 revision 以供重试', async () => {
    expect(await renderer.run<unknown>(`${helpers}
      button('编辑 回答偏好').click();await t.wait(()=>document.querySelector('textarea'));
      t.input(document.querySelector('textarea'),'保留这份草稿');await new Promise(r=>setTimeout(r,30));
      t.setFail(true);button('保存并保护').click();await t.wait(()=>document.querySelector('[role="alert"]'));
      button('返回记忆列表').click();await t.wait(()=>document.querySelector('[aria-label="搜索记忆"]'));
      const draft=document.querySelector('textarea').value;
      t.setFail(false);button('保存并保护').click();await t.wait(()=>!document.querySelector('textarea'));
      return {draft,revisions:t.calls().filter(c=>c.type==='edit').map(c=>c.revision)};
    `)).toEqual({draft:'保留这份草稿',revisions:[17,17]})
  }, 30_000)

  test('When 删除取消再确认 Then 仅确认会写入且使用快照 revision', async () => {
    expect(await renderer.run<unknown>(`${helpers}
      button('删除 回答偏好').click();await t.wait(()=>document.querySelector('[role="alertdialog"]'));
      button('取消').click();await t.wait(()=>!document.querySelector('[role="alertdialog"]'));
      const before=t.calls().length;button('删除 回答偏好').click();await t.wait(()=>document.querySelector('[role="alertdialog"]'));
      button('确认删除').click();await t.wait(()=>document.querySelectorAll('[data-memory-entry-id]').length===2);
      return {before,calls:t.calls()};
    `)).toEqual({before:0,calls:[{type:'delete',slug:'demo',id:'one',revision:17}]})
  }, 30_000)

  test('When 消息跳转到记忆 Then 显示详情并聚焦目标', async () => {
    expect(await renderer.run<unknown>(`${helpers}
      t.navigate('two');await t.wait(()=>document.activeElement?.dataset.memoryEntryId==='two');
      return document.body.innerText.includes('采用低对比表面和温暖强调色。');
    `)).toBe(true)
  }, 30_000)

  test('When 窄窗口与切换主题 Then 没有横向溢出且敏感授权独立', async () => {
    expect(await renderer.run<unknown>(`${helpers}
      const root=document.getElementById('root');root.style.width='320px';
      const overflow=root.scrollWidth>root.clientWidth+1;
      const light=getComputedStyle(document.querySelector('section')).backgroundColor;
      document.documentElement.classList.add('dark');await new Promise(r=>setTimeout(r,50));
      const dark=getComputedStyle(document.querySelector('section')).backgroundColor;
      document.querySelector('[id="sensitive-memory-demo"]').click();await t.wait(()=>t.calls().length===1);
      return {overflow,different:light!==dark,patch:t.calls()[0].patch};
    `)).toEqual({overflow:false,different:true,patch:{includeSensitive:true}})
  }, 30_000)
})
