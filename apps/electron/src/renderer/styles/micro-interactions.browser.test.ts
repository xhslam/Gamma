import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../test-utils/visual-renderer'

let renderer: VisualRendererHarness
interface ArrowState { opacity: string; transform: string; duration: string; width: number; textX: number; endX: number; stroke: string; fill: string }
interface IconState { translate: string; transform: string; background: string; color: string; duration: string; animation: string }

beforeAll(async () => {
  renderer = await createVisualRendererHarness(`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{Copy,LoaderCircle,ChevronUp,PanelLeft}from'lucide-react';
    import{Button}from'@/components/ui/button';import{DisclosureChevron}from'@/components/ui/disclosure-chevron';
    import'@/styles/globals.css';
    function Demo(){const[open,setOpen]=useState(false);return React.createElement('main',{className:'gamma-ui',style:{padding:24,width:420}},
      React.createElement('button',{id:'fold','data-disclosure-trigger':'', 'aria-expanded':open,onClick:()=>setOpen(v=>!v),style:{display:'flex',alignItems:'center',gap:8,width:320,height:34}},React.createElement(DisclosureChevron,{expanded:open}),React.createElement('span',{id:'fold-text'},'可展开内容'),React.createElement('span',{id:'fold-end',style:{marginLeft:'auto'}},'5')),
      React.createElement('button',{id:'selected','data-disclosure-trigger':'','aria-selected':true},React.createElement(DisclosureChevron,{expanded:false}),'已选目录'),
      React.createElement('button',{id:'radix','data-disclosure-trigger':'','data-state':'open'},React.createElement(DisclosureChevron), 'Radix内容'),
      React.createElement(Button,{id:'copy',variant:'ghost',size:'icon','aria-label':'复制'},React.createElement(Copy)),
      React.createElement(Button,{id:'disabled',disabled:true,variant:'ghost',size:'icon','aria-label':'禁用'},React.createElement(Copy)),
      React.createElement(Button,{id:'spinner',variant:'ghost',size:'icon','aria-label':'加载'},React.createElement(LoaderCircle,{className:'animate-spin'})),
      React.createElement(Button,{id:'rotated',variant:'ghost',size:'icon','aria-label':'已有旋转'},React.createElement(ChevronUp,{style:{transform:'rotate(25deg)'}})),
      React.createElement(Button,{id:'restore',variant:'ghost',size:'icon','aria-label':'展开侧栏'},React.createElement(PanelLeft))
    )}
    createRoot(document.getElementById('root')).render(React.createElement(Demo));
    window.micro={wait:(ms=220)=>new Promise(r=>setTimeout(r,ms)),arrow(id='fold'){const p=document.getElementById(id),e=p.querySelector('svg'),s=getComputedStyle(e);return{opacity:s.opacity,transform:s.transform,duration:s.transitionDuration,width:e.getBoundingClientRect().width,textX:document.getElementById('fold-text').getBoundingClientRect().x,endX:document.getElementById('fold-end').getBoundingClientRect().x,stroke:e.getAttribute('stroke-width'),fill:e.getAttribute('fill')}},icon(id='copy'){const p=document.getElementById(id),e=p.querySelector('svg'),s=getComputedStyle(e);return{translate:s.translate,transform:s.transform,background:getComputedStyle(p).backgroundColor,color:getComputedStyle(p).color,duration:s.transitionDuration,animation:s.animationName}}};
  `)
})
afterAll(async () => { await renderer?.dispose() })

function angle(transform: string): number {
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1]?.split(',').map(Number)
  return values ? Math.round(Math.atan2(values[1]!, values[0]!) * 180 / Math.PI) : 0
}

