import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai'; import {TooltipProvider} from '@/components/ui/tooltip';
    import {ConversationReferenceDialog} from '@/components/agent/ConversationReferenceDialog';
    import {ConversationReferenceChips} from '@/components/agent/ConversationReferenceChips';
    import {ReferencedConversationsMessageCard} from '@/components/agent/ReferencedConversationsMessageCard';
    import {agentSessionsAtom,agentWorkspacesAtom} from '@/atoms/agent-atoms'; import '@/styles/globals.css';
    const store=createStore(), now=1700000000000;
    const sessions=Array.from({length:36},(_,i)=>({id:'source-'+i,title:'测试会话-'+i,workspaceId:i<20?'project-a':'project-b',createdAt:now,updatedAt:now+i}));
    store.set(agentSessionsAtom,sessions);
    store.set(agentWorkspacesAtom,[{id:'project-a',name:'当前测试项目',slug:'a'},{id:'project-b',name:'跨项目测试',slug:'b'}]);
    window.requests=[]; window.summaryState='running';
    window.electronAPI={getContextRefs:async ()=>({refs:[],summaryStatuses:{r1:window.summaryState}}),getContextRefDetail:async ({sourceSessionId})=>{
      await new Promise(r=>setTimeout(r,15)); window.requests.push(sourceSessionId);
      return {detail:{sourceConversationId:sourceSessionId,sourceProjectId:'project-a',title:sourceSessionId,lastCompleteMessageId:'m1',messageCount:42,estTokens:1234,firstMessagePreview:'预览-'+sourceSessionId,updatedAt:now,exists:true}};
    }};
    window.wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.rename=()=>store.set(agentSessionsAtom,sessions.map(s=>s.id==='source-0'?{...s,title:'已改名的源会话'}:s));
    window.deleteSource=()=>store.set(agentSessionsAtom,sessions.filter(s=>s.id!=='source-0'));
    function Fixture(){const [open,setOpen]=React.useState(true),[refs,setRefs]=React.useState([]);
      window.fixture={setOpen,setRefs};
      return React.createElement(React.Fragment,null,
        React.createElement('output',{id:'confirmed'},JSON.stringify(refs)),
        React.createElement(ConversationReferenceChips,{sessionId:'current',refs,onRemoveRef:id=>setRefs(r=>r.filter(x=>x.refId!==id)),onToggleMode:()=>{}}),
        React.createElement(ReferencedConversationsMessageCard,{refs}),
        React.createElement(ConversationReferenceDialog,{open,onOpenChange:setOpen,currentSessionId:'current',currentWorkspaceId:'project-a',initialRefs:refs,onConfirm:async next=>setRefs(next)}));}
    createRoot(document.getElementById('root')).render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(Fixture))));
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 隔离数据与真实 Chromium 引用组件', () => {
  test('When后台摘要状态改变 Then chip依次显示摘要中、已就绪与失败回退', async () => {
    const result = await renderer.run(`
      await window.wait(100);window.fixture.setOpen(false);window.fixture.setRefs([{refId:'r1',sourceConversationId:'source-0',sourceProjectId:'project-a',titleAtAttach:'fixture',mode:'snapshot'}]);await window.wait(100);
      const running=document.querySelector('[role="status"]')?.textContent;
      window.summaryState='ready';await window.wait(2200);const ready=document.querySelector('[role="status"]')?.textContent;
      window.summaryState='fallback';await window.wait(2200);const fallback=document.querySelector('[role="status"]')?.textContent;
      return {running,ready,fallback};
    `)
    expect(result).toEqual({running:'摘要中',ready:'已就绪',fallback:'失败回退'})
  }, 20_000)
  test('When 异步加载超过30条并首次Enter Then 详情不遗漏且首项可选', async () => {
    const result = await renderer.run(`
      await window.wait(500); const input=document.querySelector('[role="dialog"] input'); input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await window.wait(50);
      return {requested:window.requests.length,last:window.requests.includes('source-35'),selected:document.querySelectorAll('[data-flat-index][aria-selected="true"]').length};
    `)
    expect(result).toEqual({ requested: 36, last: true, selected: 1 })
  }, 20_000)
  test('When 选择项目后搜索 Then 仅显示所属项目结果', async () => {
    const result = await renderer.run(`
      await window.wait(500);const select=document.querySelector('[aria-label="筛选项目"]');select.value='project-b';select.dispatchEvent(new Event('change',{bubbles:true}));await window.wait(50);
      const projectCount=document.querySelectorAll('[data-flat-index]').length;
      const input=document.querySelector('[role="dialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'测试会话-35');input.dispatchEvent(new Event('input',{bubbles:true}));await window.wait(80);
      return {projectCount,searchCount:document.querySelectorAll('[data-flat-index]').length,text:document.querySelector('[data-flat-index]')?.textContent?.includes('source-35')};
    `)
    expect(result).toEqual({ projectCount: 16, searchCount: 1, text: true })
  }, 20_000)
  test('When 源改名再删除 Then chip更新、历史标题固定且已删来源不可跳转', async () => {
    const result = await renderer.run(`
      await window.wait(100);window.fixture.setOpen(false);window.fixture.setRefs([{refId:'r1',sourceConversationId:'source-0',sourceProjectId:'project-a',titleAtAttach:'附加时原标题',mode:'snapshot',estTokens:1234}]);await window.wait(80);
      window.rename();await window.wait(80);const renamed=document.body.textContent.includes('已改名的源会话');
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('已引用 1 个对话'))?.click();await window.wait(50);const historical=document.body.textContent.includes('附加时原标题');
      window.deleteSource();await window.wait(80);const deleted=document.body.textContent.includes('源对话已删除');const disabled=[...document.querySelectorAll('button')].some(b=>b.disabled&&b.textContent.includes('附加时原标题'));
      document.querySelector('[aria-label^="移除引用"]')?.click();await window.wait(50);
      return {renamed,historical,deleted,disabled,removed:document.querySelector('#confirmed').textContent==='[]'};
    `)
    expect(result).toEqual({ renamed: true, historical: true, deleted: true, disabled: true, removed: true })
  }, 20_000)
})
