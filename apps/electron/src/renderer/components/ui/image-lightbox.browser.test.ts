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
    function App(){const [open,setOpen]=React.useState(false),[index,setIndex]=React.useState(0);
      return React.createElement(React.Fragment,null,
        React.createElement('button',{id:'opener',onClick:()=>setOpen(true)},'打开'),
        React.createElement(ImageLightbox,{open,onOpenChange:setOpen,index,onIndexChange:setIndex,images:[{src,alt:'第一张',onSave:()=>{window.saved=(window.saved||0)+1},onEditComplete:(url)=>{window.edited=url}},{src,alt:'第二张',onSave:()=>{window.saved=(window.saved||0)+1},onEditComplete:(url)=>{window.edited=url}}]}));}
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
      click('放大图片');await wait();click('编辑图片');await wait();const isolated=!stage()&&!!document.querySelector('canvas');
      const before=document.querySelector('[role=dialog]').textContent;window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await wait();const noNav=before===document.querySelector('[role=dialog]').textContent;
      const cancel=Array.from(document.querySelectorAll('button')).find(b=>b.title==='取消编辑'||b.title==='取消'||b.textContent.includes('取消'));if(!cancel)throw new Error('未找到取消按钮');cancel.click();await wait();const editReset=matrix().a===1&&!document.querySelector('canvas');
      click('关闭');await wait();const restored=document.activeElement===opener&&!document.querySelector('[role=dialog]');
      opener.click();await wait();click('放大图片');await wait();window.dispatchEvent(new Event('resize'));stage().style.width='70vw';await wait();const resized=matrix().a===1;
      click('关闭');await wait();opener.click();await wait();const reopened=matrix().a===1&&document.querySelectorAll('[role=dialog]').length===1;
      return {switched,isolated,noNav,editReset,restored,resized,reopened};
    `)
    expect(result).toEqual({ switched: true, isolated: true, noNav: true, editReset: true, restored: true, resized: true, reopened: true })
  }, 30_000)
  test('When 保存、快速开关和卸载 Then 回调保留、焦点约束及全局状态不残留', async () => {
    const result = await renderer.run(`${setup}
      click('保存图片');const saved=window.saved===1&&!!stage();
      const dialog=document.querySelector('[role=dialog]');const first=dialog.querySelector('button');first.focus();
      // 隐藏的 Electron 测试窗口不产生 OS focusin，显式派发以验证 Radix 焦点陷阱。
      first.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));opener.focus();opener.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await wait();const trapped=dialog.contains(document.activeElement);
      click('关闭');opener.click();await wait();const rapid=document.querySelectorAll('[role=dialog]').length===1&&matrix().a===1;
      click('编辑图片');await wait();click('保存');await wait();const edited=window.edited?.startsWith('data:image/png')&&!document.querySelector('[role=dialog]');
      opener.click();await wait();window.unmountLightbox();await wait();
      const clean=!document.querySelector('[role=dialog]')&&!document.querySelector('[data-image-viewport]')&&document.body.style.pointerEvents!== 'none';
      return {saved,trapped,rapid,edited,clean};
    `)
    expect(result).toEqual({ saved: true, trapped: true, rapid: true, edited: true, clean: true })
  }, 30_000)

})
