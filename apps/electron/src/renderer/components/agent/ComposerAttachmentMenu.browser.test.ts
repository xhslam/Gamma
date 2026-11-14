import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ComposerAttachmentMenu} from '@/components/agent/ComposerAttachmentMenu';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import {InputToolbarOverflow} from '@/components/ai-elements/InputToolbarOverflow';
    import '@/styles/globals.css';
    window.calls=[];window.cancel=false;window.reject=false;
    window.electronAPI={openFileOrFolderDialog:async()=>{
      window.calls.push({menuGone:!document.querySelector('[role="menu"]'),unblocked:getComputedStyle(document.body).pointerEvents!=='none'});
      if(window.reject)throw new Error('测试选择器异常');
      return {files:window.cancel?[]:[{filename:'测试附件.txt',data:'dGVzdA==',mediaType:'text/plain',size:4}],directories:[]};
    }};
    window.wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await window.wait(20);}throw new Error('附件菜单未达到预期状态');};
    function Fixture(){const [files,setFiles]=React.useState([]),[references,setReferences]=React.useState(0),[error,setError]=React.useState('');
      const menu=React.createElement(ComposerAttachmentMenu,{onAttachContent:async()=>{try{const r=await window.electronAPI.openFileOrFolderDialog();setFiles(p=>[...p,...r.files]);}catch(e){setError(e.message);}},onReferenceConversations:()=>setReferences(n=>n+1)});
      return React.createElement(TooltipProvider,null,
        React.createElement(InputToolbarOverflow,{items:[...Array.from({length:4},(_,i)=>({key:'filler'+i,node:React.createElement('button',{style:{width:100}},'工具'+i)})),{key:'attach',node:menu}]}),
        React.createElement('output',{id:'files'},files.map(f=>f.filename).join(',')),
        React.createElement('output',{id:'references'},references),React.createElement('output',{id:'error'},error));}
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `)
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

const openMenu = `
  const trigger=document.querySelector('[aria-label="添加附件或引用对话"]');
  trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0,ctrlKey:false}));
  await window.until(()=>document.querySelector('[role="menuitem"]'));
`

describe('Given 输入框下方的真实附件菜单', () => {
  test('When 点击附加文件 Then 关闭菜单并释放焦点锁之后只打开一次选择器，文件回填', async () => {
    const result = await renderer.run(`${openMenu}
      document.querySelector('[role="menuitem"]').click();
      await window.until(()=>window.calls.length===1&&document.querySelector('#files').textContent.includes('测试附件.txt'));
      return {calls:window.calls,files:document.querySelector('#files').textContent};
    `)
    expect(result).toEqual({ calls: [{ menuGone: true, unblocked: true }], files: '测试附件.txt' })
  }, 30_000)

  test('When 键盘选择文件并取消 Then 不产生附件且下次仍可打开', async () => {
    const result = await renderer.run(`${openMenu}
      window.cancel=true;
      const item=document.querySelector('[role="menuitem"]');item.focus();item.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await window.until(()=>window.calls.length===1&&!document.querySelector('[role="menu"]'));
      const empty=document.querySelector('#files').textContent==='';
      ${openMenu.replace('const trigger=', 'const triggerAgain=') .replace('trigger.dispatchEvent','triggerAgain.dispatchEvent')}
      window.cancel=false;document.querySelector('[role="menuitem"]').click();
      await window.until(()=>window.calls.length===2&&document.querySelector('#files').textContent.includes('测试附件.txt'));
      return {empty,calls:window.calls.length,allUnblocked:window.calls.every(c=>c.menuGone&&c.unblocked)};
    `)
    expect(result).toEqual({ empty: true, calls: 2, allUnblocked: true })
  }, 30_000)

  test('When 选择器异常后重试 Then 显示错误且按钮仍可重新选择文件', async () => {
    const result = await renderer.run(`${openMenu}
      window.reject=true;document.querySelector('[role="menuitem"]').click();
      await window.until(()=>document.querySelector('#error').textContent==='测试选择器异常');
      window.reject=false;
      ${openMenu.replace('const trigger=', 'const triggerAgain=').replace('trigger.dispatchEvent','triggerAgain.dispatchEvent')}
      document.querySelector('[role="menuitem"]').click();
      await window.until(()=>document.querySelector('#files').textContent.includes('测试附件.txt'));
      return {calls:window.calls.length,files:document.querySelector('#files').textContent};
    `)
    expect(result).toEqual({ calls: 2, files: '测试附件.txt' })
  }, 30_000)

  test('When 窄窗口中按钮折叠到更多菜单 Then 仍可打开文件选择器并回填', async () => {
    const result = await renderer.run(`
      await window.until(()=>document.querySelector('.gamma-composer-footer'));
      document.querySelector('.gamma-composer-footer').style.width='100px';
      await window.until(()=>document.querySelector('[aria-label="更多工具"]'));
      document.querySelector('[aria-label="更多工具"]').click();
      await window.until(()=>document.querySelector('[aria-label="添加附件或引用对话"]'));
      ${openMenu}
      document.querySelector('[role="menuitem"]').click();
      await window.until(()=>document.querySelector('#files').textContent.includes('测试附件.txt'));
      return {calls:window.calls,files:document.querySelector('#files').textContent};
    `)
    expect(result).toEqual({ calls: [{ menuGone: true, unblocked: true }], files: '测试附件.txt' })
  }, 30_000)

  test('When Escape 关闭菜单 Then 不打开选择器；引用对话也在菜单关闭后执行', async () => {
    const result = await renderer.run(`${openMenu}
      document.querySelector('[role="menuitem"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      await window.until(()=>!document.querySelector('[role="menu"]'));
      const cancelled=window.calls.length===0;
      ${openMenu.replace('const trigger=', 'const triggerAgain=') .replace('trigger.dispatchEvent','triggerAgain.dispatchEvent')}
      document.querySelectorAll('[role="menuitem"]')[1].click();
      await window.until(()=>document.querySelector('#references').textContent==='1');
      return {cancelled,menuGone:!document.querySelector('[role="menu"]'),calls:window.calls.length};
    `)
    expect(result).toEqual({ cancelled: true, menuGone: true, calls: 0 })
  }, 30_000)

  test('When 使用标准 click 事件点击按钮 Then 正确打开菜单并可触发选择文件', async () => {
    const result = await renderer.run(`
      const trigger = document.querySelector('[aria-label="添加附件或引用对话"]');
      trigger.click();
      await window.until(() => document.querySelector('[role="menuitem"]'));
      document.querySelector('[role="menuitem"]').click();
      await window.until(() => window.calls.length === 1 && document.querySelector('#files').textContent.includes('测试附件.txt'));
      return { calls: window.calls, files: document.querySelector('#files').textContent };
    `)
    expect(result).toEqual({ calls: [{ menuGone: true, unblocked: true }], files: '测试附件.txt' })
  }, 30_000)
})
