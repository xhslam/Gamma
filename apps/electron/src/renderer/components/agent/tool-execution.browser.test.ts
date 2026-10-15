import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {Provider,createStore} from 'jotai';
    import {ContentBlock} from '@/components/agent/ContentBlock';
    import {BasePathsProvider} from '@/components/ai-elements/message';
    import {allPendingPermissionRequestsAtom} from '@/atoms/agent-atoms';
    import {TooltipProvider} from '@/components/ui/tooltip';
    window.toolStatusRegression={async render({result,streaming=false,name='Bash',input={command:'pwd'},approvalSession,approvalToolId='tool-1'}){
      window.electronAPI={};const root=createRoot(document.getElementById('root')),store=createStore();
      if(approvalSession)store.set(allPendingPermissionRequestsAtom,new Map([[approvalSession,[{sessionId:approvalSession,requestId:'permission-1',toolUseId:approvalToolId,toolName:'Bash',toolInput:{},description:'需要确认',dangerLevel:'normal'}]]]));
      const messages=result===undefined?[]:[{type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'tool-1',content:result.text,is_error:result.error}]},parent_tool_use_id:null}];
      root.render(React.createElement(Provider,{store},React.createElement(BasePathsProvider,{sessionId:'A'},React.createElement(TooltipProvider,null,React.createElement(ContentBlock,{block:{type:'tool_use',id:'tool-1',name,input},allMessages:messages,isStreaming:streaming})))));
      await new Promise(r=>setTimeout(r,70));const badge=document.querySelector('[data-tool-execution-status]');
      const output={status:badge?.dataset.toolExecutionStatus,label:badge?.textContent,spinner:!!document.querySelector('.animate-spin'),text:document.getElementById('root').textContent};root.unmount();return output;
    }};
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实工具卡片与 tool_use_id 关联结果', () => {
  test('When 会话结束但无工具结果 Then 显示未知而非成功', async () => {
    const result = await renderer.run<{ status: string; label: string; spinner: boolean }>('return window.toolStatusRegression.render({})')
    expect(result.status).toBe('unknown')
    expect(result.label).toBe('未收到执行结果')
    expect(result.spinner).toBe(false)
  }, 30_000)
  test('When 正在运行或收到真实终态 Then 精确显示结果且终态不转圈', async () => {
    const result = await renderer.run<Array<{ status: string; spinner: boolean }>>(`
      const api=window.toolStatusRegression,results=[];
      for(const input of [{streaming:true},{result:{text:'',error:false}},{result:{text:'Error: 用户拒绝了此操作',error:true}},{result:{text:'操作已中止',error:true}},{result:{text:'命令失败',error:true}}])results.push(await api.render(input));return results;
    `)
    expect(result.map((item) => item.status)).toEqual(['running', 'success', 'denied', 'cancelled', 'error'])
    expect(result.map((item) => item.spinner)).toEqual([true, false, false, false, false])
  }, 30_000)
  test('When 同轮工具等待授权 Then 按会话和调用ID显示等待，不能冒充正在执行', async () => {
    const results = await renderer.run<Array<{ status: string; spinner: boolean }>>(`
      const api=window.toolStatusRegression;
      return [await api.render({streaming:true,approvalSession:'A'}),await api.render({streaming:true,approvalSession:'B'}),await api.render({streaming:true,approvalSession:'A',approvalToolId:'other'}),await api.render({approvalSession:'A',result:{text:'',error:false}})];
    `)
    expect(results.map((result) => result.status)).toEqual(['pending', 'running', 'running', 'success'])
    expect(results[0]?.spinner).toBe(false)
  }, 30_000)
  test('When Agent委派工具没有结果 Then 也不得虚构已完成', async () => {
    const result = await renderer.run<{ status: string }>(`return window.toolStatusRegression.render({name:'Agent',input:{prompt:'分析任务'}})`)
    expect(result.status).toBe('unknown')
  }, 30_000)
})
