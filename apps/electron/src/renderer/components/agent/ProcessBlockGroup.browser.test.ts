import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai';
    import {ProcessBlockGroup} from '@/components/agent/ProcessBlockGroup';
    import {ContentBlock} from '@/components/agent/ContentBlock';
    import {AssistantTurnRenderer} from '@/components/agent/SDKMessageRenderer';
    import {BasePathsProvider} from '@/components/ai-elements/message';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import {allPendingPermissionRequestsAtom} from '@/atoms/agent-atoms';
    import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root')),store=createStore();
    window.electronAPI={};
    window.timeline={
      async render({blocks,results=[],streaming=true,tail=true,approvalSession,approvalToolId='a',childBlocks,tasks=[],startedAt,durationMs,expand=true}){
        const messages=results.map(r=>({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:r.id,content:r.text??'',is_error:r.error}]},parent_tool_use_id:null}));
        store.set(allPendingPermissionRequestsAtom,approvalSession?new Map([[approvalSession,[{sessionId:approvalSession,requestId:'p',toolUseId:approvalToolId,toolName:'Bash',toolInput:{},description:'确认',dangerLevel:'normal'}]]]):new Map());
        root.render(React.createElement(Provider,{store},React.createElement(BasePathsProvider,{sessionId:'A'},React.createElement(TooltipProvider,null,
          React.createElement(ProcessBlockGroup,{blocks,allMessages:messages,isStreaming:streaming,startedAt,durationMs,taskActivities:tasks.map(task=>({toolUseId:'task-'+task.id,toolName:'TaskUpdate',input:{taskId:task.id,...task},done:true})),renderChildren:()=>{this.renderCalls++;return blocks.map((block,i)=>React.createElement(React.Fragment,{key:i},React.createElement(ContentBlock,{block,allMessages:messages,isStreaming:streaming,childBlocks})))}})))));
        await this.wait(360);if(expand&&document.querySelector('[data-process-group-toggle]')?.getAttribute('aria-expanded')==='false')await this.toggle();return this.read();
      },
      renderCalls:0,
      async renderTurn(blocks,results=[],expand=true){
        const message={type:'assistant',uuid:'assistant-1',parent_tool_use_id:null,message:{role:'assistant',content:blocks}};
        const messages=[message,...results.map(r=>({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:r.id,content:r.text??'',is_error:r.error}]},parent_tool_use_id:null}))];const turn={type:'assistant-turn',assistantMessages:[message],turnMessages:messages};
        root.render(React.createElement(Provider,{store},React.createElement(BasePathsProvider,{sessionId:'A'},React.createElement(TooltipProvider,null,React.createElement(AssistantTurnRenderer,{turn,allMessages:messages,isStreaming:true})))));
        await this.wait(360);if(expand&&document.querySelector('[data-process-group-toggle]')?.getAttribute('aria-expanded')==='false')await this.toggle();return this.read();
      },
      wait:ms=>new Promise(r=>setTimeout(r,ms)),
      read(){const button=document.querySelector('[data-process-group-toggle]');return {
        expanded:button?.getAttribute('aria-expanded'),
        controls:!!document.getElementById(button?.getAttribute('aria-controls')),
        statuses:[...document.querySelectorAll('[data-process-step-status]')].map(e=>e.dataset.processStepStatus),
        spinners:document.querySelectorAll('[data-process-node-running], .animate-spin').length,
        connectors:document.querySelectorAll('[data-process-step-connector]').length,
        colors:[...document.querySelectorAll('[data-process-step-indicator]')].map(e=>getComputedStyle(e).color),
        labels:[...document.querySelectorAll('[data-process-step-indicator]')].map(e=>e.getAttribute('aria-label'))
      };},
      async toggle(){document.querySelector('[data-process-group-toggle]').click();await this.wait(360);return this.read();}
    };
  `, {
    mainProcessSetup: `require('electron').ipcMain.handle('trace-capture', async (event, theme) => { const image = await BrowserWindow.fromWebContents(event.sender).webContents.capturePage(); require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'gamma-trace-' + theme + '.png'), image.toPNG()); });`,
    preloadSource: `require('electron').contextBridge.exposeInMainWorld('traceCapture', theme => require('electron').ipcRenderer.invoke('trace-capture', theme));`,
  })
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

interface TimelineSnapshot {
  expanded: string
  controls: boolean
  statuses: string[]
  spinners: number
  connectors: number
  colors: string[]
  labels: string[]
}

const tools = `[ {type:'tool_use',id:'a',name:'Bash',input:{command:'pwd'}}, {type:'tool_use',id:'b',name:'Bash',input:{command:'ls'}} ]`

describe('Given 可折叠执行过程时间线', () => {
  test('When 并行工具运行且逐一收到结果 Then 只为未完成工具保留运行圆环并连续连接节点', async () => {
    const snapshots = await renderer.run<TimelineSnapshot[]>(`
      const blocks=${tools},api=window.timeline;
      return [await api.render({blocks}),await api.render({blocks,results:[{id:'a'}]}),await api.render({blocks,results:[{id:'a'},{id:'b',text:'文件不存在',error:true}]})];
    `)
    expect(snapshots.map((item) => item.statuses)).toEqual([['running', 'running'], ['success', 'running'], ['success', 'error']])
    expect(snapshots.map((item) => item.spinners)).toEqual([2, 1, 0])
    expect(snapshots[0]?.connectors).toBe(1)
    expect(snapshots[2]?.colors[0]).not.toBe(snapshots[2]?.colors[1])
    expect(snapshots[2]?.labels).toEqual(['已完成', '执行失败'])
  }, 30_000)

  test('When 等待审批 Then 以会话与调用 ID 匹配等待节点，已有结果优先', async () => {
    const snapshots = await renderer.run<TimelineSnapshot[]>(`
      const blocks=${tools},api=window.timeline;
      return [await api.render({blocks,approvalSession:'A'}),await api.render({blocks,approvalSession:'B'}),await api.render({blocks,approvalSession:'A',results:[{id:'a'}]})];
    `)
    expect(snapshots.map((item) => item.statuses)).toEqual([['pending', 'running'], ['running', 'running'], ['success', 'running']])
    expect(snapshots[0]?.spinners).toBe(1)
  }, 30_000)

  test('When 历史工具未收到结果或被明确取消/拒绝 Then 不误标成功或正在运行', async () => {
    const snapshot = await renderer.run<TimelineSnapshot>(`
      const blocks=[...${tools},{type:'tool_use',id:'c',name:'Bash',input:{command:'ls'}}];
      await window.timeline.render({blocks,streaming:false,expand:false,results:[{id:'b',text:'操作已中止',error:true},{id:'c',text:'用户拒绝了此操作',error:true}]});
      return window.timeline.toggle();
    `)
    expect(snapshot.statuses).toEqual(['unknown', 'cancelled', 'denied'])
    expect(snapshot.spinners).toBe(0)
    expect(snapshot.expanded).toBe('true')
    expect(snapshot.controls).toBe(true)
  }, 30_000)

  test('When 思考和文字输出 Then 思考和文字节点始终保持中性', async () => {
    const snapshots = await renderer.run<TimelineSnapshot[]>(`
      const api=window.timeline,blocks=[{type:'thinking',thinking:'检查状态'},{type:'text',text:'正在检查'}];
      return [await api.render({blocks}),await api.render({blocks,tail:false})];
    `)
    expect(snapshots.map((item) => item.statuses)).toEqual([['recorded', 'recorded'], ['recorded', 'recorded']])
    expect(snapshots.map((item) => item.spinners)).toEqual([0, 0])
  }, 30_000)

  test('When 用户主动展开后执行结束 Then 保留展开选择且节点立即更新，随后可手动折叠', async () => {
    const snapshots = await renderer.run<TimelineSnapshot[]>(`
      const api=window.timeline,blocks=${tools};
      await api.render({blocks});await api.toggle();await api.toggle();
      await api.render({blocks,streaming:false,results:[{id:'a'},{id:'b'}]});await api.wait(4100);
      return [api.read(),await api.toggle()];
    `)
    expect(snapshots[0]?.expanded).toBe('true')
    expect(snapshots[0]?.statuses).toEqual(['success', 'success'])
    expect(snapshots[1]?.expanded).toBe('false')
    expect(snapshots[1]?.statuses).toEqual([])
  }, 30_000)

  test('When 完整消息包含隐藏任务工具与最终答案 Then 不产生空节点且答案留在时间线外', async () => {
    const snapshot = await renderer.run<TimelineSnapshot & { answerOutside: boolean }>(`
      const api=window.timeline;
      await api.renderTurn([
        {type:'thinking',thinking:'检查项目'},
        {type:'tool_use',id:'task',name:'TaskCreate',input:{subject:'检查'}},
        {type:'unsupported'},
        {type:'tool_use',id:'a',name:'Bash',input:{command:'pwd'}},
        {type:'text',text:'最终答复'}
      ]);
      const text=[...document.querySelectorAll('p')].find(p=>p.textContent==='最终答复');
      return {...api.read(),answerOutside:!!text&&!text.closest('[data-process-step-status]')};
    `)
    expect(snapshot.statuses).toEqual(['recorded', 'running'])
    expect(snapshot.connectors).toBe(1)
    expect(snapshot.answerOutside).toBe(true)
  }, 30_000)



  test('When 在时间线内展开子代理 Then 子工具仍保留独立运行指示', async () => {
    const snapshot = await renderer.run<TimelineSnapshot>(`
      const api=window.timeline;
      await api.render({blocks:[{type:'tool_use',id:'agent',name:'Agent',input:{prompt:'检查项目'}}],childBlocks:${tools}});
      document.querySelector('[data-process-step-status] button').click();await api.wait(100);return api.read();
    `)
    expect(snapshot.statuses).toEqual(['running', 'running', 'running'])
    expect(snapshot.spinners).toBe(3)
  }, 30_000)

  test('When 深色时间线显示多种状态 Then 节点为紧凑圆点并为工具行显示图标与折叠箭头', async () => {
    const view = await renderer.run<{
      size: string[][]; colors: string[]; backgrounds: string[]; icons: number;
      header: { expanded: string; glyph: string; label: string }; rows: string[]; rowHeights: number[]; fontSizes: string[];
      textColor: string; lineColor: string; summaries: string[]; rowIcons: number;
    }>(`
      document.documentElement.classList.add('dark');const api=window.timeline;
      await api.render({blocks:[...${tools},{type:'tool_use',id:'c',name:'Bash',input:{command:'bun run typecheck'}},{type:'tool_use',id:'d',name:'Bash',input:{command:'bun run build'}}],results:[{id:'a'},{id:'b',text:'Error: 文件不存在\\n详细堆栈',error:true}],approvalSession:'A',approvalToolId:'d'});
      const nodes=[...document.querySelectorAll('[data-process-step-indicator]')],rows=[...document.querySelectorAll('[data-process-action-row]')];
      return {size:nodes.map(e=>[getComputedStyle(e).width,getComputedStyle(e).height]),colors:nodes.map(e=>getComputedStyle(e).color),backgrounds:nodes.map(e=>getComputedStyle(e).backgroundColor),icons:document.querySelectorAll('[data-process-step-indicator] svg').length,
        header:{expanded:document.querySelector('[data-process-group-toggle] svg[data-disclosure-chevron]').getAttribute('data-expanded'),glyph:document.querySelector('[data-process-group-toggle] svg').tagName,label:document.querySelector('[data-process-group-toggle]').getAttribute('aria-label')},
        rows:rows.map(e=>e.textContent),rowHeights:rows.map(e=>e.getBoundingClientRect().height),fontSizes:rows.map(e=>getComputedStyle(e).fontSize),
        textColor:rows[0]&&getComputedStyle(rows[0]).color,lineColor:getComputedStyle(document.querySelector('[data-process-step-connector]')).backgroundColor,
        summaries:[...document.querySelectorAll('[data-process-step-note]')].map(e=>e.textContent),rowIcons:rows.reduce((count,e)=>count+e.querySelectorAll('svg').length,0)};
    `)
    expect(view.size).toEqual(Array(4).fill(['4px', '4px']))
    expect(view.colors[0]).not.toBe(view.colors[1])
    expect(view.backgrounds.slice(2)).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
    expect(view.icons).toBe(0)
    expect(view.header).toEqual({ expanded: 'true', glyph: 'svg', label: '收起工具调用日志' })
    expect(view.rows[0]).toBe('执行 pwd')
    expect(view.rows[1]).toBe('执行 ls')
    expect(view.rows.join(' ')).not.toMatch(/Bash|已完成|执行失败|正在执行|详细堆栈/)
    expect(view.rowHeights).toEqual([32, 32, 32, 32])
    expect(view.fontSizes).toEqual(Array(4).fill('13px'))
    expect(view.textColor).toBe('rgba(240, 238, 230, 0.76)')
    expect(view.lineColor).toBe('rgba(240, 238, 230, 0.12)')
    expect(view.summaries).toEqual([])
    expect(view.rowIcons).toBe(8)
  }, 30_000)

  test('When 思考超过两行 Then 默认两行淡色斜体且可展开，没有标签、背景和边框', async () => {
    const view = await renderer.run<{ before: number; after: number; style: string; label: boolean; border: string; background: string }>(`
      const api=window.timeline;await api.render({blocks:[{type:'thinking',thinking:'第一行\\n第二行\\n第三行\\n第四行'}]});
      const text=document.querySelector('[data-process-text]'),button=text.closest('button'),before=text.getBoundingClientRect().height;
      button.click();await api.wait(250);
      return {before,after:text.getBoundingClientRect().height,style:getComputedStyle(text).fontStyle,label:document.getElementById('root').textContent.includes('THINKING'),border:getComputedStyle(button).borderStyle,background:getComputedStyle(button).backgroundColor};
    `)
    expect(view.before).toBe(56)
    expect(view.after).toBe(112)
    expect(view.style).toBe('italic')
    expect(view.label).toBe(false)
    expect(view.border).toBe('none')
    expect(view.background).toBe('rgba(0, 0, 0, 0)')
  }, 30_000)

  test('When 流式更新替换块对象但旧文字未变化 Then 缓存节点仍使用极简内容', async () => {
    const result = await renderer.run<{ labels: boolean; texts: number }>(`
      const api=window.timeline,blocks=[{type:'thinking',thinking:'检查结构'},...Array.from({length:5},(_,i)=>({type:'tool_use',id:'t'+i,name:'Bash',input:{command:'pwd'}}))];
      await api.render({blocks});await api.render({blocks:blocks.map(b=>({...b}))});
      return {labels:document.getElementById('root').textContent.includes('THINKING'),texts:document.querySelectorAll('[data-process-text]').length};
    `)
    expect(result.labels).toBe(false)
    expect(result.texts).toBe(1)
  }, 30_000)

})

describe('Given 计划清单加单行实时状态', () => {
  test('When 实时执行且尚未点击箭头 Then 自动展示日志，点击当前动作保留展开状态', async () => {
    const view = await renderer.run<{ before: TimelineSnapshot; afterText: TimelineSnapshot; opened: TimelineSnapshot; calls: number; text: string; arrow: string }>(`
      const api=window.timeline;
      const before=await api.render({blocks:${tools},expand:false,startedAt:Date.now()-18000});
      const calls=api.renderCalls;
      document.querySelector('[data-process-current-action]').click();await api.wait(260);
      const afterText=api.read(),text=document.querySelector('[data-process-live-status]').textContent;
      const arrow=document.querySelector('[data-process-group-toggle] svg[data-disclosure-chevron]').getAttribute('data-expanded');
      return {before,afterText,opened:await api.toggle(),calls,text,arrow};
    `)
    expect(view.before.expanded).toBe('true')
    expect(view.before.statuses).toEqual(['running', 'running'])
    expect(view.afterText.expanded).toBe('true')
    expect(view.calls).toBeGreaterThan(0)
    expect(view.opened.expanded).toBe('false')
    expect(view.opened.statuses).toEqual([])
    expect(view.text).toMatch(/^···正在执行 ls18s$/)
    expect(view.arrow).toBe('true')
    expect(view.text).not.toMatch(/工具调用|思考|Bash/)
  }, 30_000)

  test('When 历史执行过程初次出现 Then 同样默认收起且不补造时间', async () => {
    const view = await renderer.run<{ expanded: string; elapsed: boolean; animation: string }>(`
      const api=window.timeline;await api.render({blocks:${tools},streaming:false,expand:false});
      return {expanded:api.read().expanded,elapsed:!!document.querySelector('[data-process-elapsed]'),animation:getComputedStyle(document.querySelector('.process-live-dots > span')).animationName};
    `)
    expect(view).toEqual({ expanded: 'false', elapsed: false, animation: 'none' })
  }, 30_000)

  test('When 深色主题计划包含完成、运行、未开始、失败、审批 Then 只显示规定的圆圈、文字和错误摘要', async () => {
    const view = await renderer.run<{
      order: boolean; heights: number[]; sizes: string[][]; gaps: string[]; fonts: string[]; colors: string[];
      error: { text: string; color: string; height: number }; border: string; background: string; rowText: string[];
      liveColor: string; dotColor: string; dotCount: number; buttons: number; circleFills: string[];
    }>(`
      document.documentElement.classList.add('dark');const api=window.timeline;
      await api.render({blocks:${tools},expand:false,tasks:[
        {id:'done',subject:'定位组件',status:'completed'},
        {id:'live',subject:'修改样式',status:'in_progress'},
        {id:'next',subject:'运行验证',status:'pending'},
        {id:'error',subject:'检查输入',status:'error',description:'Error: 文件不存在\\n完整堆栈'},
        {id:'approval',subject:'授权操作',status:'blocked'}
      ]});
      const card=document.querySelector('[data-process-plan]'),rows=[...card.querySelectorAll('.process-plan-row')],error=card.querySelector('[data-plan-error]');
      return {order:!!(card.compareDocumentPosition(document.querySelector('[data-process-live-status]'))&Node.DOCUMENT_POSITION_FOLLOWING),
        heights:rows.map(e=>e.getBoundingClientRect().height),sizes:rows.map(e=>{const s=getComputedStyle(e.querySelector('svg'));return [s.width,s.height]}),gaps:rows.map(e=>getComputedStyle(e).gap),fonts:rows.map(e=>getComputedStyle(e).fontSize),colors:rows.map(e=>getComputedStyle(e).color),
        error:{text:error.textContent,color:getComputedStyle(error).color,height:error.getBoundingClientRect().height},border:getComputedStyle(card).borderTop,background:getComputedStyle(card).backgroundColor,rowText:rows.map(e=>e.textContent),liveColor:getComputedStyle(document.querySelector('[data-process-live-status]')).color,dotColor:getComputedStyle(document.querySelector('.process-live-dots')).color,dotCount:document.querySelector('.process-live-dots').children.length,buttons:card.querySelectorAll('button').length,
        circleFills:[getComputedStyle(card.querySelector('.process-plan-done')).color,getComputedStyle(card.querySelector('.process-plan-failed')).color]};
    `)
    expect(view.order).toBe(true)
    expect(view.heights).toEqual(Array(5).fill(28))
    expect(view.sizes).toEqual(Array(5).fill(['16px', '16px']))
    expect(view.gaps).toEqual(Array(5).fill('10px'))
    expect(view.fonts).toEqual(Array(5).fill('13px'))
    expect(view.colors).toEqual(['rgba(240, 238, 230, 0.45)', 'rgba(240, 238, 230, 0.9)', 'rgba(240, 238, 230, 0.6)', 'rgba(240, 238, 230, 0.6)', 'rgba(240, 238, 230, 0.6)'])
    expect(view.error).toEqual({ text: '文件不存在', color: 'rgba(240, 238, 230, 0.4)', height: 28 })
    expect(view.border).toBe('1px solid rgba(240, 238, 230, 0.06)')
    // Chromium 的颜色序列化会把 alpha 量化到 8-bit，允许一个量化步长。
    expect(Number(view.background.match(/, ([\d.]+)\)$/)?.[1])).toBeCloseTo(0.025, 2)
    expect(view.rowText).toEqual(['定位组件', '修改样式', '运行验证', '检查输入', '授权操作'])
    expect(view.liveColor).toBe('rgba(240, 238, 230, 0.6)')
    expect(view.dotColor).toBe('rgb(217, 119, 87)')
    expect(view.dotCount).toBe(3)
    expect(view.buttons).toBe(0)
    expect(view.circleFills).toEqual(['rgb(133, 131, 123)', 'rgb(217, 119, 87)'])
  }, 30_000)

  test('When 当前会话审批在等待或迟到 Then 只在确实未结束时将进行中圆圈改为琥珀空心圆', async () => {
    const views = await renderer.run<Array<{ status: string; waiting: boolean }>>(`
      const api=window.timeline,tasks=[{id:'live',subject:'修改样式',status:'in_progress'}];
      const read=()=>({status:document.querySelector('[data-plan-status]').dataset.planStatus,waiting:document.querySelector('[data-process-current-action]').textContent.includes('等待确认')});
      await api.render({blocks:${tools},expand:false,tasks,approvalSession:'A'});const a=read();
      await api.render({blocks:${tools},expand:false,tasks,approvalSession:'B'});const b=read();
      await api.render({blocks:${tools},expand:false,tasks,approvalSession:'A',results:[{id:'a'}]});return [a,b,read()];
    `)
    expect(views).toEqual([{ status: 'approval', waiting: true }, { status: 'in_progress', waiting: false }, { status: 'in_progress', waiting: false }])
  }, 30_000)

  test('When 只有已确认计划、没有工具节点 Then 仍显示清单且没有空日志节点', async () => {
    const view = await renderer.run<{ plans: number; statuses: string[]; text: string }>(`
      const api=window.timeline;
      await api.renderTurn([{type:'tool_use',id:'task',name:'TaskCreate',input:{subject:'检查布局'}}],[{id:'task',text:JSON.stringify({task:{id:'first',subject:'检查布局',status:'pending'}})}],false);
      return {plans:document.querySelectorAll('[data-plan-row]').length,statuses:api.read().statuses,text:document.querySelector('[data-process-plan]')?.textContent};
    `)
    expect(view).toEqual({ plans: 1, statuses: [], text: '检查布局' })
  }, 30_000)

  test('When 运行结束 Then 时间停止且保留手动展开选择，200ms 淡变没有缩放或呼吸节点', async () => {
    const view = await renderer.run<{ elapsed: string; frozen: string; expanded: string; duration: string; animations: string[]; transforms: string[] }>(`
      const api=window.timeline,blocks=${tools};await api.render({blocks,startedAt:Date.now()-18000});
      await api.render({blocks,streaming:false,durationMs:19000,results:[{id:'a'},{id:'b'}]});
      const elapsed=document.querySelector('[data-process-elapsed]').textContent;await api.wait(1200);
      return {elapsed,frozen:document.querySelector('[data-process-elapsed]').textContent,expanded:api.read().expanded,duration:getComputedStyle(document.querySelector('[data-process-log]')).transitionDuration,
        animations:[...document.querySelectorAll('.process-timeline-node,.process-timeline-connector')].map(e=>getComputedStyle(e).animationName),transforms:[...document.querySelectorAll('.process-plan-circle,.process-timeline-node')].map(e=>getComputedStyle(e).transform)};
    `)
    expect(view.elapsed).toBe('19s')
    expect(view.frozen).toBe('19s')
    expect(view.expanded).toBe('true')
    expect(view.duration).toBe('0.32s, 0.24s')
    expect(view.animations.every((name) => name === 'none')).toBe(true)
    expect(view.transforms.every((name) => name === 'none')).toBe(true)
  }, 30_000)

  test('When 切换浅色主题和窄宽度 Then 保留单行省略和可访问的小箭头，不发生横向溢出', async () => {
    const view = await renderer.run<{ overflow: boolean; color: string; background: string; rowHeight: number; actionHeight: number; focused: boolean }>(`
      document.documentElement.classList.remove('dark');document.getElementById('root').style.width='220px';
      await window.timeline.render({blocks:[{type:'tool_use',id:'a',name:'Edit',input:{path:'/repo/VeryLongProductCardFilenameWithMoreCharacters.tsx'}}],expand:false,tasks:[{id:'a',subject:'很长的计划标题需要在有限宽度内维持一行显示且不能溢出',status:'pending'}],startedAt:Date.now()-18000});
      const root=document.getElementById('root'),card=root.querySelector('[data-process-plan]'),action=root.querySelector('[data-process-current-action]'),button=root.querySelector('[data-process-group-toggle]');button.focus();
      return {overflow:root.scrollWidth>root.clientWidth,color:getComputedStyle(action).color,background:getComputedStyle(card).backgroundColor,rowHeight:root.querySelector('.process-plan-row').getBoundingClientRect().height,actionHeight:action.getBoundingClientRect().height,focused:document.activeElement===button};
    `)
    expect(view.overflow).toBe(false)
    expect(view.color).not.toBe('rgba(240, 238, 230, 0.6)')
    expect(view.background).not.toBe('rgba(240, 238, 230, 0.025)')
    expect(view.rowHeight).toBe(28)
    expect(view.actionHeight).toBe(28)
    expect(view.focused).toBe(true)
  }, 30_000)
})


describe('Given 视频风格的自动执行轨迹', () => {
  test('When 命令和搜索连续执行 Then 当前结果自动展开，下一项出现时旧结果自动收起', async () => {
    const result = await renderer.run<{ open: string[]; clicked: string | null; updated: string | null; newest: string | null; reopened: string | null; finished: string | null }>(`
      const blocks=[{type:'tool_use',id:'trace-1',name:'Bash',input:{command:'pwd'}},{type:'tool_use',id:'trace-2',name:'WebSearch',input:{query:'Gamma'}},{type:'tool_use',id:'trace-3',name:'Bash',input:{command:'ls'}}];
      await window.timeline.render({blocks,expand:false});
      const open=[...document.querySelectorAll('[data-process-action-row]')].map(e=>e.getAttribute('aria-expanded'));
      document.querySelectorAll('[data-process-action-row]')[2].click();await window.timeline.wait(360);
      const clicked=document.querySelectorAll('[data-process-action-row]')[2].getAttribute('aria-expanded');
      await window.timeline.render({blocks:[...blocks,{type:'tool_use',id:'trace-4',name:'Bash',input:{command:'date'}}],expand:false});
      const updated=document.querySelectorAll('[data-process-action-row]')[2].getAttribute('aria-expanded');
      const newest=document.querySelectorAll('[data-process-action-row]')[3].getAttribute('aria-expanded');
      document.querySelectorAll('[data-process-action-row]')[2].click();await window.timeline.wait(360);
      const reopened=document.querySelectorAll('[data-process-action-row]')[2].getAttribute('aria-expanded');
      await window.timeline.render({blocks,streaming:false,expand:false});
      return {open,clicked,updated,newest,reopened,finished:document.querySelector('[data-process-group-toggle]')?.getAttribute('aria-expanded')};
    `)
    expect(result.open).toEqual(['false', 'false', 'true'])
    expect(result.clicked).toBe('false')
    expect(result.updated).toBe('false')
    expect(result.newest).toBe('true')
    expect(result.reopened).toBe('true')
    expect(result.finished).toBe('false')
  }, 30_000)
})


test('Given 亮暗主题 When 搜索和命令结果展开 Then 卡片跟随主题且隐藏详情不能获得焦点', async () => {
  const views = await renderer.run<Array<{ background: string; inert: boolean }>>(`
    const blocks=[{type:'tool_use',id:'a',name:'WebSearch',input:{query:'Gamma 执行轨迹'}},{type:'tool_use',id:'b',name:'Bash',input:{command:'bun run typecheck'}}],views=[];
    for (const theme of ['light','dark']) {
      document.documentElement.classList.toggle('dark',theme==='dark');
      await window.timeline.render({blocks,results:[{id:'a',text:'找到 Gamma 项目相关结果'},{id:'b',text:'All packages passed typecheck'}],expand:false});
      document.querySelectorAll('[data-process-action-row]').forEach(button=>{if(button.getAttribute('aria-expanded')!=='true')button.click()});await window.timeline.wait(360);
      await window.traceCapture(theme);
      const cards=[...document.querySelectorAll('.process-timeline-details')];
      const button=document.querySelector('[data-process-action-row]');button.click();await window.timeline.wait(360);
      views.push({background:getComputedStyle(cards[1]).backgroundColor,inert:document.querySelector('.process-trace-reveal').hasAttribute('inert')});
      document.querySelectorAll('[data-process-action-row]').forEach(button=>{if(button.getAttribute('aria-expanded')==='true')button.click()});await window.timeline.wait(360);
    }
    return views;
  `)
  expect(views[0]?.background).not.toBe(views[1]?.background)
  expect(views.every(view => view.inert)).toBe(true)
}, 30_000)


test('Given 工具之间有空增量 When 渲染执行轨迹 Then 不生成空圆点且连线与工具状态保持对应', async () => {
  const view = await renderer.run<TimelineSnapshot>(`
    await window.timeline.renderTurn([
      {type:'tool_use',id:'a',name:'Read',input:{path:'/repo/a.ts'}},
      {type:'thinking',thinking:''},
      {type:'text',text:'  \\n  '},
      {type:'thinking',thinking:'\u200B\uFEFF'},
      {type:'tool_use',id:'b',name:'Bash',input:{command:'pwd'}},
      {type:'thinking',thinking:'有效思考'},
      {type:'text',text:'最终答复'}
    ],[{id:'a',text:'文件内容'}]);
    return window.timeline.read();
  `)
  expect(view.statuses).toEqual(['success', 'running', 'recorded'])
  expect(view.connectors).toBe(2)
}, 30_000)
