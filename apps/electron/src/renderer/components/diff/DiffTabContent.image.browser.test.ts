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
    preloadSource: `
      const { contextBridge } = require('electron');
      const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="blue"/></svg>');
      contextBridge.exposeInMainWorld('electronAPI',{
        resolveAndReadFile:async()=>({resolvedPath:'/tmp/reference.png',content:'',isBinary:false,isTooLarge:false}),
        resolveFilePath:async()=>({url:src,resolvedPath:'/tmp/reference.png'}),
        getDefaultAppForFile:async()=>null,
      });
    `,
  })
}, 90_000)

afterAll(async () => { await renderer?.dispose() })

describe('Given 输入框 @ 图片在右侧文件预览中打开', () => {
  test('When 使用五项高级编辑 Then 在当前侧边栏完成操作并回填当前会话', async () => {
    const result = await renderer.run(`
      const wait=()=>new Promise(resolve=>setTimeout(resolve,300));await wait();
      const click=(label)=>{const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent===label||item.title===label||item.getAttribute('aria-label')===label);if(!button)throw new Error('按钮不存在:'+label);button.click();};
      const labels=['标注','添加评论','移除背景','擦除','调整大小'];
      const entriesVisible=labels.every(label=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent===label));
      if(!entriesVisible)throw new Error('图片编辑入口未渲染:'+document.body.textContent+' 运行错误:'+window.runtimeError);
      const originalSrc=document.querySelector('img[alt="reference.png"]')?.src;

      click('标注');await wait();
      const canvas=document.querySelector('[data-image-inline-editor] canvas');
      const annotationOpened=!!canvas&&!document.querySelector('[role="dialog"]');
      if(!canvas)throw new Error('侧边栏标注画布未打开');
      canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;canvas.releasePointerCapture=()=>{};
      const canvasBounds=canvas.getBoundingClientRect();
      const pointer=(type,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,isPrimary:true,button:0,clientX:canvasBounds.left+x,clientY:canvasBounds.top+y}));
      const beforeDraw=canvas.toDataURL();
      pointer('pointerdown',canvasBounds.width*0.3,canvasBounds.height*0.3);
      pointer('pointermove',canvasBounds.width*0.45,canvasBounds.height*0.4);
      pointer('pointerup',canvasBounds.width*0.45,canvasBounds.height*0.4);await wait();
      const annotationDrawn=canvas.toDataURL()!==beforeDraw;
      click('取消编辑');await wait();

      click('移除背景');await wait();
      const backgroundOpened=Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='自动移除');
      click('取消编辑');await wait();

      click('擦除');await wait();
      const eraseOpened=!!document.querySelector('input[aria-label="擦除大小"]');
      click('取消编辑');await wait();

      click('调整大小');await wait();
      const resizeOpened=Array.from(document.querySelectorAll('button')).some(button=>button.textContent?.includes('16:9'));
      click('取消编辑');await wait();

      click('添加评论');await wait();
      const commentImage=document.querySelector('[data-image-inline-editor] img[alt="点击添加位置评论"]');
      const commentInline=!!commentImage&&!document.querySelector('[role="dialog"]');
      if(!commentImage)throw new Error('位置评论编辑器未在侧边栏打开');
      const bounds=commentImage.getBoundingClientRect();
      commentImage.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:bounds.left+bounds.width*0.25,clientY:bounds.top+bounds.height*0.5}));
      await wait();
      const textarea=document.querySelector('textarea[aria-label="位置评论内容"]');
      if(!textarea)throw new Error('评论输入框不存在');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'在标题左侧增加标记');
      textarea.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      click('完成评论');await wait();

      const pendingAfterComment=document.getElementById('pending-files').textContent;
      const commentAttached=pendingAfterComment.includes('reference-edited-')&&pendingAfterComment.endsWith('.png');
      const commentPrompt=document.getElementById('draft').textContent;
      const promptAttached=commentPrompt.includes('在标题左侧增加标记')&&/[(]x: [0-9.]+%, y: [0-9.]+%[)]/.test(commentPrompt);
      const binaryAttached=window.__pendingAgentFileData?.size===1&&document.getElementById('pending-url').textContent.startsWith('data:image/png');
      const originalPreserved=document.querySelector('img[alt="reference.png"]')?.src===originalSrc;

      click('标注');await wait();click('保存');await wait();
      const annotationAttached=document.getElementById('pending-files').textContent.split(',').filter(Boolean).length===2;
      const notAutoSent=!document.querySelector('[role="dialog"]')&&window.__pendingAgentFileData?.size===2;

      return {entriesVisible,annotationOpened,annotationDrawn,commentInline,backgroundOpened,eraseOpened,resizeOpened,commentAttached,promptAttached,binaryAttached,originalPreserved,annotationAttached,notAutoSent};
    `)
    expect(result).toEqual({
      entriesVisible: true,
      annotationOpened: true,
      annotationDrawn: true,
      commentInline: true,
      backgroundOpened: true,
      eraseOpened: true,
      resizeOpened: true,
      commentAttached: true,
      promptAttached: true,
      binaryAttached: true,
      originalPreserved: true,
      annotationAttached: true,
      notAutoSent: true,
    })
  }, 60_000)
})
