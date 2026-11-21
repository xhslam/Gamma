import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { useAtomValue } from 'jotai';
    import { DiffTabContent } from '@/components/diff/DiffTabContent';
    import { TooltipProvider } from '@/components/ui/tooltip';
    import { agentPendingFilesAtomFamily, agentSessionDraftsAtom } from '@/atoms/agent-atoms';
    import '@/styles/globals.css';
    const sessionId='session-image-preview';
    function SessionState(){
      const files=useAtomValue(agentPendingFilesAtomFamily(sessionId));
      const drafts=useAtomValue(agentSessionDraftsAtom);
      return React.createElement(React.Fragment,null,
        React.createElement('output',{id:'pending-files'},files.map(file=>file.filename).join(',')),
        React.createElement('output',{id:'draft'},drafts.get(sessionId)??''),
        React.createElement('output',{id:'pending-url'},files[0]?.previewUrl??''),
      );
    }
    function App(){
      return React.createElement(TooltipProvider,null,
        React.createElement('div',{style:{height:'540px'}},React.createElement(DiffTabContent,{
          filePath:'reference.png',dirPath:'/tmp',sessionId,previewOnly:true,readOnly:true,
          imageEditorPresentation:'inline',
        })),
        React.createElement(SessionState),
      );
    }
    window.addEventListener('error',event=>{window.runtimeError=event.message;});
    window.addEventListener('unhandledrejection',event=>{window.runtimeError=String(event.reason);});
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `, {
    timeoutMs: 60_000,
    mainProcessSetup: `
      const { ipcMain } = require('electron');
      ipcMain.handle('test:native-pointer',(event,type,x,y)=>{
        event.sender.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
      });
    `,
    preloadSource: `
      const { contextBridge, ipcRenderer } = require('electron');
      const originalSrc='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="blue"/></svg>');
      let currentSrc=originalSrc;
      let imageWriteAttempts=0;
      let imageWrites=[];
      let failNextImageWrite=false;
      contextBridge.exposeInMainWorld('imageTestState',{
        getAttempts:()=>imageWriteAttempts,
        getWrites:()=>[...imageWrites],
        setFailure:value=>{failNextImageWrite=value;},
      });
      contextBridge.exposeInMainWorld('electronAPI',{
        resolveAndReadFile:async()=>({resolvedPath:'/tmp/reference.png',content:'',isBinary:false,isTooLarge:false}),
        resolveFilePath:async()=>({url:currentSrc,resolvedPath:'/tmp/reference.png'}),
        writeImageFile:async(_filePath,dataUrl)=>{
          imageWriteAttempts+=1;
          await new Promise(resolve=>setTimeout(resolve,150));
          if(failNextImageWrite)throw new Error('模拟磁盘写入失败');
          currentSrc=dataUrl;
          imageWrites.push(dataUrl);
        },
        getDefaultAppForFile:async()=>null,
      });
      contextBridge.exposeInMainWorld('nativePointer',(type,x,y)=>ipcRenderer.invoke('test:native-pointer',type,x,y));
    `,
  })
}, 90_000)

afterAll(async () => { await renderer?.dispose() })

describe('Given 输入框 @ 图片在右侧文件预览中打开', () => {
  test('When 绘制、缩放、保存失败重试及位置评论 Then 真实导出并写回预览且评论不覆盖原图', async () => {
    const result = await renderer.run(`
      const wait=()=>new Promise(resolve=>setTimeout(resolve,300));await wait();
      const click=(label)=>{const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent===label||item.textContent?.includes(label)||item.title===label||item.getAttribute('aria-label')===label);if(!button)throw new Error('按钮不存在:'+label);button.click();};
      const setInput=(selector,value)=>{const input=document.querySelector(selector);if(!input)throw new Error('输入框不存在:'+selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      const native=async(type,x,y)=>{await window.nativePointer(type,x,y);await wait();};
      const labels=['标注','添加评论','移除背景','擦除','调整大小'];
      const entriesVisible=labels.every(label=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent===label));
      if(!entriesVisible)throw new Error('图片编辑入口未渲染:'+document.body.textContent+' 运行错误:'+window.runtimeError);

      click('标注');await wait();
      const canvas=document.querySelector('[data-image-inline-editor] canvas');
      const annotationOpened=!!canvas&&!document.querySelector('[role="dialog"]');
      if(!canvas)throw new Error('侧边栏标注画布未打开');
      const canvasBounds=canvas.getBoundingClientRect();
      const beforeDraw=canvas.toDataURL();
      await native('mouseDown',canvasBounds.left+canvasBounds.width*0.3,canvasBounds.top+canvasBounds.height*0.3);
      await native('mouseMove',canvasBounds.left+canvasBounds.width*0.45,canvasBounds.top+canvasBounds.height*0.4);
      await native('mouseUp',canvasBounds.left+canvasBounds.width*0.45,canvasBounds.top+canvasBounds.height*0.4);
      const annotationDrawn=canvas.toDataURL()!==beforeDraw;
      click('取消编辑');await wait();

      click('移除背景');await wait();
      const backgroundCanvas=document.querySelector('[data-image-inline-editor] canvas');
      const backgroundOpened=Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='自动移除');
      const beforeBackground=backgroundCanvas.toDataURL();click('自动移除');await wait();
      const backgroundRemoved=backgroundCanvas.toDataURL()!==beforeBackground;
      click('取消编辑');await wait();
      click('擦除');await wait();
      const eraseOpened=!!document.querySelector('input[aria-label="擦除大小"]');
      const eraseCanvas=document.querySelector('[data-image-inline-editor] canvas');
      const eraseBounds=eraseCanvas.getBoundingClientRect();const beforeErase=eraseCanvas.toDataURL();
      await native('mouseDown',eraseBounds.left+eraseBounds.width*0.45,eraseBounds.top+eraseBounds.height*0.45);
      await native('mouseMove',eraseBounds.left+eraseBounds.width*0.55,eraseBounds.top+eraseBounds.height*0.55);
      await native('mouseUp',eraseBounds.left+eraseBounds.width*0.55,eraseBounds.top+eraseBounds.height*0.55);
      const erased=eraseCanvas.toDataURL()!==beforeErase;
      click('取消编辑');await wait();

      click('调整大小');await wait();
      const widthInput=document.querySelector('input[aria-label="图片宽度（像素）"]');
      const heightInput=document.querySelector('input[aria-label="图片高度（像素）"]');
      const resizeOpened=widthInput?.value==='1200'&&heightInput?.value==='800';
      setInput('input[aria-label="图片宽度（像素）"]','600');await wait();
      const ratioLocked=document.querySelector('input[aria-label="图片高度（像素）"]')?.value==='400';
      click('应用尺寸');await wait();click('保存');
      await new Promise(resolve=>setTimeout(resolve,30));
      const savingVisible=Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='保存中…'&&button.disabled);
      await wait();await wait();
      const firstWrite=(await window.imageTestState.getWrites())[0];
      if(!firstWrite)throw new Error('首次图片保存没有生成导出内容:'+JSON.stringify({attempts:await window.imageTestState.getAttempts(),ratioLocked,savingVisible,inline:!!document.querySelector('[data-image-inline-editor]'),body:document.body.textContent.slice(-500),runtimeError:window.runtimeError}));
      const exportedSize=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error('无法读取首次导出的图片'));image.src=firstWrite;});
      const preview=document.querySelector('img[alt="reference.png"]');
      const writeRefreshedPreview=!!preview&&preview.src===firstWrite;
      const resizeClosed=!document.querySelector('[data-image-inline-editor]');
      const resizeDidNotAttach=!document.getElementById('pending-files').textContent;

      click('标注');await wait();await window.imageTestState.setFailure(true);click('保存');await wait();await wait();
      const failureVisible=document.body.textContent.includes('保存失败：模拟磁盘写入失败');
      const failureKeptEditor=!!document.querySelector('[data-image-inline-editor]');
      const failurePreservedPreview=document.querySelector('img[alt="reference.png"]')?.src===firstWrite;
      await window.imageTestState.setFailure(false);click('保存');await wait();await wait();
      const retrySucceeded=(await window.imageTestState.getWrites()).length===2&&(await window.imageTestState.getAttempts())===3&&!document.querySelector('[data-image-inline-editor]');
      const srcBeforeComment=document.querySelector('img[alt="reference.png"]')?.src;

      click('添加评论');await wait();
      const commentImage=document.querySelector('[data-image-inline-editor] img[alt="点击添加位置评论"]');
      const commentInline=!!commentImage&&!document.querySelector('[role="dialog"]');
      if(!commentImage)throw new Error('位置评论编辑器未在侧边栏打开');
      const bounds=commentImage.getBoundingClientRect();
      await native('mouseDown',bounds.left+bounds.width*0.25,bounds.top+bounds.height*0.5);
      await native('mouseUp',bounds.left+bounds.width*0.25,bounds.top+bounds.height*0.5);
      const textarea=document.querySelector('textarea[aria-label="位置评论内容"]');
      if(!textarea)throw new Error('评论输入框不存在');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'在标题左侧增加标记');
      textarea.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      click('完成评论');await wait();await wait();

      const pendingAfterComment=document.getElementById('pending-files').textContent;
      const commentAttached=pendingAfterComment.includes('reference-comments-')&&pendingAfterComment.endsWith('.png');
      const commentPrompt=document.getElementById('draft').textContent;
      const promptAttached=commentPrompt.includes('在标题左侧增加标记')&&/[(]x: [0-9.]+%, y: [0-9.]+%[)]/.test(commentPrompt);
      const binaryAttached=window.__pendingAgentFileData?.size===1&&document.getElementById('pending-url').textContent.startsWith('data:image/png');
      const commentPreservedFile=(await window.imageTestState.getWrites()).length===2&&document.querySelector('img[alt="reference.png"]')?.src===srcBeforeComment;
      const notAutoSent=!document.querySelector('[role="dialog"]');

      return {entriesVisible,annotationOpened,annotationDrawn,backgroundOpened,backgroundRemoved,eraseOpened,erased,resizeOpened,ratioLocked,savingVisible,exportedSize,writeRefreshedPreview,resizeClosed,resizeDidNotAttach,failureVisible,failureKeptEditor,failurePreservedPreview,retrySucceeded,commentInline,commentAttached,promptAttached,binaryAttached,commentPreservedFile,notAutoSent};
    `)
    expect(result).toEqual({
      entriesVisible: true,
      annotationOpened: true,
      annotationDrawn: true,
      backgroundOpened: true,
      backgroundRemoved: true,
      eraseOpened: true,
      erased: true,
      resizeOpened: true,
      ratioLocked: true,
      savingVisible: true,
      exportedSize: { width: 600, height: 400 },
      writeRefreshedPreview: true,
      resizeClosed: true,
      resizeDidNotAttach: true,
      failureVisible: true,
      failureKeptEditor: true,
      failurePreservedPreview: true,
      retrySucceeded: true,
      commentInline: true,
      commentAttached: true,
      promptAttached: true,
      binaryAttached: true,
      commentPreservedFile: true,
      notAutoSent: true,
    })
  }, 60_000)
})
