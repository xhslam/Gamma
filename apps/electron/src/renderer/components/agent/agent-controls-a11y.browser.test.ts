import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { MentionList } from '@/components/agent/MentionList'
    import { FileMentionList } from '@/components/file-browser/FileMentionList'
    import { PermissionBanner } from '@/components/agent/PermissionBanner'
    import { AskUserBanner } from '@/components/agent/AskUserBanner'
    import { ExitPlanModeBanner } from '@/components/agent/ExitPlanModeBanner'
    import { allPendingPermissionRequestsAtom, allPendingAskUserRequestsAtom, allPendingExitPlanRequestsAtom } from '@/atoms/agent-atoms'
    import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
    import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
    import '@/styles/globals.css'
    const delay = (ms=30) => new Promise(resolve=>setTimeout(resolve,ms));
    window.controls = { delay, async mount(kind='permission') {
      const store=createStore(), root=createRoot(document.getElementById('root')), calls=[];
      let fail=false, release;
      window.electronAPI={respondPermission:async response=>{calls.push(response);if(fail)throw new Error('连接已断开');await new Promise(resolve=>release=resolve)},respondAskUser:async response=>calls.push(response),respondExitPlanMode:async response=>calls.push(response),stopAgent:async()=>{if(fail)throw new Error('停止失败')}};
      const request={requestId:'p1',sessionId:'A',toolName:'Bash',toolInput:{command:'pwd'},command:'pwd',dangerLevel:'normal',description:'执行命令',allowAlways:false};
      store.set(allPendingPermissionRequestsAtom,new Map([['A',[request,{...request,requestId:'p2'}]]]));
      store.set(allPendingAskUserRequestsAtom,new Map([['A',[{requestId:'q1',sessionId:'A',questions:[{question:'选择方案',options:[{label:'方案一'},{label:'方案二'}]}]}]]]));
      store.set(allPendingExitPlanRequestsAtom,new Map([['A',[{requestId:'e1',sessionId:'A',allowedPrompts:[]}]]]));
      const banners={permission:PermissionBanner,ask:AskUserBanner,plan:ExitPlanModeBanner};
      const listRef=React.createRef();let activeId;
      const mention=kind==='file'?React.createElement(FileMentionList,{ref:listRef,listId:'suggestions',onActiveDescendantChange:id=>activeId=id,sessionEntries:[],workspaceEntries:[{name:'目录',path:'目录',type:'dir',source:'workspace'},{name:'中文.md',path:'目录/中文.md',type:'file',source:'workspace'}],onSelect:item=>calls.push(item)}):React.createElement(MentionList,{ref:listRef,listId:'suggestions',onActiveDescendantChange:id=>activeId=id,items:['中文技能','第二项'],keyExtractor:item=>item,renderItem:item=>item,emptyText:'没有选项',onSelect:item=>calls.push(item)});
      const dialogs=React.createElement(React.Fragment,null,
        React.createElement(Dialog,null,React.createElement(DialogTrigger,null,'打开对话框'),React.createElement(DialogContent,null,React.createElement(DialogTitle,null,'对话框标题'),React.createElement(DialogDescription,null,'对话框说明'),React.createElement('input',{'aria-label':'弹窗输入'}))),
        React.createElement(AlertDialog,null,React.createElement(AlertDialogTrigger,null,'打开确认框'),React.createElement(AlertDialogContent,null,React.createElement(AlertDialogTitle,null,'确认框标题'),React.createElement(AlertDialogDescription,null,'确认框说明'),React.createElement(AlertDialogCancel,null,'取消'),React.createElement(AlertDialogAction,null,'确定'))));
      root.render(React.createElement(Provider,{store},React.createElement(React.Fragment,null,React.createElement('button',{id:'outside'},'其他操作'),React.createElement('input',{id:'draft'}),kind==='dialogs'?dialogs:['mention','file'].includes(kind)?mention:React.createElement(banners[kind],{sessionId:'A'}))));
      await delay(100);return {root,calls,store,listRef,activeId:()=>activeId,fail:value=>fail=value,release:()=>release?.(),queue:()=>store.get(allPendingPermissionRequestsAtom).get('A')??[]};
    }, key(target,key,extra={}) {target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}))} };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 待审批横幅与其他交互控件', () => {
  test('When 焦点在外部按钮、编辑器或 IME Then 不得全局授权或提交', async () => {
    const results = await renderer.run<boolean[]>(`
      const api=window.controls,results=[];
      for(const kind of ['permission','ask','plan']) {
        const f=await api.mount(kind),outside=document.getElementById('outside');outside.focus();api.key(outside,'Enter');api.key(outside,'1');
        const input=document.getElementById('draft');input.focus();api.key(input,'Enter');api.key(input,'Enter',{keyCode:229});
        await api.delay();results.push(f.calls.length===0);f.root.unmount();await api.delay();
      }return results;
    `)
    expect(results).toEqual([true, true, true])
  })
  test('When 在横幅内用方向键 Then 焦点移动而不提交或放宽权限', async () => {
    const result=await renderer.run(`
      const api=window.controls,results=[];
      for(const kind of ['ask','plan']){const f=await api.mount(kind),options=[...document.querySelectorAll('[data-banner-option]')];options[0].focus();api.key(options[0],'ArrowDown');const down=document.activeElement===options[1];api.key(options[1],'ArrowUp');results.push(down&&document.activeElement===options[0]&&f.calls.length===0);f.root.unmount();await api.delay();}return results;
    `)
    expect(result).toEqual([true,true])
  })
  test('When 审批提交失败 Then 保留 FIFO 请求、显示错误并可重试，批准不伪造成功', async () => {
    const result = await renderer.run(`
      const api=window.controls,f=await api.mount(),allow=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='允许');
      f.fail(true);allow().click();allow().click();await api.delay();
      const failed={queue:f.queue().length,error:!!document.querySelector('[role="alert"]'),calls:f.calls.length};
      f.fail(false);allow().click();allow().click();await api.delay();
      const waiting={queue:f.queue().length,submitting:!!document.querySelector('[aria-busy="true"]'),calls:f.calls.length};
      f.release();await api.delay();const remaining=f.queue().map(r=>r.requestId);f.root.unmount();return {failed,waiting,remaining};
    `)
    expect(result).toEqual({ failed: { queue: 2, error: true, calls: 1 }, waiting: { queue: 2, submitting: true, calls: 2 }, remaining: ['p2'] })
  })
  test('When 拒绝操作或停止失败 Then 不扩大授权且不隐藏未解决请求', async () => {
    const result=await renderer.run(`
      const api=window.controls,f=await api.mount();
      const noAlways=![...document.querySelectorAll('button')].some(b=>b.textContent.includes('总是允许'));
      f.fail(true);document.querySelector('[aria-label="关闭并终止 Agent"]').click();await api.delay();const retained=f.queue().length===2&&!!document.querySelector('[role="alert"]');
      f.fail(false);[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='拒绝').click();await api.delay();const response=f.calls[0],pending=f.queue().length===2;f.release();await api.delay();f.root.unmount();return {noAlways,retained,response,pending};
    `)
    expect(result).toEqual({noAlways:true,retained:true,response:{requestId:'p1',behavior:'deny',alwaysAllow:false},pending:true})
  })
  test('When 组合输入 Enter Then 原生审批按钮也不得授权', async () => {
    const result = await renderer.run(`
      const api=window.controls,f=await api.mount(),button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='允许');
      button.focus();const event=new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true});button.dispatchEvent(event);await api.delay();f.root.unmount();return {prevented:event.defaultPrevented,calls:f.calls.length};
    `)
    expect(result).toEqual({ prevented: true, calls: 0 })
  })
})

