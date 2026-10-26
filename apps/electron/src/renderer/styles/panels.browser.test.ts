import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Panel} from '@/components/app-shell/Panel';
    import {SidebarTransition} from '@/components/app-shell/SidebarTransition';
    import {WorkspacePanels} from '@/components/app-shell/WorkspacePanels';
    import {clampRightPanelWidth} from '@/components/app-shell/right-panel-layout';
    import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
    import {AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription} from '@/components/ui/alert-dialog';
    import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
    import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
    import {ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@/components/ui/context-menu';
    import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
    import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
    import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root')),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const mounts={agent:0,workspace:0};
    function Draft({name}){React.useEffect(()=>{mounts[name]++},[]);return React.createElement('input',{'aria-label':name+'草稿',defaultValue:'保留草稿',style:{height:32,flexShrink:0}})}
    const metrics=e=>{const s=getComputedStyle(e);return {radius:s.borderTopLeftRadius,border:s.borderTopWidth,borderColor:s.borderTopColor,padding:s.padding,shadow:s.boxShadow,background:s.backgroundColor}};
    const framePanels=()=>[document.querySelector('[data-sidebar-content]').parentElement,document.querySelector('[data-scroll="agent"]').parentElement,document.querySelector('[data-scroll="workspace"]').parentElement];
    window.panelsFixture={wait,mounts,metrics,framePanels,
      async mount(options={}){
        document.documentElement.className='gamma-main-window '+(options.theme??'');
        const collapsed=!!options.collapsed,width=options.width??1100,height=options.height??520;
        const workspaceWidth=clampRightPanelWidth(280,width,240,collapsed?0:264,true);
        const content=name=>React.createElement(React.Fragment,null,
          React.createElement('header',{style:{height:40,flexShrink:0}},name),
          React.createElement('div',{'data-scroll':name,className:'min-h-0 flex-1 overflow-y-auto'},React.createElement('div',{style:{height:1800}},name==='agent'?React.createElement('p',{className:'reading-body'},'正文 ',React.createElement('code',null,'inline_code')):'长文件列表')),
          React.createElement(Draft,{name}));
        root.render(React.createElement('div',{className:'gamma-workbench flex h-full w-full '+(options.windows?'pt-8':''),'data-sidebar-collapsed':collapsed,style:{width,height}},
          React.createElement(SidebarTransition,{collapsed,width:256},React.createElement(Panel,{variant:'shrink',width:256},React.createElement('span',{'data-sidebar-content':true},'导航'))),
          React.createElement('main',{className:'flex min-h-0 min-w-0 flex-1 flex-col'},React.createElement(WorkspacePanels,{workspaceSide:options.side??'right',workspaceOpen:options.open!==false,workspaceWidth,minimumWidth:240,maximumWidth:600,onResizeStart:()=>{},onResizeKeyDown:()=>{},agent:React.createElement(Panel,null,content('agent')),workspace:React.createElement(Panel,{variant:'shrink',width:options.open===false?0:workspaceWidth},content('workspace'))}))));
        await wait(80);await document.fonts.ready;
      },
      async floating(kind,theme=''){
        document.documentElement.className=theme;
        const label=React.createElement('button',{id:'floating-trigger'},'打开'),text=React.createElement('p',null,'面板内容');
        const content=kind==='dialog'?React.createElement(Dialog,{open:true},React.createElement(DialogContent,null,React.createElement(DialogTitle,null,'对话框'),React.createElement(DialogDescription,null,'说明'),text)):
          kind==='alert'?React.createElement(AlertDialog,{open:true},React.createElement(AlertDialogContent,null,React.createElement(AlertDialogTitle,null,'确认'),React.createElement(AlertDialogDescription,null,'说明'),text)):
          kind==='sheet'?React.createElement(Sheet,{open:true},React.createElement(SheetContent,null,React.createElement(SheetTitle,null,'侧边面板'),React.createElement(SheetDescription,null,'说明'),text)):
          kind==='popover'?React.createElement(Popover,{open:true},React.createElement(PopoverTrigger,{asChild:true},label),React.createElement(PopoverContent,null,text)):
          kind==='select'?React.createElement(Select,{open:true,value:'one'},React.createElement(SelectTrigger,null,React.createElement(SelectValue)),React.createElement(SelectContent,null,React.createElement(SelectItem,{value:'one'},'第一项'),React.createElement(SelectItem,{value:'two'},'第二项'))):
          kind==='context'?React.createElement(ContextMenu,null,React.createElement(ContextMenuTrigger,{asChild:true},label),React.createElement(ContextMenuContent,null,React.createElement(ContextMenuItem,null,'右键菜单项'))):
          React.createElement(DropdownMenu,{open:true},React.createElement(DropdownMenuTrigger,{asChild:true},label),React.createElement(DropdownMenuContent,null,React.createElement(DropdownMenuItem,null,'单行菜单项'),React.createElement(DropdownMenuItem,null,React.createElement('span',{style:{height:60}},'多行内容不裁切'))));
        root.render(content);await wait(40);
        if(kind==='context')document.getElementById('floating-trigger').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:100}));
        await wait(550);return metrics(document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'));
      }
    };
  `)
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

interface PanelStyle {
  radius: string
  border: string
  borderColor: string
  padding: string
  shadow: string
  background: string
}
function expectPanel(style: PanelStyle, dark: boolean): void {
  expect(style.radius).toBe('12px')
  expect(style.border).toBe('1px')
  expect(style.borderColor).toBe(dark ? 'rgba(250, 249, 245, 0.08)' : 'rgba(20, 20, 19, 0.08)')
  expect(style.padding).toBe('16px')
  expect(style.shadow).toBe('none')
  expect(style.background).toBe(dark ? 'rgb(38, 38, 36)' : 'rgb(255, 255, 255)')
}

describe('Given 第4步面板与布局规范', () => {
  test('When 三个主面板在亮暗及历史主题中显示 Then 背景分层且面板均为12/1/16、间隙8px，行内代码仍为6px', async () => {
    for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
      const result = await renderer.run<{ panels: PanelStyle[]; gaps: number[]; inset: number; codeRadius: string; background: string }>(`
        const f=window.panelsFixture;await f.mount({theme:${JSON.stringify(theme)}});
        const outer=document.querySelector('.gamma-workbench'),panels=f.framePanels(),rects=panels.map(e=>e.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
        return {panels:panels.map(f.metrics),gaps:rects.slice(1).map((r,i)=>r.left-rects[i].right),inset:rects[0].left-outer.getBoundingClientRect().left,codeRadius:getComputedStyle(document.querySelector('code')).borderRadius,background:getComputedStyle(outer).backgroundColor};
      `)
      expect(result.panels).toHaveLength(3)
      for (const panel of result.panels) expectPanel(panel, !!theme)
      expect(result.gaps).toEqual([8, 8])
      expect(result.inset).toBe(8)
      expect(result.codeRadius).toBe('6px')
      expect(result.background).toBe(theme ? 'rgb(31, 30, 29)' : 'rgb(250, 249, 245)')
    }
  }, 30_000)

  test('When 窄低窗口交换工作区或收起一侧 Then 无横向溢出、Agent至少320px且输入和滚动仍可用', async () => {
    const result = await renderer.run<Array<{ fits: boolean; input: boolean; scroll: boolean; mainWidth: number; gap: number }>>(`
      const f=window.panelsFixture,results=[];
      for(const side of ['left','right'])for(const collapsed of [false,true]){
        await f.mount({width:760,height:360,side,collapsed});
        const outer=document.querySelector('.gamma-workbench').getBoundingClientRect(),agent=document.querySelector('[data-workspace-pane="agent"]'),input=agent.querySelector('input');input.focus();
        const rect=input.getBoundingClientRect(),scroll=agent.querySelector('[data-scroll]');scroll.scrollTop=100;
        const left=[...document.querySelector('[data-testid="agent-workspace-layout"]').children].map(e=>e.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
        results.push({fits:document.documentElement.scrollWidth<=innerWidth&&left.at(-1).right<=outer.right,input:rect.bottom<=outer.bottom&&document.activeElement===input,scroll:scroll.scrollTop>0,mainWidth:agent.getBoundingClientRect().width,gap:left[1].left-left[0].right});
      }return results;
    `)
    for (const sample of result) {
      expect(sample.fits).toBe(true)
      expect(sample.input).toBe(true)
      expect(sample.scroll).toBe(true)
      expect(sample.mainWidth).toBeGreaterThanOrEqual(320)
      expect(sample.gap).toBe(8)
    }
  }, 30_000)

  test('When 交换或关闭工作区 Then 草稿不重挂载、关闭后零宽零间隙，Windows保留32px窗口栏', async () => {
    const result = await renderer.run<{ retained: boolean; mounts: number; workspaceWidth: number; gap: string; top: string }>(`
      const f=window.panelsFixture;await f.mount();const draft=document.querySelector('[aria-label="agent草稿"]');draft.value='尚未发送';const before=f.mounts.agent;
      await f.mount({side:'left'});const retained=draft===document.querySelector('[aria-label="agent草稿"]')&&draft.value==='尚未发送';
      await f.mount({open:false,collapsed:true,windows:true});const pane=document.querySelector('[data-workspace-pane="workspace"]');
      return {retained,mounts:f.mounts.agent-before,workspaceWidth:pane.getBoundingClientRect().width,gap:getComputedStyle(document.querySelector('[data-testid="agent-workspace-layout"]')).columnGap,top:getComputedStyle(document.querySelector('.gamma-workbench')).paddingTop};
    `)
    expect(result).toEqual({ retained: true, mounts: 0, workspaceWidth: 0, gap: '0px', top: '40px' })
  }, 30_000)

  test('When 打开对话框、提示确认、侧边面板、浮层、菜单和选择器 Then 统一面板几何且不使用重阴影', async () => {
    for (const theme of ['', 'dark', 'dark theme-terminal-dark']) {
      const samples = await renderer.run<PanelStyle[]>(`const f=window.panelsFixture,results=[];for(const kind of ['dialog','alert','sheet','popover','menu','context','select'])results.push(await f.floating(kind,${JSON.stringify(theme)}));return results;`)
      expect(samples).toHaveLength(7)
      for (const sample of samples) expectPanel(sample, !!theme)
    }
  }, 60_000)

  test('When 菜单包含单行和多行项目 Then 单行34px、多行自然增高且未裁切', async () => {
    const result = await renderer.run<number[]>(`const f=window.panelsFixture;await f.floating('menu');return [...document.querySelectorAll('[role="menuitem"]')].map(e=>e.getBoundingClientRect().height);`)
    expect(result[0]).toBe(34)
    expect(result[1]).toBeGreaterThanOrEqual(60)
  }, 30_000)
})
