import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider, createStore } from 'jotai';
    import { AgyActivityPanel, AgyTaskList } from '@/components/agent/AgyActivityPanel';
    import { useAgyTaskListeners } from '@/hooks/useAgyTaskListeners';
    import { applyAgyTaskUpdateAtom, agyTaskViewsAtom, agyTaskKey, agyOpenTaskIdsAtom, closeAgyTaskAtom } from '@/atoms/agy-task-atoms';
    import { agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily } from '@/atoms/agent-atoms';
    import { tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms';
    import '@/styles/globals.css';
    const delay=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
    const task={id:'one',sessionId:'parent',title:'抽取任务',prompt:'任务提示词内容',cwd:'/temporary',model:'test-model',permissionMode:'default',status:'running',startedAt:1,lastSequence:3};
    function Listener(){useAgyTaskListeners();return null}
    window.controls={delay,task,async mount(kind='panel',options={}) {
      const store=createStore(),root=createRoot(document.getElementById('root')),reads=[],stops=[],opens=[],copies=[];
      let emit,resolveRead,fail=options.fail;
      store.set(tabsAtom,[{id:'tab',type:'agent',sessionId:'parent',title:'父会话'}]);store.set(activeTabIdAtom,'tab');
      const initial={task,events:[{sequence:1,timestamp:1,kind:'init'},{sequence:2,timestamp:2,kind:'tool',toolName:'read_file',state:'ERROR',details:{path:'/not-real',result:'工具结果内容'}},{sequence:3,timestamp:3,kind:'text',text:'<script>window.untrusted=true</script>'}],nextSequence:3};
      window.electronAPI={
        readAgyTask:async(s,id,after)=>{reads.push([s,id,after]);if(fail)throw new Error('读取失败');if(options.pending)return await new Promise(resolve=>resolveRead=resolve);return after===0?initial:{task:{...task,lastSequence:4,status:'completed',response:'最终结果内容'},events:[initial.events[2],{sequence:4,timestamp:4,kind:'result',text:'完成'}]};},
        listAgyTasks:async()=>[task,{...task,id:'old',title:'历史任务',status:'interrupted'}],
        stopAgyTask:async(s,id)=>{stops.push([s,id]);return {...task,id,sessionId:s,status:'cancelled',lastSequence:5}},
        writeClipboardText:async text=>{copies.push(text)},
        onAgyTaskUpdate:callback=>{emit=callback;return()=>{emit=undefined}}
      };
      const child=kind==='listener'?React.createElement(Listener):kind==='list'?React.createElement(AgyTaskList,{sessionId:'parent',onOpen:id=>opens.push(id)}):React.createElement(AgyActivityPanel,{sessionId:'parent',taskId:'one'});
      root.render(React.createElement(Provider,{store},React.createElement(React.Fragment,null,kind==='panel'?React.createElement(Listener):null,child)));
      await delay(100);
      return {root,reads,stops,opens,copies,store,emit:update=>emit(update),release:snapshot=>resolveRead(snapshot),initial,
        view:()=>store.get(agyTaskViewsAtom).get(agyTaskKey('parent','one')),
        tab:()=>store.get(agentDiffPanelTabAtom).get('parent'),panel:()=>store.get(agentSidePanelOpenAtomFamily('parent')),
        ids:session=>store.get(agyOpenTaskIdsAtom).get(session),close:()=>store.set(closeAgyTaskAtom,{sessionId:'parent',taskId:'one'})};
    }};
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 原生 agy 活动面板', () => {
  test('When 渲染不可信文本和工具活动 Then 文本不可执行、工具详情默认折叠且停止只作用于任务', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount(),delay=window.controls.delay;
      const before=!document.body.textContent.includes('工具结果内容')&&document.body.textContent.includes('<script>window.untrusted=true</script>')&&!window.untrusted;
      [...document.querySelectorAll('button')].find(b=>b.textContent==='参数与结果详情').click();await delay();
      const expanded=document.body.textContent.includes('工具结果内容');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='停止任务').click();await delay();
      const result={before,expanded,stops:f.stops,status:f.view().task.status};f.root.unmount();return result;
    `)
    expect(result).toEqual({ before: true, expanded: true, stops: [['parent', 'one']], status: 'cancelled' })
  })
  test('When 加载下一页 Then 使用本页游标、合并去重且显示最终状态', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount();[...document.querySelectorAll('button')].find(b=>b.textContent==='加载更多活动').click();await window.controls.delay();
      const result={reads:f.reads,sequences:f.view().events.map(e=>e.sequence),status:f.view().task.status,more:document.body.textContent.includes('加载更多活动')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ reads: [['parent', 'one', 0], ['parent', 'one', 3]], sequences: [1, 2, 3, 4], status: 'completed', more: false })
  })
  test('When 快照晚于终态更新 Then 不覆盖新任务也不重复事件', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount('panel',{pending:true}),task=window.controls.task;
      f.emit({task:{...task,status:'completed',lastSequence:4,response:'最新结果'},events:[{sequence:3,timestamp:3,kind:'text',text:'最新事件'},{sequence:4,timestamp:4,kind:'result'}]});
      f.release(f.initial);await window.controls.delay();
      const result={status:f.view().task.status,response:f.view().task.response,sequences:f.view().events.map(e=>e.sequence),text:f.view().events.find(e=>e.sequence===3).text};f.root.unmount();return result;
    `)
    expect(result).toEqual({ status: 'completed', response: '最新结果', sequences: [1, 2, 3, 4], text: '最新事件' })
  })
  test('When 前台与后台父会话请求 reveal Then 只自动打开当前会话，关闭不停止且快捷键独立停止', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount('listener'),task=window.controls.task;
      f.emit({task:{...task,sessionId:'background'},events:[],reveal:true});
      const background={tab:f.tab(),panel:f.panel(),ids:f.ids('background')};
      f.emit({task,events:[],reveal:true});const front={tab:f.tab(),panel:f.panel(),ids:f.ids('parent')};
      f.close();const closeStops=f.stops.length;
      window.dispatchEvent(new CustomEvent('gamma:stop-generation',{detail:{kind:'agy',sessionId:'parent',taskId:'one'}}));await window.controls.delay();
      const result={background,front,closeStops,stops:f.stops};f.root.unmount();return result;
    `)
    expect(result).toEqual({ background: { panel: false }, front: { tab: 'agy:one', panel: true, ids: ['one'] }, closeStops: 0, stops: [['parent', 'one']] })
  })
  test('When 打开历史列表 Then 中断的历史任务可重新打开且不重新执行', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount('list');[...document.querySelectorAll('button')].find(b=>b.textContent.includes('历史任务')).click();
      const result={opens:f.opens,stops:f.stops,reads:f.reads,interrupted:document.body.textContent.includes('已中断')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ opens: ['old'], stops: [], reads: [], interrupted: true })
  })
  test('When 分页持续返回下一页 Then 最多加载十页，不自动追读无限历史', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount();
      window.electronAPI.readAgyTask=async(s,id,after)=>{f.reads.push([s,id,after]);return {task:window.controls.task,events:[{sequence:after+1,timestamp:1,kind:'text',text:'页'}],nextSequence:after+1}};
      for(let index=0;index<12;index++){const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='加载更多活动');if(button){button.click();await window.controls.delay()}}
      const result={reads:f.reads.length,limited:document.body.textContent.includes('分页上限'),more:document.body.textContent.includes('加载更多活动')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ reads: 10, limited: true, more: false })
  })
  test('When 任务上报意外的宽松权限 Then 明确告警，不宣称运行受隔离', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount();f.emit({task:{...window.controls.task,permissionMode:'bypassPermissions',lastSequence:4},events:[{sequence:4,timestamp:4,kind:'unknown',details:{unrecognized:true}}]});await window.controls.delay();
      [...document.querySelectorAll('button')].find(b=>b.textContent==='任务信息').click();await window.controls.delay();
      const result={warning:document.body.textContent.includes('宽松权限模式'),unknown:document.body.textContent.includes('未知事件'),audit:document.body.textContent.includes('不是完整系统审计')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ warning: true, unknown: true, audit: true })
  })
  test('When 最终结果不完整或含结构化输出 Then 明确显示而不使用活动摘要冒充', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount();f.emit({task:{...window.controls.task,status:'failed',lastSequence:4,outputIncomplete:true,structuredOutput:{items:[{id:120,label:'独立结果'}]}},events:[]});await window.controls.delay();
      const result={partial:document.body.textContent.includes('最终结果不完整'),structured:document.body.textContent.includes('结构化最终结果'),item:document.body.textContent.includes('独立结果')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ partial: true, structured: true, item: true })
  })
  test('When 用户滚离底部后新活动到达 Then 不抢滚动并提供新活动入口', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount(),delay=window.controls.delay;
      const scroller=document.querySelector('[data-testid="agy-scroll"]');
      scroller.style.height='120px';scroller.style.flex='none';
      const events=Array.from({length:30},(_,i)=>({sequence:i+4,timestamp:1,kind:'text',text:'长活动 '+i+'\\n'.repeat(3)}));
      f.emit({task:{...window.controls.task,lastSequence:33},events});await delay();
      scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll'));
      f.emit({task:{...window.controls.task,lastSequence:34},events:[{sequence:34,timestamp:1,kind:'text',text:'新活动'}]});await delay();
      const stayed=scroller.scrollTop===0;
      const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='查看新活动');
      const offered=!!button;button?.click();await delay();
      const result={stayed,offered,followed:scroller.scrollTop>0};f.root.unmount();return result;
    `)
    expect(result).toEqual({ stayed: true, offered: true, followed: true })
  })
  test('When 读取失败 Then 显示错误并提供重试而不伪造活动', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount('panel',{fail:true});const result={error:document.querySelector('[role="alert"]').textContent,retry:document.body.textContent.includes('重试读取'),size:f.view()?.events.length??0};f.root.unmount();return result;
    `)
    expect(result).toEqual({ error: '读取失败', retry: true, size: 0 })
  })
  test('When 完成任务返回 Markdown Then 直接呈现正文、折叠执行记录并复制独立结果', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount(),delay=window.controls.delay;
      const response='## 审查结果\\n\\n已完成 **检查**。\\n\\n- 结论一\\n- 结论二';
      f.emit({task:{...window.controls.task,status:'completed',lastSequence:4,response,durationSeconds:17.444805},events:[]});await delay();
      const article=document.querySelector('article[aria-label="最终结果"]');
      [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='复制结果').click();await delay();
      const result={heading:article.querySelector('h2').textContent,strong:article.querySelector('strong').textContent,items:article.querySelectorAll('li').length,history:!!document.querySelector('[aria-label="CLI 活动时间线"]'),copies:f.copies,copied:!!document.querySelector('[aria-label="已复制结果"]'),iconOnly:document.querySelector('[aria-label="已复制结果"]').textContent==='',duration:document.body.textContent.includes('17.4s')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ heading: '审查结果', strong: '检查', items: 2, history: false, copies: ['## 审查结果\n\n已完成 **检查**。\n\n- 结论一\n- 结论二'], copied: true, iconOnly: true, duration: true })
  })
  test('When 连续文本、空片段与工具交错 Then 正文自然连贯且工具仍可展开', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount(),delay=window.controls.delay;
      f.emit({task:{...window.controls.task,lastSequence:8},events:[{sequence:4,timestamp:4,kind:'text',stepIndex:1,text:'**连续'},{sequence:5,timestamp:5,kind:'text',stepIndex:1,text:'输出**\\n'},{sequence:6,timestamp:6,kind:'text',stepIndex:1,text:'\\n'},{sequence:7,timestamp:7,kind:'tool',toolName:'write_file',state:'DONE',details:{result:'具体工具输出'}},{sequence:8,timestamp:8,kind:'text',stepIndex:2,text:'接下来的正文'}]});await delay();
      const timeline=document.querySelector('[aria-label="CLI 活动时间线"]');
      const result={strong:[...timeline.querySelectorAll('strong')].some(e=>e.textContent==='连续输出'),children:timeline.children.length,raw:timeline.textContent.includes('**连续'),detail:timeline.textContent.includes('具体工具输出'),done:timeline.textContent.includes('已结束'),unchanged:f.view().events.length};f.root.unmount();return result;
    `)
    expect(result).toEqual({ strong: true, children: 6, raw: false, detail: false, done: true, unchanged: 8 })
  })
  test('When 输出包含 HTML、外部图片与文件链接 Then 仅安全排版而不加载图片或激活链接', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount();
      f.emit({task:{...window.controls.task,status:'completed',lastSequence:4,response:'<script>window.untrusted=true</script>\\n\\n![远程图](https://example.invalid/tracker.png)\\n\\n[本地文件](file:///private/example) [命令](javascript:alert(1))'},events:[]});await window.controls.delay();
      const article=document.querySelector('article[aria-label="最终结果"]');
      const result={scripts:article.querySelectorAll('script').length,images:article.querySelectorAll('img').length,links:article.querySelectorAll('a').length,executed:!!window.untrusted,text:article.textContent.includes('远程图')&&article.textContent.includes('本地文件')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ scripts: 0, images: 0, links: 0, executed: false, text: true })
  })
  test('When 用户手动展开执行过程后任务完成 Then 保留用户选择、仍可查看事件详情', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount(),delay=window.controls.delay;
      const toggle=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('执行过程'));
      toggle.click();await delay();toggle.click();await delay();
      f.emit({task:{...window.controls.task,status:'completed',lastSequence:4,response:'完整结果'},events:[]});await delay();
      const open=!!document.querySelector('[aria-label="CLI 活动时间线"]');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='参数与结果详情').click();await delay();
      const result={open,details:document.body.textContent.includes('工具结果内容'),final:document.querySelector('article').textContent};f.root.unmount();return result;
    `)
    expect(result).toEqual({ open: true, details: true, final: '完整结果' })
  })
  test('When 失败任务没有独立结果 Then 保留过程、错误与无结果说明且不提供复制结果', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount();f.emit({task:{...window.controls.task,status:'failed',lastSequence:4,error:'CLI 退出异常'},events:[]});await window.controls.delay();
      const result={error:document.body.textContent.includes('CLI 退出异常'),missing:document.body.textContent.includes('未返回独立最终结果'),history:!!document.querySelector('[aria-label="CLI 活动时间线"]'),copy:!!document.querySelector('[aria-label="复制结果"]')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ error: true, missing: true, history: true, copy: false })
  })
  test('When 面板在窄宽度和深浅主题展示长标题、路径与代码 Then 不产生面板横向溢出且操作可达', async () => {
    const result = await renderer.run(`
      const f=await window.controls.mount(),delay=window.controls.delay;
      const fence=String.fromCharCode(96).repeat(3);f.emit({task:{...window.controls.task,status:'completed',lastSequence:4,title:'很长的任务标题'.repeat(20),cwd:'/'+('long-path/').repeat(40),response:fence+'text\\n'+'long_output_'.repeat(200)+'\\n'+fence+'\\n\\n| 项目 | 说明 |\\n| --- | --- |\\n| 名称 | 值 |'},events:[]});await delay();
      document.querySelector('[aria-label="agy 活动面板"]').style.width='320px';
      [...document.querySelectorAll('button')].find(b=>b.textContent==='任务信息').click();await delay();
      const fits=[];for(const theme of ['', 'dark']){document.documentElement.className=theme;await delay();const panel=document.querySelector('[aria-label="agy 活动面板"]');fits.push(panel.scrollWidth<=panel.clientWidth&&document.querySelector('[data-testid="agy-scroll"]').scrollWidth<=panel.clientWidth)}
      const result={fits,copy:!!document.querySelector('[aria-label="复制结果"]'),table:!!document.querySelector('article table')};f.root.unmount();return result;
    `)
    expect(result).toEqual({ fits: [true, true], copy: true, table: true })
  })
})
