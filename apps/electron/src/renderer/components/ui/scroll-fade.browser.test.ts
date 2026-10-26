import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import { attachScrollFade } from '@/components/ui/scroll-fade'
    window.fadeRegression={attachScrollFade};
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given Chromium 中真实双轴滚动容器', () => {
  test('When 滚动、内容增长和清理 Then 首尾清晰且样式恢复', async () => {
    const result = await renderer.run(`
      const el=document.createElement('div'),content=document.createElement('div');
      el.style.cssText='width:200px;height:120px;overflow:auto;mask-image:none';content.style.cssText='width:500px;height:600px';el.append(content);document.body.append(el);
      const dispose=window.fadeRegression.attachScrollFade(el,{orientation:'both'});
      const wait=()=>new Promise(r=>setTimeout(r,70));await wait();
      const read=()=>['--scroll-fade-top','--scroll-fade-bottom','--scroll-fade-left','--scroll-fade-right'].map(name=>el.style.getPropertyValue(name));
      const top=read(),mask=getComputedStyle(el).maskImage,composite=getComputedStyle(el).maskComposite;
      el.scrollTop=el.scrollHeight;el.scrollLeft=el.scrollWidth;await wait();const end=read();
      content.style.height='60px';content.style.width='60px';await wait();const short=read();
      content.style.height='600px';content.style.width='500px';await wait();const grown=read();
      dispose();const restored=el.style.maskImage==='none'&&!el.hasAttribute('data-scroll-fade');el.remove();
      return {top,end,short,grown,twoMasks:(mask.match(/linear-gradient\\(/g)??[]).length===2,composite:composite.split(',')[0].trim(),restored};
    `)
    expect(result).toEqual({ top: ['0px', '24px', '0px', '24px'], end: ['24px', '0px', '24px', '0px'], short: ['0px', '0px', '0px', '0px'], grown: ['0px', '24px', '0px', '24px'], twoMasks: true, composite: 'intersect', restored: true })
  }, 30_000)
  test('When RTL 横向滚动 Then 按物理左右边缘正确羽化', async () => {
    const result = await renderer.run(`
      const el=document.createElement('div');el.style.cssText='direction:rtl;width:200px;height:100px;overflow:auto';el.innerHTML='<div style="width:600px;height:50px"></div>';document.body.append(el);
      const dispose=window.fadeRegression.attachScrollFade(el,{orientation:'horizontal'});await new Promise(r=>setTimeout(r,50));
      const right=[el.style.getPropertyValue('--scroll-fade-left'),el.style.getPropertyValue('--scroll-fade-right')];
      el.scrollLeft=-1000;await new Promise(r=>setTimeout(r,50));const left=[el.style.getPropertyValue('--scroll-fade-left'),el.style.getPropertyValue('--scroll-fade-right')];dispose();el.remove();return {right,left};
    `)
    expect(result).toEqual({ right: ['24px', '0px'], left: ['0px', '24px'] })
  }, 30_000)
})