describe('Given 编辑器引用列表', () => {
  test('When 键盘导航、IME 与辅助技术 click Then 状态、引用和焦点保留正确', async () => {
    const results=await renderer.run(`
      const api=window.controls,results=[];
      for(const kind of ['mention','file']) {
        const f=await api.mount(kind),draft=document.getElementById('draft');draft.focus();
        const role=kind==='file'?'treeitem':'option',first=document.querySelector('[role="'+role+'"]');
        const linked=document.getElementById(f.activeId())===first,ime=f.listRef.current.onKeyDown({event:new KeyboardEvent('keydown',{key:'Enter',keyCode:229})});
        const before=f.calls.length;
        f.listRef.current.onKeyDown({event:new KeyboardEvent('keydown',{key:kind==='file'?'ArrowRight':'ArrowDown'})});await api.delay();
        const active=document.getElementById(f.activeId()),selected=active.getAttribute('aria-selected')==='true';
        if(kind==='file'){f.listRef.current.onKeyDown({event:new KeyboardEvent('keydown',{key:'ArrowDown'})});await api.delay();}
        f.listRef.current.onKeyDown({event:new KeyboardEvent('keydown',{key:'Enter'})});await api.delay();
        const retained=document.activeElement===draft;
        const option=document.querySelector('[role="'+role+'"]');option.click();await api.delay();
        results.push({linked,ime:ime===false&&before===0,selected,retained,selectedByKeyboard:f.calls.length>=1,semanticClick:kind==='file'?document.querySelectorAll('[role="treeitem"]').length===1:f.calls.length===2});f.root.unmount();await api.delay();
      }return results;
    `)
    expect(results).toEqual([0,1].map(()=>({linked:true,ime:true,selected:true,retained:true,selectedByKeyboard:true,semanticClick:true})))
  })
})

describe('Given Radix 对话框', () => {
  test('When 打开和 Escape 关闭 Then 标题关联、焦点圈定与触发器恢复保持原生语义', async () => {
    const result = await renderer.run(`
      const api=window.controls,f=await api.mount('dialogs'),trigger=[...document.querySelectorAll('button')].find(b=>b.textContent==='打开对话框');
      trigger.focus();trigger.click();await api.delay(100);const dialog=document.querySelector('[role="dialog"]');
      const initial=dialog.contains(document.activeElement),label=!!document.getElementById(dialog.getAttribute('aria-labelledby')),description=!!document.getElementById(dialog.getAttribute('aria-describedby'));
      const last=dialog.querySelector('button');last.focus();api.key(last,'Tab');await api.delay();const forward=dialog.contains(document.activeElement)&&document.activeElement!==last;api.key(document.activeElement,'Tab',{shiftKey:true});const trapped=forward&&document.activeElement===last;
      api.key(document.activeElement,'Escape');await api.delay(350);const restored=document.activeElement===trigger;
      const alertTrigger=[...document.querySelectorAll('button')].find(b=>b.textContent==='打开确认框');alertTrigger.focus();alertTrigger.click();await api.delay(100);
      const alert=document.querySelector('[role="alertdialog"]'),cancel=[...alert.querySelectorAll('button')].find(b=>b.textContent==='取消'),safeInitial=document.activeElement===cancel;
      cancel.click();await api.delay(350);const alertRestored=document.activeElement===alertTrigger;f.root.unmount();return {initial,label,description,trapped,restored,safeInitial,alertRestored};
    `)
    expect(result).toEqual({ initial: true, label: true, description: true, trapped: true, restored: true, safeInitial: true, alertRestored: true })
  })
})
