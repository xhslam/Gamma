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
  `, {
    // Chromium 原生输入保留真实 pointerdown → pointerup → click 顺序与 detail 值。
    mainProcessSetup: String.raw`
      const { ipcMain } = require('electron')
      ipcMain.handle('composer-native-input', async (event, input) => {
        const position = { x: input.x, y: input.y }
        event.sender.sendInputEvent({ type: 'mouseMove', ...position })
        await new Promise(resolve => setTimeout(resolve, 30))
        event.sender.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 })
        await new Promise(resolve => setTimeout(resolve, input.holdMs ?? 60))
        event.sender.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 })
      })
      ipcMain.handle('composer-native-key', async (event, keyCode) => {
        event.sender.sendInputEvent({ type: 'keyDown', keyCode })
        await new Promise(resolve => setTimeout(resolve, 40))
        event.sender.sendInputEvent({ type: 'keyUp', keyCode })
      })
    `,
    preloadSource: String.raw`
      const { contextBridge, ipcRenderer } = require('electron')
      contextBridge.exposeInMainWorld('composerNativeInput', input => ipcRenderer.invoke('composer-native-input', input))
      contextBridge.exposeInMainWorld('composerNativeKey', keyCode => ipcRenderer.invoke('composer-native-key', keyCode))
    `,
  })
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
      await window.until(()=>document.querySelector('.carpus-composer-footer'));
      document.querySelector('.carpus-composer-footer').style.width='100px';
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

  // 覆盖不同按压时长：开合判定不得依赖 pointerdown 与 click 之间的时间窗口。
  for (const holdMs of [60, 240, 600]) {
    test(`When 用真实鼠标按住 ${holdMs}ms 再点击 Then 菜单保持打开且能选择文件`, async () => {
      const result = await renderer.run(`
        await window.until(()=>document.querySelector('[aria-label="添加附件或引用对话"]'));
        const trigger=document.querySelector('[aria-label="添加附件或引用对话"]');
        const box=trigger.getBoundingClientRect();
        await window.composerNativeInput({x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2),holdMs:${holdMs}});
        await window.wait(400);
        const opened=trigger.getAttribute('aria-expanded')==='true'&&!!document.querySelector('[role="menuitem"]');
        if(!opened)return {opened,calls:window.calls.length};
        const item=document.querySelector('[role="menuitem"]'),itemBox=item.getBoundingClientRect();
        await window.composerNativeInput({x:Math.round(itemBox.x+itemBox.width/2),y:Math.round(itemBox.y+itemBox.height/2),holdMs:${holdMs}});
        await window.until(()=>window.calls.length===1&&document.querySelector('#files').textContent.includes('测试附件.txt'));
        return {opened,calls:window.calls};
      `)
      expect(result).toEqual({ opened: true, calls: [{ menuGone: true, unblocked: true }] })
    }, 30_000)
  }

  test('When 用真实键盘 Enter 与 Space 激活 Then 都能开合菜单', async () => {
    const result = await renderer.run(`
      await window.until(()=>document.querySelector('[aria-label="添加附件或引用对话"]'));
      const trigger=document.querySelector('[aria-label="添加附件或引用对话"]');
      const states=[];
      for(const keyCode of ['Enter','Enter','Space','Space']){
        trigger.focus();
        await window.wait(60);
        await window.composerNativeKey(keyCode);
        await window.wait(350);
        states.push(trigger.getAttribute('aria-expanded'));
      }
      return states;
    `)
    expect(result).toEqual(['true', 'false', 'true', 'false'])
  }, 30_000)

  // 辅助技术/自动化先发 pointerdown 再发 detail=0 的 click；旧的 200ms 标记过期后会补发
  // pointerdown，把刚打开的菜单又关掉，表现为「+ 号点了没反应」。
  for (const gapMs of [0, 150, 500]) {
    test(`When pointerdown 与合成 click 相隔 ${gapMs}ms Then 菜单仍然打开且只开一次选择器`, async () => {
      const result = await renderer.run(`
        await window.until(()=>document.querySelector('[aria-label="添加附件或引用对话"]'));
        const trigger=document.querySelector('[aria-label="添加附件或引用对话"]');
        const before=window.calls.length;
        trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse',button:0,ctrlKey:false}));
        await window.wait(${gapMs});
        trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:0}));
        await window.wait(400);
        const opened=trigger.getAttribute('aria-expanded')==='true'&&!!document.querySelector('[role="menuitem"]');
        if(!opened)return {opened,dialogs:window.calls.length-before};
        document.querySelector('[role="menuitem"]').click();
        await window.until(()=>window.calls.length===before+1);
        return {opened,dialogs:window.calls.length-before};
      `)
      expect(result).toEqual({ opened: true, dialogs: 1 })
    }, 30_000)
  }
})
