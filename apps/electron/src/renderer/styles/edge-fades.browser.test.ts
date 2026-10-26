import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createVisualRendererHarness } from '../../test-utils/visual-renderer'
import type { VisualRendererHarness } from '../../test-utils/visual-renderer'

let renderer: VisualRendererHarness
beforeAll(async () => {
  renderer = await createVisualRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {FadeTitle} from '@/components/ui/fade-title';
    import {SidebarScrollBoundary} from '@/components/ui/sidebar-scroll-boundary';
    import {attachScrollFade} from '@/components/ui/scroll-fade';
    import '@fontsource-variable/inter';import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root')),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const label='这是用于测试溢出的很长会话标题，不应该产生省略号，也不应该遮住右侧操作';
    const read=()=>{const e=document.getElementById('sample-title'),s=getComputedStyle(e);return {overflow:e.dataset.titleOverflow,mask:s.maskImage,textOverflow:s.textOverflow,text:e.textContent,tag:e.tagName,title:e.title}};
    window.edgeFixture={root,wait,read,label,attachScrollFade,
      async mount(options={}){
        root.render(React.createElement('div',{id:'title-row',className:'gamma-ui',style:{display:'flex',gap:8,width:options.width??240}},
          React.createElement(FadeTitle,{id:'sample-title',as:options.tag??'span',title:options.label??label,className:options.className??'flex-1 truncate',style:{fontSize:options.fontSize}},options.label??label),
          React.createElement('button',{id:'title-action',style:{flexShrink:0,width:28}},'操作')));
        await wait(30);await document.fonts.ready;await wait(50);
      },
      async sidebar(){root.render(React.createElement(SidebarScrollBoundary,null,React.createElement('div',{id:'sidebar-scroll',style:{height:120,overflow:'auto'}},React.createElement('div',{style:{height:600}},'长列表'))));await wait(70)},
      async many(){root.render(React.createElement('div',{style:{width:180}},Array.from({length:100},(_,i)=>React.createElement(FadeTitle,{key:i},label+i))));await wait(70)}
    };
  `)
}, 90_000)
afterAll(async () => { await renderer?.dispose() })

interface TitleResult { overflow: string; mask: string; textOverflow: string; text: string; tag: string; title: string }

describe('Given 第5步24px条件渐隐', () => {
  test('When 标题长短不同 Then 仅长标题右侧渐隐且保留完整文本、标签和相邻按钮', async () => {
    const result = await renderer.run<{ long: TitleResult; short: TitleResult; actionMask: string; stable: boolean }>(`
      const f=window.edgeFixture;await f.mount({tag:'h3'});const long=f.read(),before=document.getElementById('title-action').getBoundingClientRect().left;
      const actionMask=getComputedStyle(document.getElementById('title-action')).maskImage;
      await f.mount({label:'短标题',tag:'h3'});return {long,short:f.read(),actionMask,stable:before===document.getElementById('title-action').getBoundingClientRect().left};
    `)
    expect(result.long.overflow).toBe('true')
    expect(result.long.mask).toContain('24px')
    expect(result.long.textOverflow).toBe('clip')
    expect(result.long.text).toBe(result.long.title)
    expect(result.long.tag).toBe('H3')
    expect(result.short.overflow).toBe('false')
    expect(result.short.mask).toBe('none')
    expect(result.actionMask).toBe('none')
    expect(result.stable).toBe(true)
  })

  test('When 容器变宽、重命名和字形尺寸变化 Then 溢出状态及时重新测量', async () => {
    const result = await renderer.run<string[]>(`
      const f=window.edgeFixture,states=[];await f.mount();states.push(f.read().overflow);
      document.getElementById('title-row').style.width='1600px';await f.wait(70);states.push(f.read().overflow);
      document.getElementById('title-row').style.width='240px';
      await f.mount({label:'短标题',width:240});states.push(f.read().overflow);
      await f.mount({label:'短标题',width:240,fontSize:120});states.push(f.read().overflow);
      return states;
    `)
    expect(result).toEqual(['true', 'false', 'false', 'true'])
  })

  test('When 标题已有max-width限制 Then 渐隐不覆盖原来的宽度预算', async () => {
    const result = await renderer.run<{ width: number; mask: string }>(`
      const f=window.edgeFixture;await f.mount({width:600,className:'max-w-[160px] truncate'});const e=document.getElementById('sample-title');return {width:e.getBoundingClientRect().width,mask:getComputedStyle(e).maskImage};
    `)
    expect(result.width).toBe(160)
    expect(result.mask).toContain('24px')
  })

  test('When 100个标题挂载并卸载 Then 共享一个ResizeObserver并释放观察器', async () => {
    const result = await renderer.run<{ created: number; disconnected: number }>(`
      const Native=window.ResizeObserver;let created=0,disconnected=0;
      window.ResizeObserver=class extends Native{constructor(callback){super(callback);created++}disconnect(){disconnected++;super.disconnect()}};
      await window.edgeFixture.many();window.edgeFixture.root.unmount();return {created,disconnected};
    `)
    expect(result).toEqual({ created: 1, disconnected: 1 })
  })

  test('When 侧栏滚动经过首中尾 Then mask统一24px且不再叠加顶部装饰渐变', async () => {
    const result = await renderer.run<{ states: string[][]; overlay: boolean; marker: string }>(`
      const f=window.edgeFixture;await f.sidebar();const e=document.getElementById('sidebar-scroll'),read=()=>['--scroll-fade-top','--scroll-fade-bottom'].map(name=>e.style.getPropertyValue(name));
      const states=[read()];e.scrollTop=90;await f.wait(50);states.push(read());e.scrollTop=1000;await f.wait(50);states.push(read());
      return {states,overlay:!!document.querySelector('[aria-hidden="true"]'),marker:document.querySelector('[data-sidebar-scroll-boundary]').dataset.sidebarScrollBoundary};
    `)
    expect(result).toEqual({ states: [['0px', '24px'], ['24px', '24px'], ['24px', '0px']], overlay: false, marker: 'scrolled' })
  })

  test('When 原生滚动条占据gutter Then 额外alpha条带保留滚动条不透明', async () => {
    const result = await renderer.run<{ gutter: number; masks: number; composite: string }>(`
      const style=document.createElement('style');style.textContent='#gutter::-webkit-scrollbar{width:12px;height:10px}';document.head.append(style);
      const e=document.createElement('div');e.id='gutter';e.style.cssText='width:200px;height:120px;overflow:scroll;scrollbar-gutter:stable';e.innerHTML='<div style="width:500px;height:600px"></div>';document.body.append(e);
      const dispose=window.edgeFixture.attachScrollFade(e,{orientation:'both'});await window.edgeFixture.wait(70);
      const result={gutter:e.offsetWidth-e.clientWidth,masks:(getComputedStyle(e).maskImage.match(/linear-gradient\\(/g)??[]).length,composite:getComputedStyle(e).maskComposite};dispose();return result;
    `)
    expect(result.gutter).toBeGreaterThan(0)
    expect(result.masks).toBe(4)
    expect(result.composite.startsWith('add, add, intersect')).toBe(true)
  })

  test('When 键盘焦点靠近滚动边缘 Then 对应渐隐带暂时关闭且不改变滚动位置', async () => {
    const result = await renderer.run<{ before: string; focused: string; after: string; retained: boolean }>(`
      const f=window.edgeFixture,e=document.createElement('div');e.style.cssText='height:120px;width:200px;overflow:auto';e.innerHTML='<div style="height:600px;position:relative"><button id="edge-focus" style="position:absolute;top:95px;height:20px">焦点</button></div>';document.body.append(e);
      const dispose=f.attachScrollFade(e);e.scrollTop=90;await f.wait(50);const before=e.style.getPropertyValue('--scroll-fade-top');
      const button=document.getElementById('edge-focus');button.focus({preventScroll:true});await f.wait(50);const focused=e.style.getPropertyValue('--scroll-fade-top'),retained=e.scrollTop===90;
      button.blur();await f.wait(50);const after=e.style.getPropertyValue('--scroll-fade-top');dispose();return {before,focused,after,retained};
    `, { keyboard: true })
    expect(result).toEqual({ before: '24px', focused: '0px', after: '24px', retained: true })
  })

  test('When 强制色彩模式开启 Then 长标题和滚动mask均停用而内容仍完整', async () => {
    const result = await renderer.run<{ title: string; scroll: string }>(`
      const f=window.edgeFixture;await f.mount();const title=f.read().mask,e=document.createElement('div');e.style.cssText='width:200px;height:100px;overflow:auto';e.innerHTML='<div style="height:500px"></div>';document.body.append(e);const dispose=f.attachScrollFade(e);const scroll=getComputedStyle(e).maskImage;dispose();return {title,scroll};
    `, { forcedColors: true })
    expect(result).toEqual({ title: 'none', scroll: 'none' })
  })
})
