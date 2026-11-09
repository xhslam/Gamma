import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai';
    import {MessageResponse} from '@/components/ai-elements/message';
    import {IntelligentUiSessionProvider} from '@/components/intelligent-ui/IntelligentUiContext';
    import {intelligentUiEnabledAtom} from '@/atoms/ui-preferences';
    import '@/styles/globals.css';
    const store=createStore(), root=createRoot(document.getElementById('root')), calls=[];
    window.electronAPI={writeClipboardText:async()=>{}};
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.genui={store,calls,sleep,
      async until(predicate){for(let i=0;i<200;i++){if(predicate())return;await sleep(15)}throw new Error('UI 未达到预期:'+document.body.innerText)},
      mount(spec,{enabled=true,assistant=true,streaming=false,session='s1',workspace='w1',block='m1:0',closed=true,canSend=true}={}){
        store.set(intelligentUiEnabledAtom,enabled);
        const text='\u0060\u0060\u0060dsh-ui\\n'+(typeof spec==='string'?spec:JSON.stringify(spec))+(closed?'\\n\u0060\u0060\u0060':'');
        root.render(React.createElement(Provider,{store},React.createElement(IntelligentUiSessionProvider,{key:workspace+session,value:{workspaceId:workspace,sessionId:session,canSend,sendAction:async(block,event)=>{calls.push({session,workspace,block,event})}}},React.createElement(MessageResponse,{intelligentUi:assistant?{blockId:block,isStreaming:streaming}:undefined},text))));
      }
    };
  `, { mainProcessReady: `
    require('electron').session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details,callback)=>callback({cancel:true}));
  ` })
}, 120000)
afterAll(async () => { await renderer?.dispose() })

describe('官方 GenUI 内嵌真实 Chromium 验收', () => {
  test('Given 开关与不同消息范围 When 渲染 Then 只有开启的助手正文激活且保留代码降级', async () => {
    const result = await renderer.run<{ active: boolean; userCode: boolean; disabledCode: boolean; streaming: boolean; malformed: boolean }>(`
      const g=window.genui, spec={items:[{type:'stat',label:'销售额',value:'128'},{type:'table',columns:['名称','数量'],rows:[['B','2'],['A','1']]}]};
      g.mount(spec); await g.until(()=>document.querySelector('[data-intelligent-ui]'));
      const active=!!document.querySelector('[data-genui]')&&document.body.innerText.includes('销售额');
      g.mount(spec,{assistant:false});await g.until(()=>!document.querySelector('[data-intelligent-ui]')&&document.querySelector('pre')); const userCode=!document.querySelector('[data-genui]');
      g.mount(spec,{enabled:false});await g.sleep(70);const disabledCode=!document.querySelector('[data-genui]')&&!!document.querySelector('pre');
      g.mount(spec,{streaming:true});await g.until(()=>document.body.innerText.includes('正在生成'));const streaming=!document.querySelector('[data-genui]');
      g.mount('{bad');await g.until(()=>document.querySelector('[data-intelligent-ui-fallback]'));const malformed=!document.querySelector('[data-genui]');
      return {active,userCode,disabledCode,streaming,malformed};
    `)
    expect(result).toEqual({ active: true, userCode: true, disabledCode: true, streaming: true, malformed: true })
  }, 120000)
  test('Given 表格和表单 When 本地编辑排序并确认交互 Then 编辑不外发且确认仅发来源会话', async () => {
    const result = await renderer.run<{ sorted: boolean; localOnly: boolean; preview: boolean; sent: number; session: string; value: string; persisted: boolean; isolated: boolean }>(`
      const g=window.genui,spec={items:[{type:'table',columns:['数量'],rows:[['2'],['1']]},{type:'input',id:'name',label:'姓名'},{type:'submit',label:'分析',action:'analyze',groups:['name']}]};
      g.mount(spec);await g.until(()=>document.querySelector('[data-genui]'));
      const header=document.querySelector('[data-genui] th button');header.click();await g.sleep(50);
      const sorted=document.querySelector('[data-genui] tbody tr').innerText.includes('1');
      const input=document.querySelector('[data-genui] input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,'落花流水');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await g.sleep(80);
      const localOnly=g.calls.length===0;
      [...document.querySelectorAll('button')].find(b=>b.textContent==='分析').click();await g.until(()=>document.querySelector('[data-ui-action-preview]'));const preview=g.calls.length===0;
      [...document.querySelectorAll('button')].find(b=>b.textContent==='发送给 Agent').click();await g.until(()=>g.calls.length===1);
      g.mount(spec,{session:'s2'});await g.sleep(100);const isolated=document.querySelector('[data-genui] input').value==='';
      g.mount(spec,{session:'s1'});await g.sleep(100);const persisted=document.querySelector('[data-genui] input').value==='落花流水';
      return {sorted,localOnly,preview,sent:g.calls.length,session:g.calls[0].session,value:g.calls[0].event.payload.fields.name,persisted,isolated};
    `)
    expect(result).toEqual({ sorted: true, localOnly: true, preview: true, sent: 1, session: 's1', value: '落花流水', persisted: true, isolated: true })
  }, 120000)
  test('Given 危险组件和未闭合围栏 When 渲染 Then 不执行且保留源代码', async () => {
    const result = await renderer.run<{ secret: boolean; unsafe: boolean; incomplete: boolean }>(`
      const g=window.genui;
      g.mount({items:[{type:'input',label:'API key',inputType:'password'}]});await g.until(()=>document.body.innerText.includes('不允许收集'));const secret=!document.querySelector('input');
      g.mount({items:[{type:'svg',code:'<svg onload="window.hacked=true"/>'}]});await g.until(()=>document.body.innerText.includes('SVG 含主动'));const unsafe=!window.hacked&&!document.querySelector('[data-genui]');
      g.mount({items:[{type:'text',content:'未闭合'}]},{closed:false});await g.until(()=>document.body.innerText.includes('未完整闭合'));return {secret,unsafe,incomplete:!document.querySelector('[data-genui]')};
    `)
    expect(result).toEqual({ secret: true, unsafe: true, incomplete: true })
  }, 120000)
  test('Given 网络被禁用 When 渲染 ECharts、Mermaid 和 3D Then 本地引擎加载且图表与流程图可绘制', async () => {
    const result = await renderer.run<{ chart: boolean; mermaid: boolean; three: boolean; localScripts: boolean; dark: boolean; light: boolean }>(`
      const g=window.genui;
      g.mount({items:[{type:'echart',preset:'bar',data:[{label:'A',value:12},{label:'B',value:8}]},{type:'mermaid',code:'graph TD\\nA[开始] --> B[完成]'},{type:'scene3d',meshes:[{shape:'box',color:'#6366f1'}]}]});
      await g.until(()=>document.querySelector('[data-genui-echart] canvas')&&document.querySelector('[data-genui-mermaid] svg')&&window.__GenuiAssets__?.three);
      const chart=!!document.querySelector('[data-genui-echart] canvas'),mermaid=!!document.querySelector('[data-genui-mermaid] svg'),three=!!window.__GenuiAssets__.three;
      const scripts=[...document.scripts].filter(script=>script.src.includes('genui-assets/'));
      const localScripts=scripts.length>=3&&scripts.every(script=>script.src.startsWith('file:'));
      const block=document.querySelector('[data-genui]');
      document.documentElement.classList.remove('dark');const lightColor=getComputedStyle(block).getPropertyValue('--dsw-alias-label-primary').trim();
      const light=lightColor!=='';document.documentElement.classList.add('dark');await g.sleep(60);
      const dark=lightColor!==getComputedStyle(block).getPropertyValue('--dsw-alias-label-primary').trim();
      return {chart,mermaid,three,localScripts,dark,light};
    `)
    expect(result).toEqual({chart:true,mermaid:true,three:true,localScripts:true,dark:true,light:true})
  }, 120000)

})
