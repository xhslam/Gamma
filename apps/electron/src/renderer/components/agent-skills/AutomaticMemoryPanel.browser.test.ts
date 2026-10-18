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

describe('Given 新版自动分类记忆面板', () => {
  test('When 逐层折叠和展开 Then 默认摘要紧凑且三层触发器遵守 aria-expanded', async () => {
    const result = await renderer.run(`${helpers}
      const card=document.querySelector('[data-memory-entry-id="one"]');
      const entry=card.querySelector('button[aria-expanded]');
      const initiallyCollapsed=entry.getAttribute('aria-expanded')==='false';
      entry.click();await t.wait(()=>entry.getAttribute('aria-expanded')==='true');
      const category=document.querySelector('[data-memory-category="profile"] button[aria-expanded]');
      category.click();await t.wait(()=>category.getAttribute('aria-expanded')==='false');
      const categoryHidden=!visible(card);category.click();await t.wait(()=>visible(card));
      const panel=button('折叠记忆面板');panel.click();await t.wait(()=>panel.getAttribute('aria-expanded')==='false');
      const panelHidden=!visible(document.querySelector('[aria-label="搜索记忆"]'));
      panel.click();await t.wait(()=>visible(document.querySelector('[aria-label="搜索记忆"]')));
      button('全部展开').click();await t.wait(()=>document.querySelector('[data-memory-entry-id="two"] button[aria-expanded]').getAttribute('aria-expanded')==='true');
      button('全部折叠').click();await t.wait(()=>document.querySelector('[data-memory-category="areas"] button[aria-expanded]').getAttribute('aria-expanded')==='false');
      return {initiallyCollapsed,categoryHidden,panelHidden,settingsClosed:button('记忆设置').getAttribute('aria-expanded')==='false'};
    `)
    expect(result).toEqual({ initiallyCollapsed: true, categoryHidden: true, panelHidden: true, settingsClosed: true })
  }, 30_000)

  test('When 搜索正文或无匹配 Then 显示正确条目、结果数与可清除的空状态', async () => {
    const result = await renderer.run(`${helpers}
      const search=document.querySelector('[aria-label="搜索记忆"]');
      t.input(search,'  温暖  ');await t.wait(()=>document.querySelectorAll('[data-memory-entry-id]').length===1);
      const matched=document.querySelector('[data-memory-entry-id]').dataset.memoryEntryId;
      const count=document.body.innerText.includes('1 / 3');
      t.input(search,'不存在的主题');await t.wait(()=>document.body.innerText.includes('没有找到匹配的记忆'));
      button('清空搜索').click();await t.wait(()=>document.querySelectorAll('[data-memory-entry-id]').length===3);
      return {matched,count,restored:search.value===''};
    `)
    expect(result).toEqual({ matched: 'two', count: true, restored: true })
  }, 30_000)

  test('When 从消息导航到已收起且被搜索隐藏的条目 Then 清除筛选、展开层级并聚焦', async () => {
    const result = await renderer.run(`${helpers}
      button('全部展开').click();await t.wait(()=>button('全部折叠'));button('全部折叠').click();t.input(document.querySelector('[aria-label="搜索记忆"]'),'回答');
      button('折叠记忆面板').click();await new Promise(r=>setTimeout(r,50));
      t.navigate('two');
      await t.wait(()=>visible(document.querySelector('[data-memory-entry-id="two"]'))&&document.activeElement?.closest('[data-memory-entry-id]')?.dataset.memoryEntryId==='two');
      return {search:document.querySelector('[aria-label="搜索记忆"]').value,entryOpen:document.querySelector('[data-memory-entry-id="two"] button[aria-expanded]').getAttribute('aria-expanded'),panelOpen:button('折叠记忆面板').getAttribute('aria-expanded')};
    `)
    expect(result).toEqual({ search: '', entryOpen: 'true', panelOpen: 'true' })
  }, 30_000)

  test('When 编辑失败并折叠后重新展开 Then 草稿保留且重试使用原快照 revision', async () => {
    const result = await renderer.run(`${helpers}
      button('编辑 回答偏好').click();await t.wait(()=>document.querySelector('textarea'));
      const textarea=document.querySelector('textarea');t.input(textarea,'我的编辑草稿');await new Promise(r=>setTimeout(r,30));
      const entry=document.querySelector('[data-memory-entry-id="one"] button[aria-expanded]');entry.click();await new Promise(r=>setTimeout(r,30));entry.click();
      t.setFail(true);button('保存并保护').click();await t.wait(()=>document.querySelector('[role="alert"]'));
      const draft=document.querySelector('textarea').value;button('重新加载（保留编辑）').click();await new Promise(r=>setTimeout(r,60));
      const afterRefresh=document.querySelector('textarea').value;t.setFail(false);button('保存并保护').click();await t.wait(()=>!document.querySelector('textarea'));
      return {draft,afterRefresh,revisions:t.calls().filter(c=>c.type==='edit').map(c=>c.revision),protected:document.querySelector('[data-memory-entry-id="one"]').textContent.includes('手动保护')};
    `)
    expect(result).toEqual({ draft: '我的编辑草稿', afterRefresh: '我的编辑草稿', revisions: [17, 17], protected: true })
  }, 30_000)

  test('When 调整记忆设置 Then 不关闭正在编辑的草稿', async () => {
    const result = await renderer.run(`${helpers}
      button('编辑 回答偏好').click();await t.wait(()=>document.querySelector('textarea'));
      t.input(document.querySelector('textarea'),'尚未保存的内容');button('记忆设置').click();
      await t.wait(()=>visible(document.querySelector('[id="automatic-memory-demo"]')));
      document.querySelector('[id="automatic-memory-demo"]').click();await t.wait(()=>t.calls().length===1);await new Promise(r=>setTimeout(r,80));
      return {draft:document.querySelector('textarea')?.value,call:t.calls()[0]};
    `)
    expect(result).toEqual({ draft: '尚未保存的内容', call: { type: 'settings', slug: 'demo', patch: { enabled: false } } })
  }, 30_000)

  test('When 定位后编辑其他条目或再次点击同一提示 Then 不抢编辑焦点且可重复定位', async () => {
    const result = await renderer.run(`${helpers}
      t.navigate('two');await t.wait(()=>document.activeElement?.dataset.memoryEntryId==='two');
      button('编辑 回答偏好').click();await t.wait(()=>document.activeElement?.tagName==='TEXTAREA');
      await new Promise(r=>setTimeout(r,80));const editingKeepsFocus=document.activeElement?.tagName==='TEXTAREA';
      button('折叠记忆面板').click();await new Promise(r=>setTimeout(r,30));t.navigate('two');
      await t.wait(()=>document.activeElement?.dataset.memoryEntryId==='two');
      return {editingKeepsFocus,reopened:button('折叠记忆面板').getAttribute('aria-expanded')==='true',draftKept:Boolean(document.querySelector('textarea'))};
    `)
    expect(result).toEqual({ editingKeepsFocus: true, reopened: true, draftKept: true })
  }, 30_000)

  test('When 删除取消或确认 Then 仅确认后调用删除 API 且附带快照 revision', async () => {
    const result = await renderer.run(`${helpers}
      button('删除 回答偏好').click();await t.wait(()=>document.querySelector('[role="alertdialog"]'));
      const before=t.calls().length;button('取消').click();await t.wait(()=>!document.querySelector('[role="alertdialog"]'));
      button('删除 回答偏好').click();await t.wait(()=>document.querySelector('[role="alertdialog"]'));
      button('确认删除').click();await t.wait(()=>!document.querySelector('[data-memory-entry-id="one"]'));
      return {before,calls:t.calls(),remaining:document.querySelectorAll('[data-memory-entry-id]').length};
    `)
    expect(result).toEqual({ before: 0, calls: [{ type: 'delete', slug: 'demo', id: 'one', revision: 17 }], remaining: 2 })
  }, 30_000)

  test('When 编辑期间删除其他条目 Then 不丢失无关草稿', async () => {
    const result = await renderer.run(`${helpers}
      button('编辑 回答偏好').click();await t.wait(()=>document.querySelector('textarea'));
      t.input(document.querySelector('textarea'),'无关条目的草稿');button('删除 界面设计').click();
      await t.wait(()=>document.querySelector('[role="alertdialog"]'));button('确认删除').click();
      await t.wait(()=>!document.querySelector('[data-memory-entry-id="two"]'));await new Promise(r=>setTimeout(r,30));
      return {draft:document.querySelector('textarea')?.value,remaining:document.querySelectorAll('[data-memory-entry-id]').length};
    `)
    expect(result).toEqual({ draft: '无关条目的草稿', remaining: 2 })
  }, 30_000)

  test('When 查看窄屏、深浅主题和敏感设置 Then 无横向溢出且授权仍独立', async () => {
    const result = await renderer.run(`${helpers}
      const root=document.getElementById('root');root.style.width='320px';
      button('全部展开').click();button('记忆设置').click();await new Promise(r=>setTimeout(r,70));
      const overflow=root.scrollWidth>root.clientWidth+1;
      const consent=document.body.innerText.includes('不会在发送模型前自动脱敏');
      const toggle=document.querySelector('[id="sensitive-memory-demo"]');toggle.click();await t.wait(()=>t.calls().length===1);
      const light=getComputedStyle(document.querySelector('section[aria-label="自动分类记忆"]')).backgroundColor;
      document.documentElement.classList.add('dark');await new Promise(r=>setTimeout(r,70));
      const dark=getComputedStyle(document.querySelector('section[aria-label="自动分类记忆"]')).backgroundColor;
      return {overflow,consent,differentThemes:light!==dark,call:t.calls()[0]};
    `)
    expect(result).toEqual({ overflow: false, consent: true, differentThemes: true, call: { type: 'settings', slug: 'demo', patch: { includeSensitive: true } } })
  }, 30_000)

  test('When 工作区尚无记忆或目标已删除 Then 显示明确空状态而非大块空分类', async () => {
    const result = await renderer.run(`
      const t=window.memoryTest;await t.mount({empty:true,disabled:true,entryId:'missing'});
      const noToolbar=!document.querySelector('[aria-label="搜索记忆"]')&&!document.body.innerText.includes('全部展开');
      Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='打开记忆设置').click();
      await t.wait(()=>document.querySelector('[aria-label="记忆设置"]').getAttribute('aria-expanded')==='true');
      return {noToolbar,noConsentChange:t.calls().length===0,empty:document.body.innerText.includes('还没有保存的记忆'),missing:document.body.innerText.includes('此条记忆已删除或不再可用。'),cards:document.querySelectorAll('[data-memory-entry-id]').length};
    `)
    expect(result).toEqual({ noToolbar: true, noConsentChange: true, empty: true, missing: true, cards: 0 })
  }, 30_000)
})
