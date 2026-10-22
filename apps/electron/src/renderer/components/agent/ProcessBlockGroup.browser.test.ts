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
      async render({blocks,results=[],streaming=true,tail=true,approvalSession,approvalToolId='a',childBlocks}){
        const messages=results.map(r=>({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:r.id,content:r.text??'',is_error:r.error}]},parent_tool_use_id:null}));
        store.set(allPendingPermissionRequestsAtom,approvalSession?new Map([[approvalSession,[{sessionId:approvalSession,requestId:'p',toolUseId:approvalToolId,toolName:'Bash',toolInput:{},description:'确认',dangerLevel:'normal'}]]]):new Map());
        root.render(React.createElement(Provider,{store},React.createElement(BasePathsProvider,{sessionId:'A'},React.createElement(TooltipProvider,null,
          React.createElement(ProcessBlockGroup,{blocks,allMessages:messages,isStreaming:streaming,renderChildren:()=>blocks.map((block,i)=>React.createElement(React.Fragment,{key:i},React.createElement(ContentBlock,{block,allMessages:messages,isStreaming:streaming,childBlocks})))})))));
        await this.wait(100);return this.read();
      },
      async renderTurn(blocks){
        const message={type:'assistant',uuid:'assistant-1',parent_tool_use_id:null,message:{role:'assistant',content:blocks}};
        const turn={assistantMessages:[message],turnMessages:[message]};
        root.render(React.createElement(Provider,{store},React.createElement(BasePathsProvider,{sessionId:'A'},React.createElement(TooltipProvider,null,React.createElement(AssistantTurnRenderer,{turn,allMessages:[message],isStreaming:true})))));
        await this.wait(100);return this.read();
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
      async toggle(){document.querySelector('[data-process-group-toggle]').click();await this.wait(550);return this.read();}
    };
  `)
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
  test('When 并行工具运行且逐一收到结果 Then 只为未完成工具转圈并连续连接节点', async () => {
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

  test('When 历史工具未收到结果或被明确取消/拒绝 Then 不误标成功，也不转圈', async () => {
    const snapshot = await renderer.run<TimelineSnapshot>(`
      const blocks=[...${tools},{type:'tool_use',id:'c',name:'Bash',input:{command:'ls'}}];
      await window.timeline.render({blocks,streaming:false,results:[{id:'b',text:'操作已中止',error:true},{id:'c',text:'用户拒绝了此操作',error:true}]});
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

  test('When 深色时间线显示多种状态 Then 节点为精确8px纯色圆点/细环且没有节点内图标', async () => {
    const view = await renderer.run<{
      size: string[][]; colors: string[]; backgrounds: string[]; icons: number;
      header: string; rows: string[]; rowHeights: number[]; fontSizes: string[];
      textColor: string; lineColor: string; summaries: string[]; chevronOpacity: string[];
    }>(`
      document.documentElement.classList.add('dark');const api=window.timeline;
      await api.render({blocks:[...${tools},{type:'tool_use',id:'c',name:'Bash',input:{command:'bun run typecheck'}},{type:'tool_use',id:'d',name:'Bash',input:{command:'bun run build'}}],results:[{id:'a'},{id:'b',text:'Error: 文件不存在\\n详细堆栈',error:true}],approvalSession:'A',approvalToolId:'d'});
      const nodes=[...document.querySelectorAll('[data-process-step-indicator]')],rows=[...document.querySelectorAll('[data-process-action-row]')];
      return {size:nodes.map(e=>[getComputedStyle(e).width,getComputedStyle(e).height]),colors:nodes.map(e=>getComputedStyle(e).color),backgrounds:nodes.map(e=>getComputedStyle(e).backgroundColor),icons:document.querySelectorAll('[data-process-step-indicator] svg').length,
        header:document.querySelector('[data-process-group-toggle]').textContent,
        rows:rows.map(e=>e.textContent),rowHeights:rows.map(e=>e.getBoundingClientRect().height),fontSizes:rows.map(e=>getComputedStyle(e).fontSize),
        textColor:rows[0]&&getComputedStyle(rows[0]).color,lineColor:getComputedStyle(document.querySelector('[data-process-step-connector]')).backgroundColor,
        summaries:[...document.querySelectorAll('[data-process-step-note]')].map(e=>e.textContent),chevronOpacity:rows.map(e=>getComputedStyle(e.querySelector('svg')).opacity)};
    `)
    expect(view.size).toEqual(Array(4).fill(['8px', '8px']))
    expect(view.colors).toEqual(['rgb(95, 184, 120)', 'rgb(229, 100, 90)', 'rgb(217, 160, 91)', 'rgb(217, 160, 91)'])
    expect(view.backgrounds.slice(2)).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
    expect(view.icons).toBe(0)
    expect(view.header).toBe('4 次工具调用 · 0 条思考')
    expect(view.rows[0]).toBe('pwd')
    expect(view.rows[1]).toContain('文件不存在')
    expect(view.rows.join(' ')).not.toMatch(/Bash|已完成|执行失败|正在执行|详细堆栈/)
    expect(view.rowHeights).toEqual([28, 28, 28, 28])
    expect(view.fontSizes).toEqual(Array(4).fill('13px'))
    expect(view.textColor).toBe('rgba(255, 255, 255, 0.72)')
    expect(view.lineColor).toBe('rgba(255, 255, 255, 0.12)')
    expect(view.summaries).toEqual(['文件不存在', '等待授权'])
    expect(view.chevronOpacity).toEqual(Array(4).fill('0'))
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
