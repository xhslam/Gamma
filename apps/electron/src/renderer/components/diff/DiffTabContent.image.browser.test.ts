import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { buildSync } from 'esbuild'
import { PNG } from 'pngjs'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  const imageServices = buildSync({
    stdin: {
      contents: "export * from './local-file-protocol'; export * from './image-file-write-service';",
      resolveDir: `${import.meta.dir}/../../../main/lib`,
    },
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false,
  }).outputFiles[0]!.text
  const fixture = new PNG({ width: 1200, height: 800 })
  for (let y = 0; y < fixture.height; y += 1) {
    for (let x = 0; x < fixture.width; x += 1) {
      const offset = (y * fixture.width + x) * 4
      const foreground = x >= 400 && x < 800 && y >= 240 && y < 600
      fixture.data[offset + 1] = foreground ? 255 : 0
      fixture.data[offset + 2] = foreground ? 0 : 255
      fixture.data[offset + 3] = 255
    }
  }
  const png = PNG.sync.write(fixture).toString('base64')
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { getDefaultStore, useAtomValue } from 'jotai';
    import { DiffTabContent } from '@/components/diff/DiffTabContent';
    import { TooltipProvider } from '@/components/ui/tooltip';
    import { agentChannelIdAtom, agentModelIdAtom, agentPendingFilesAtomFamily, agentSessionDraftsAtom } from '@/atoms/agent-atoms';
    import '@/styles/globals.css';
    const sessionId='session-image-preview';
    const store=getDefaultStore();
    store.set(agentChannelIdAtom,'test-channel');
    store.set(agentModelIdAtom,'text-only');
    window.selectImageTestModel=id=>store.set(agentModelIdAtom,id);
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
      const { ipcMain, protocol } = require('electron');
      const fs = require('node:fs');
      const path = require('node:path');
      const services = { exports: {} };
      new Function('require', 'module', 'exports', ${JSON.stringify(imageServices)})(require, services, services.exports);
      const { registerGammaFilePath, handleGammaFileRequest, readImageForEdit, writeRasterImageFile } = services.exports;
      protocol.registerSchemesAsPrivileged([{ scheme: 'gamma-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
      const fixturePath = () => path.join(app.getPath('userData'), 'reference.png');
      ipcMain.handle('test:image-url', () => {
        const file = fixturePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(${JSON.stringify(png)}, 'base64'));
        return { url: registerGammaFilePath(file), resolvedPath: file };
      });
      ipcMain.handle('test:read-image', (_event, file) => readImageForEdit(file));
      ipcMain.handle('test:write-image', (_event, file, dataUrl) => writeRasterImageFile(file, dataUrl));
      ipcMain.handle('test:native-pointer',(event,type,x,y)=>{
        event.sender.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
      });
    `,
    mainProcessReady: `protocol.handle('gamma-file', handleGammaFileRequest);`,
    preloadSource: `
      const { contextBridge, ipcRenderer } = require('electron');
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
        resolveFilePath:async()=>ipcRenderer.invoke('test:image-url'),
        readImageForEdit:file=>ipcRenderer.invoke('test:read-image',file),
        getPiImageInputSupport:async(channel,model)=>channel==='test-channel'&&model==='image-model',
        writeImageFile:async(filePath,dataUrl)=>{
          imageWriteAttempts+=1;
          await new Promise(resolve=>setTimeout(resolve,150));
          if(failNextImageWrite)throw new Error('模拟磁盘写入失败');
          await ipcRenderer.invoke('test:write-image',filePath,dataUrl);
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
  test('When 编辑图片并在多个位置评论 Then 写回像素、保存后可重试且标记与评论坐标对齐', async () => {
    const result = await renderer.run(`
      const wait=()=>new Promise(resolve=>setTimeout(resolve,300));await wait();
      const click=(label)=>{const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent===label||item.textContent?.includes(label)||item.title===label||item.getAttribute('aria-label')===label);if(!button)throw new Error('按钮不存在:'+label);button.click();};
      const setInput=(selector,value)=>{const input=document.querySelector(selector);if(!input)throw new Error('输入框不存在:'+selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      const native=async(type,x,y)=>{await window.nativePointer(type,x,y);await wait();};
      const readPixels=async(src)=>{
        const image=new Image();image.src=src;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,canvas.width,canvas.height);
      };
      const preview=()=>document.querySelector('img[alt="reference.png"]');
      const hasComments=()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='添加评论');
      const commentHiddenForTextModel=!hasComments();
      const protocolUrl=preview()?.src;
      let protocolCanvasTainted=false;
      try{await readPixels(protocolUrl);}catch(error){protocolCanvasTainted=error.name==='SecurityError';}
      window.selectImageTestModel('image-model');await wait();
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
      click('保存');await wait();await wait();
      const marked=await readPixels((await window.imageTestState.getWrites())[0]);
      const annotationOnDisk=marked.data.some((value,index)=>index%4===0&&value>200&&marked.data[index+1]<100);

      click('移除背景');await wait();
      const backgroundCanvas=document.querySelector('[data-image-inline-editor] canvas');
      const backgroundOpened=Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='自动移除');
      const beforeBackground=backgroundCanvas.toDataURL();click('自动移除');await wait();
      const backgroundRemoved=backgroundCanvas.toDataURL()!==beforeBackground;
      click('保存');await wait();await wait();
      const cutout=await readPixels((await window.imageTestState.getWrites())[1]);
      const centerOffset=(400*cutout.width+600)*4;
      const backgroundAlphaOnDisk=cutout.data[3]===0&&cutout.data[centerOffset+1]===255&&cutout.data[centerOffset+3]===255;
      click('擦除');await wait();
      const eraseOpened=!!document.querySelector('input[aria-label="擦除大小"]');
      const eraseCanvas=document.querySelector('[data-image-inline-editor] canvas');
      const eraseBounds=eraseCanvas.getBoundingClientRect();const beforeErase=eraseCanvas.toDataURL();
      await native('mouseDown',eraseBounds.left+eraseBounds.width*0.5,eraseBounds.top+eraseBounds.height*0.5);
      await native('mouseUp',eraseBounds.left+eraseBounds.width*0.5,eraseBounds.top+eraseBounds.height*0.5);
      const erased=eraseCanvas.toDataURL()!==beforeErase;
      click('保存');await wait();await wait();
      const erasedPixels=await readPixels((await window.imageTestState.getWrites())[2]);
      const eraseDotOnDisk=erasedPixels.data[centerOffset+3]===0&&erasedPixels.data[centerOffset+100*4+3]===255;

      click('调整大小');await wait();
      const widthInput=document.querySelector('input[aria-label="图片宽度（像素）"]');
      const heightInput=document.querySelector('input[aria-label="图片高度（像素）"]');
      const resizeOpened=widthInput?.value==='1200'&&heightInput?.value==='800';
      setInput('input[aria-label="图片宽度（像素）"]','0');await wait();click('保存');await wait();
      const invalidSizeBlocked=(await window.imageTestState.getAttempts())===3&&document.body.textContent.includes('尺寸须为');
      setInput('input[aria-label="图片宽度（像素）"]','600');await wait();
      const ratioLocked=document.querySelector('input[aria-label="图片高度（像素）"]')?.value==='400';
      click('保存');
      await new Promise(resolve=>setTimeout(resolve,30));
      const savingVisible=Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='保存中…'&&button.disabled);
      await wait();await wait();
      const firstWrite=(await window.imageTestState.getWrites())[3];
      if(!firstWrite)throw new Error('首次图片保存没有生成导出内容:'+JSON.stringify({attempts:await window.imageTestState.getAttempts(),ratioLocked,savingVisible,inline:!!document.querySelector('[data-image-inline-editor]'),body:document.body.textContent.slice(-500),runtimeError:window.runtimeError}));
      const exportedSize=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error('无法读取首次导出的图片'));image.src=firstWrite;});
      const resizedPreviewSrc=preview()?.src;
      const writeRefreshedPreview=preview()?.naturalWidth===600&&preview()?.naturalHeight===400;
      const resizeClosed=!document.querySelector('[data-image-inline-editor]');
      const resizeDidNotAttach=!document.getElementById('pending-files').textContent;

      click('标注');await wait();await window.imageTestState.setFailure(true);click('保存');await wait();await wait();
      const failureVisible=document.body.textContent.includes('保存失败：模拟磁盘写入失败');
      const failureKeptEditor=!!document.querySelector('[data-image-inline-editor]');
      const failurePreservedPreview=preview()?.src===resizedPreviewSrc;
      await window.imageTestState.setFailure(false);click('保存');await wait();await wait();
      const retrySucceeded=(await window.imageTestState.getWrites()).length===5&&(await window.imageTestState.getAttempts())===6&&!document.querySelector('[data-image-inline-editor]');
      const srcBeforeComment=document.querySelector('img[alt="reference.png"]')?.src;

      click('添加评论');await wait();
      const commentImage=document.querySelector('[data-image-inline-editor] img[alt="点击添加位置评论"]');
      const commentInline=!!commentImage&&!document.querySelector('[role="dialog"]');
      if(!commentImage)throw new Error('位置评论编辑器未在侧边栏打开');
      const commentAt=async(x,y,text)=>{
        const bounds=commentImage.getBoundingClientRect();
        await native('mouseDown',bounds.left+bounds.width*x,bounds.top+bounds.height*y);
        await native('mouseUp',bounds.left+bounds.width*x,bounds.top+bounds.height*y);
        const textarea=document.querySelector('textarea[aria-label="位置评论内容"]');
        if(!textarea)throw new Error('评论输入框不存在');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,text);
        textarea.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      };
      await commentAt(0.25,0.5,'在标题左侧增加标记');
      await commentAt(0.78,0.82,'替换右下角的按钮');
      const numbersBeforeSave=[...document.querySelectorAll('button[aria-label^="评论 "]')].map(button=>button.textContent).join(',');
      click('完成评论');await wait();await wait();

      const pendingAfterComment=document.getElementById('pending-files').textContent;
      const commentAttached=pendingAfterComment.includes('reference-comments-')&&pendingAfterComment.endsWith('.png');
      const commentPrompt=document.getElementById('draft').textContent;
      const positions=Array.from(commentPrompt.matchAll(/([0-9]+)[.] [(]x: ([0-9.]+)%, y: ([0-9.]+)%[)] (.+)/g),match=>({ number:Number(match[1]),x:Number(match[2]),y:Number(match[3]),text:match[4] }));
      const near=(a,b)=>Math.abs(a-b)<1;
      const promptAttached=commentPrompt.includes(pendingAfterComment)
        &&positions.length===2&&positions[0].number===1&&positions[1].number===2
        &&near(positions[0].x,25)&&near(positions[0].y,50)&&positions[0].text==='在标题左侧增加标记'
        &&near(positions[1].x,78)&&near(positions[1].y,82)&&positions[1].text==='替换右下角的按钮';
      const pendingUrl=document.getElementById('pending-url').textContent;
      const binaryAttached=window.__pendingAgentFileData?.size===1&&pendingUrl.startsWith('data:image/png');
      const pixels=await readPixels(pendingUrl);
      const markersMatch=numbersBeforeSave==='1,2'&&positions.every(({x,y})=>{
        const offset=(Math.round(y*pixels.height/100)*pixels.width+Math.round(x*pixels.width/100)+8)*4;
        return pixels.data[offset]===40&&pixels.data[offset+1]===125&&pixels.data[offset+2]===120&&pixels.data[offset+3]===255;
      });
      const commentPreservedFile=(await window.imageTestState.getWrites()).length===5&&document.querySelector('img[alt="reference.png"]')?.src===srcBeforeComment;
      const notAutoSent=!document.querySelector('[role="dialog"]');

      return {protocolCanvasTainted,commentHiddenForTextModel,entriesVisible,annotationOpened,annotationDrawn,annotationOnDisk,backgroundOpened,backgroundRemoved,backgroundAlphaOnDisk,eraseOpened,erased,eraseDotOnDisk,resizeOpened,invalidSizeBlocked,ratioLocked,savingVisible,exportedSize,writeRefreshedPreview,resizeClosed,resizeDidNotAttach,failureVisible,failureKeptEditor,failurePreservedPreview,retrySucceeded,commentInline,commentAttached,promptAttached,binaryAttached,markersMatch,commentPreservedFile,notAutoSent};
    `)
    expect(result).toEqual({
      protocolCanvasTainted: true,
      commentHiddenForTextModel: true,
      entriesVisible: true,
      annotationOpened: true,
      annotationDrawn: true,
      annotationOnDisk: true,
      backgroundOpened: true,
      backgroundRemoved: true,
      backgroundAlphaOnDisk: true,
      eraseOpened: true,
      erased: true,
      eraseDotOnDisk: true,
      resizeOpened: true,
      invalidSizeBlocked: true,
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
      markersMatch: true,
      commentPreservedFile: true,
      notAutoSent: true,
    })
  }, 60_000)
})