describe('Given 第6步安静的折叠与图标交互', () => {
  test('When 静止与展开 Then 默认透明、150ms过渡、展开常显90度且文字不位移', async () => {
    const result = await renderer.run<{before:ArrowState;after:ArrowState;selected:ArrowState;radix:ArrowState;restore:string}>(`
      const f=window.micro;await f.wait();const before=f.arrow();document.getElementById('fold').click();await f.wait();return{before,after:f.arrow(),selected:f.arrow('selected'),radix:f.arrow('radix'),restore:getComputedStyle(document.querySelector('#restore svg')).opacity};
    `)
    expect(result.before.opacity).toBe('0')
    expect(result.before.duration.split(',').every((v) => v.trim() === '0.15s')).toBe(true)
    expect(result.before.width).toBe(14)
    expect(result.before.stroke).toBe('1.5')
    expect(result.before.fill).toBe('none')
    expect(result.after.opacity).toBe('1')
    expect(angle(result.after.transform)).toBe(90)
    expect(result.after.textX).toBe(result.before.textX)
    expect(result.after.endX).toBe(result.before.endX)
    expect(result.selected.opacity).toBe('1')
    expect(result.radix.opacity).toBe('1')
    expect(angle(result.radix.transform)).toBe(90)
    expect(result.restore).toBe('1')
  })

  test('When 原生指针悬浮 Then 只显现箭头且图标槽保持14px', async () => {
    const result = await renderer.run<ArrowState>('await window.micro.wait();return window.micro.arrow();', {hoverSelector:'#fold'})
    expect(result.opacity).toBe('1')
    expect(result.width).toBe(14)
    expect(angle(result.transform)).toBe(0)
  })

  test('When 键盘聚焦 Then 折叠入口可见', async () => {
    const result = await renderer.run<{state:ArrowState;focus:boolean}>(`document.getElementById('fold').focus();await window.micro.wait();return {state:window.micro.arrow(),focus:document.getElementById('fold').matches(':focus-visible')};`, {keyboard:true})
    expect(result.focus).toBe(true)
    expect(result.state.opacity).toBe('1')
  })

  test('When 普通图标悬浮 Then 仅上移1px并使用暖色下沉背景与前景', async () => {
    for (const dark of [false,true]) {
      const result = await renderer.run<IconState>(`document.documentElement.classList.toggle('dark',${dark});await window.micro.wait();return window.micro.icon();`, {hoverSelector:'#copy'})
      expect(result.translate).toBe('0px -1px')
      expect(result.background).toBe(dark?'rgb(48, 48, 46)':'rgb(240, 238, 230)')
      expect(result.color).toBe(dark?'rgb(240, 238, 230)':'rgb(20, 20, 19)')
      expect(result.duration.split(',').every(v => Number.parseFloat(v) >= 0.15 && Number.parseFloat(v) <= 0.2)).toBe(true)
    }
  })

  test('When 禁用图标或加载动画 Then 不添加hover微动', async () => {
    const disabled = await renderer.run<IconState>('await window.micro.wait();return window.micro.icon("disabled");', {hoverSelector:'#disabled'})
    expect(['none','0px','0px 0px']).toContain(disabled.translate)
    const spinner = await renderer.run<IconState>('await window.micro.wait();return window.micro.icon("spinner");', {hoverSelector:'#spinner'})
    expect(['none','0px','0px 0px']).toContain(spinner.translate)
    expect(spinner.animation).toBe('spin')
  })

  test('When 图标已有状态旋转 Then 独立位移不覆盖其transform', async () => {
    const result = await renderer.run<IconState>('await window.micro.wait();return window.micro.icon("rotated");', {hoverSelector:'#rotated'})
    expect(angle(result.transform)).toBe(25)
    expect(result.translate).toBe('0px -1px')
  })

  test('When 偏好减少动态效果 Then 无位移过渡但保留展开方向', async () => {
    const result = await renderer.run<{icon:IconState;arrow:ArrowState}>(`document.getElementById('fold').click();await window.micro.wait();return{icon:window.micro.icon(),arrow:window.micro.arrow()};`, {hoverSelector:'#copy',reducedMotion:true})
    expect(['none','0px','0px 0px']).toContain(result.icon.translate)
    expect(result.icon.duration.split(',').every(v=>Number.parseFloat(v)===0)).toBe(true)
    expect(result.arrow.opacity).toBe('1')
    expect(angle(result.arrow.transform)).toBe(90)
  })

  test('When 图标位于反色图片查看器 Then 明暗模式均保留反色前景而非普通下沉层', async () => {
    for (const dark of [false, true]) {
      const result = await renderer.run<IconState>(`document.documentElement.classList.toggle('dark',${dark});document.getElementById('copy').dataset.iconButtonTone='inverse';await window.micro.wait();return window.micro.icon();`, {hoverSelector:'#copy'})
      expect(result.color).toBe('rgb(240, 238, 230)')
      expect(result.background).toBe('rgba(240, 238, 230, 0.14)')
    }
  })

  test('When 强制颜色下聚焦 Then 使用系统高对比色且不隐藏折叠入口', async () => {
    const result = await renderer.run<{visible:string;forced:boolean}>(`document.getElementById('fold').focus();await window.micro.wait();return{visible:window.micro.arrow().opacity,forced:matchMedia('(forced-colors: active)').matches};`, {forcedColors:true,keyboard:true})
    expect(result).toEqual({visible:'1',forced:true})
  })

  test('When 使用触屏 Then 未展开入口也保持可发现', async () => {
    const result = await renderer.run<ArrowState>('await window.micro.wait();return window.micro.arrow();', {touch:true})
    expect(result.opacity).toBe('1')
  })
})
