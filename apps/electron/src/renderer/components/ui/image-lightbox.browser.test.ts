import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { ImageLightbox } from '@/components/ui/image-lightbox';
    import '@/styles/globals.css';
    const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="blue"/></svg>');
    const completeEdit=async(url,prompt)=>{await new Promise(resolve=>setTimeout(resolve,50));if(window.failLightboxSave)throw new Error('模拟写回失败');window.edited=url;window.editedPrompt=prompt;};
    function App(){const [open,setOpen]=React.useState(false),[index,setIndex]=React.useState(0);
      return React.createElement(React.Fragment,null,
        React.createElement('button',{id:'opener',onClick:()=>setOpen(true)},'打开'),
        React.createElement(ImageLightbox,{open,onOpenChange:setOpen,index,onIndexChange:setIndex,outputMimeType:window.lightboxMime,images:[{src,alt:'第一张',onSave:()=>{window.saved=(window.saved||0)+1},onEditComplete:completeEdit},{src,alt:'第二张',onSave:()=>{window.saved=(window.saved||0)+1},onEditComplete:completeEdit}]}));}
    const root=createRoot(document.getElementById('root'));root.render(React.createElement(App));window.unmountLightbox=()=>root.unmount();
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

const setup = `
  const wait=()=>new Promise(r=>setTimeout(r,250));await wait();
  const click=(label)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===label||b.title===label||b.textContent===label);if(!b)throw new Error('按钮不存在:'+label);b.click();};
  const opener=document.getElementById('opener');opener.focus();opener.click();await wait();
  const stage=()=>document.querySelector('[data-image-viewport]');
  const img=()=>stage().querySelector('img');
  const matrix=()=>new DOMMatrix(getComputedStyle(img()).transform);
`
describe('Given Chromium 中真实 Radix 图片预览', () => {
  test('When 指针缩放、拖动及取消 Then 锚点正确、边界不露白且手势清理', async () => {
    const result = await renderer.run(`${setup}
      const bounds=stage().getBoundingClientRect();const image=img();
      stage().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-350,clientX:bounds.x+bounds.width/2+40,clientY:bounds.y+bounds.height/2}));await wait();
      const zoomed=matrix(),anchor=Math.abs(zoomed.e-40*(1-zoomed.a))<1;
      const pointer=(type,x,y)=>stage().dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y}));
      // 合成事件没有真实活动指针，模拟原生 capture 的生命周期；几何和事件均运行于真实 Chromium。
      stage().setPointerCapture=()=>{};stage().hasPointerCapture=()=>false;
      pointer('pointerdown',100,100);pointer('pointermove',10000,10000);await wait();
      const moved=matrix(),bounded=Math.abs(moved.e)<=Math.max(0,(image.offsetWidth*moved.a-stage().clientWidth)/2)+1&&Math.abs(moved.f)<=Math.max(0,(image.offsetHeight*moved.a-stage().clientHeight)/2)+1;
      pointer('pointercancel',10000,10000);pointer('pointermove',-10000,-10000);await wait();const cancelled=matrix().e===moved.e;
      click('适应窗口');await wait();pointer('pointerdown',100,100);pointer('pointermove',300,300);await wait();
      return {anchor,bounded,cancelled,reset:matrix().a===1&&matrix().e===0&&matrix().f===0};
    `)
    expect(result).toEqual({ anchor: true, bounded: true, cancelled: true, reset: true })
  }, 30_000)
  test('When 切图、编辑取消、关闭重开 Then 预览复位、编辑隔离且焦点恢复', async () => {
    const result = await renderer.run(`${setup}
      click('放大图片');await wait();click('下一张');await wait();const switched=matrix().a===1&&img().alt==='第二张';
      click('放大图片');await wait();click('标注');await wait();const isolated=!stage()&&!!document.querySelector('canvas');
      const before=document.querySelector('[role=dialog]').textContent;window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await wait();const noNav=before===document.querySelector('[role=dialog]').textContent;
      const cancel=Array.from(document.querySelectorAll('button')).find(b=>b.title==='取消编辑'||b.title==='取消'||b.textContent.includes('取消'));if(!cancel)throw new Error('未找到取消按钮');cancel.click();await wait();const editReset=matrix().a===1&&!document.querySelector('canvas');
      click('关闭');await wait();const restored=document.activeElement===opener&&!document.querySelector('[role=dialog]');
      opener.click();await wait();click('放大图片');await wait();window.dispatchEvent(new Event('resize'));stage().style.width='70vw';await wait();const resized=matrix().a===1;
      click('关闭');await wait();opener.click();await wait();const reopened=matrix().a===1&&document.querySelectorAll('[role=dialog]').length===1;
      return {switched,isolated,noNav,editReset,restored,resized,reopened};
    `)
    expect(result).toEqual({ switched: true, isolated: true, noNav: true, editReset: true, restored: true, resized: true, reopened: true })
  }, 30_000)
  test('When 使用高级编辑与位置评论 Then 五项入口、比例、背景历史和坐标回填均生效', async () => {
    const result = await renderer.run(`${setup}
      const labels=['标注','添加评论','移除背景','擦除','调整大小'];
      const visible=labels.every(label=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent===label));
      click('调整大小');await wait();
      const ratio=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('16:9'));if(!ratio)throw new Error('缺少 16:9');ratio.click();await wait();
      const apply=Array.from(document.querySelectorAll('button')).find(b=>b.title==='应用比例');const ratioReady=!!apply;apply?.click();await wait();
      const ratioApplied=!Array.from(document.querySelectorAll('button')).some(b=>b.title==='应用比例')&&!!document.querySelector('canvas');
      click('取消编辑');await wait();click('移除背景');await wait();
      const auto=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='自动移除');if(!auto)throw new Error('缺少自动移除');auto.click();await wait();
      const removed=Array.from(document.querySelectorAll('[role=status]')).some(node=>node.textContent?.includes('已移除'));
      const undoButton=Array.from(document.querySelectorAll('button')).find(b=>b.title==='撤销');const canUndo=!!undoButton&&!undoButton.disabled;undoButton?.click();await wait();
      const redoButton=Array.from(document.querySelectorAll('button')).find(b=>b.title==='重做');const canRedo=!!redoButton&&!redoButton.disabled;
      click('取消编辑');await wait();click('添加评论');await wait();
      const commentImage=document.querySelector('img[alt="点击添加位置评论"]');if(!commentImage)throw new Error('评论图片未加载');
      const bounds=commentImage.getBoundingClientRect();
      commentImage.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:bounds.left+bounds.width*0.25,clientY:bounds.top+bounds.height*0.5}));await wait();
      const textarea=document.querySelector('textarea[aria-label="位置评论内容"]');if(!textarea)throw new Error('评论输入框不存在');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'在标题左侧增加标记');textarea.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      click('完成评论');await wait();
      const coordinate=window.editedPrompt?.match(/[(]x: ([0-9.]+)%, y: ([0-9.]+)%[)]/);
      const coordinateMatched=!!coordinate&&Math.abs(Number(coordinate[1])-25)<=0.101&&Math.abs(Number(coordinate[2])-50)<=0.101;
      const commented=window.edited?.startsWith('data:image/png')&&coordinateMatched&&window.editedPrompt?.includes('在标题左侧增加标记')&&!document.querySelector('[role=dialog]');
      return {visible,ratioReady,ratioApplied,removed,canUndo,canRedo,commented};
    `)
    expect(result).toEqual({ visible: true, ratioReady: true, ratioApplied: true, removed: true, canUndo: true, canRedo: true, commented: true })
  }, 40_000)
  test('When 组合画笔、文字、形状、选择与擦除 Then 对象可编辑且取消和撤销可恢复', async () => {
    const result = await renderer.run(`${setup}
      click('标注');await wait();
      const canvas=document.querySelector('canvas');if(!canvas)throw new Error('编辑画布不存在');
      canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;canvas.releasePointerCapture=()=>{};
      const bounds=canvas.getBoundingClientRect();
      const pointer=(type,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,isPrimary:true,button:0,clientX:bounds.left+x,clientY:bounds.top+y}));
      const pixels=()=>canvas.toDataURL();
      const initial=pixels();
      pointer('pointerdown',bounds.width*0.3,bounds.height*0.3);pointer('pointermove',bounds.width*0.4,bounds.height*0.35);pointer('pointerup',bounds.width*0.4,bounds.height*0.35);await wait();
      const afterDraw=pixels();const drawn=afterDraw!==initial;
      click('文字');await wait();pointer('pointerdown',bounds.width*0.5,bounds.height*0.4);pointer('pointerup',bounds.width*0.5,bounds.height*0.4);await wait();
      const text=document.querySelector('textarea[aria-label="标注文字"]');if(!text)throw new Error('文字输入框不存在');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,'标题');text.dispatchEvent(new Event('input',{bubbles:true}));await wait();click('添加');await wait();
      const afterText=pixels();const textAdded=afterText!==afterDraw;
      click('矩形');await wait();pointer('pointerdown',bounds.width*0.55,bounds.height*0.5);pointer('pointermove',bounds.width*0.7,bounds.height*0.65);pointer('pointerup',bounds.width*0.7,bounds.height*0.65);await wait();
      const afterShape=pixels();const shapeAdded=afterShape!==afterText;
      click('选择标注');await wait();pointer('pointerdown',bounds.width*0.62,bounds.height*0.57);await wait();const beforeMove=pixels();
      pointer('pointermove',bounds.width*0.67,bounds.height*0.62);await wait();const moved=pixels()!==beforeMove;
      pointer('pointercancel',bounds.width*0.67,bounds.height*0.62);await wait();const moveCancelled=pixels()===beforeMove;
      click('擦除');await wait();const eraserControl=!!document.querySelector('input[aria-label="擦除大小"]');const beforeErase=pixels();
      pointer('pointerdown',bounds.width*0.62,bounds.height*0.57);pointer('pointermove',bounds.width*0.63,bounds.height*0.58);pointer('pointerup',bounds.width*0.63,bounds.height*0.58);await wait();const erased=pixels()!==beforeErase;
      click('撤销');await wait();const undoRestored=pixels()===beforeErase;
      click('取消编辑');await wait();
      return {drawn,textAdded,shapeAdded,moved,moveCancelled,eraserControl,erased,undoRestored};
    `)
    expect(result).toEqual({ drawn: true, textAdded: true, shapeAdded: true, moved: true, moveCancelled: true, eraserControl: true, erased: true, undoRestored: true })
  }, 40_000)
  test('When 弹窗写回失败后重试 Then 保留编辑状态并按原图 MIME 导出', async () => {
    const result = await renderer.run(`window.lightboxMime='image/jpeg';window.failLightboxSave=true;${setup}
      click('标注');await wait();const beforeFailure=window.edited;click('保存');await wait();
      const failureVisible=document.body.textContent.includes('保存失败：模拟写回失败');
      const failureKeptEditor=!!document.querySelector('[role="dialog"] canvas');
      const failurePreservedResult=window.edited===beforeFailure;
      window.failLightboxSave=false;click('保存');await wait();
      const retryExportedJpeg=window.edited?.startsWith('data:image/jpeg')&&!document.querySelector('[role="dialog"]');
      window.lightboxMime=undefined;
      return {failureVisible,failureKeptEditor,failurePreservedResult,retryExportedJpeg};
    `)
    expect(result).toEqual({ failureVisible: true, failureKeptEditor: true, failurePreservedResult: true, retryExportedJpeg: true })
  }, 30_000)
  test('When 保存、快速开关和卸载 Then 回调保留、焦点约束及全局状态不残留', async () => {
    const result = await renderer.run(`${setup}
      click('保存图片');const saved=window.saved===1&&!!stage();
      const dialog=document.querySelector('[role=dialog]');const first=dialog.querySelector('button');first.focus();
      // 隐藏的 Electron 测试窗口不产生 OS focusin，显式派发以验证 Radix 焦点陷阱。
      first.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));opener.focus();opener.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await wait();const trapped=dialog.contains(document.activeElement);
      click('关闭');opener.click();await wait();const rapid=document.querySelectorAll('[role=dialog]').length===1&&matrix().a===1;
      click('标注');await wait();click('保存');await wait();const edited=window.edited?.startsWith('data:image/png')&&!document.querySelector('[role=dialog]');
      opener.click();await wait();window.unmountLightbox();await wait();
      const clean=!document.querySelector('[role=dialog]')&&!document.querySelector('[data-image-viewport]')&&document.body.style.pointerEvents!== 'none';
      return {saved,trapped,rapid,edited,clean};
    `)
    expect(result).toEqual({ saved: true, trapped: true, rapid: true, edited: true, clean: true })
  }, 30_000)

})
