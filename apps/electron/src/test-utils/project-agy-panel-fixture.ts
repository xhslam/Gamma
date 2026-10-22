/** 穿过真实 LeftSidebar → RightSidePanel → SidePanel 的终端集成环境；不连接用户配置或模型。 */
export const projectAgyPanelFixture = String.raw`
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
import { RightSidePanel } from '@/components/app-shell/RightSidePanel'
import { TerminalLifecycleObserver } from '@/components/tabs/TerminalLifecycleObserver'
import {
  currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom, agentWorkspacesAtom, agentSessionsAtom,
  agentSessionPathMapAtom, agentSidePanelOpenAtomFamily, agentDiffPanelTabAtom,
  agentSessionComponentTabsAtomFamily, agentSidePanelSplitMapAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
import { projectAgyTerminalsAtom } from '@/atoms/project-agy-terminal-atoms'
import '@/styles/globals.css'

localStorage.clear()
document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0}#root{display:flex}html *,html *::before,html *::after{animation-duration:0s!important;transition:none!important}</style>')
const errors = []
window.addEventListener('error', event => errors.push(event.message))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const delay = (ms=15) => new Promise(resolve => setTimeout(resolve, ms))
const until = async predicate => {
  for (let attempt=0;attempt<200;attempt++) { if (predicate()) return; if(errors.length) throw new Error(errors.join('; ')); await delay() }
  const layout=[];for(let node=document.querySelector('.xterm');node && layout.length<12;node=node.parentElement)layout.push({class:node.className,rect:node.getBoundingClientRect().toJSON(),display:getComputedStyle(node).display,offsetParent:!!node.offsetParent})
  throw new Error('layout='+JSON.stringify(layout)+' 真实 AGY 工作区未达到预期：stage='+window.agyPanel?.stage+'; drag='+JSON.stringify(window.agyPanel?.dragDebug)+'; resizes='+JSON.stringify(window.agyPanel?.resizes)+'; '+document.body.innerText.slice(-900))
}
class ErrorBoundary extends React.Component {
  state={error:null}
  static getDerivedStateFromError(error){ return {error:String(error)} }
  componentDidCatch(error){ errors.push(String(error)) }
  render(){ return this.state.error ? React.createElement('div',{role:'alert'},this.state.error) : this.props.children }
}
const store=createStore()
const workspaces=[{id:'a',slug:'a',name:'项目A',projectRootPath:'C:/Project A',createdAt:1,updatedAt:1},{id:'b',slug:'b',name:'项目B',projectRootPath:'C:/Project B',createdAt:1,updatedAt:1}]
const sessions=[{id:'s-a',workspaceId:'a',title:'会话A',createdAt:1,updatedAt:1},{id:'s-b',workspaceId:'b',title:'会话B',createdAt:1,updatedAt:1}]
store.set(agentWorkspacesAtom,workspaces);store.set(agentSessionsAtom,sessions)
store.set(currentAgentSessionIdAtom,'s-a');store.set(currentAgentWorkspaceIdAtom,'a')
store.set(agentSessionPathMapAtom,new Map([['s-a','C:/session-a'],['s-b','C:/session-b']]))
store.set(tabsAtom,[{id:'s-a',sessionId:'s-a',title:'会话A',type:'agent'}]);store.set(activeTabIdAtom,'s-a')
store.set(agentSidePanelOpenAtomFamily('s-a'),true)
const opens=[],kills=[],writes=[],resizes=[],shellCreates=[]
const states=new Map(),byProject=new Map(),outputs=new Set(),exits=new Set(),closes=new Set()
let counter=0, exitBeforeOpenReturns=false
const subscribe = set => listener => {set.add(listener);return ()=>set.delete(listener)}
window.electronAPI={
  getUserProfile:async()=>({userName:'测试用户',avatar:'🌱'}),
  listActiveAgentSessions:async()=>sessions,countArchivedAgentSessions:async()=>0,listArchivedAgentSessions:async()=>[],
  getWorkspaceCapabilities:async()=>({mcpServers:[],skills:[]}),updateSettings:async()=>{},
  getWorkspaceDirectories:async()=>[],getWorkspaceAttachedFiles:async()=>[],
  getWorkspaceFilesPath:async slug=>workspaces.find(w=>w.slug===slug).projectRootPath,
  listDirectory:async()=>[],listAttachedDirectory:async()=>[],getAgentBrowserState:async()=>null,
  onAttachedDirectoryChanged:()=>()=>{},onWorkspaceFilesChanged:()=>()=>{},
  onAgentTerminalOpen:()=>()=>{},onAgentTerminalClose:subscribe(closes),
  onTerminalOutput:subscribe(outputs),onTerminalExit:subscribe(exits),
  openProjectAgyTerminal:async input=>{
    opens.push(input)
    const previous=byProject.get(input.workspaceId)
    if(previous && states.has(previous.terminalId))return {...previous,exitCode:states.get(previous.terminalId).exitCode}
    const state={workspaceId:input.workspaceId,ownerId:'project-agy:'+input.workspaceId,terminalId:'agy-'+(++counter),title:'AGY',profile:'default',pid:counter,cwd:workspaces.find(w=>w.id===input.workspaceId).projectRootPath}
    states.set(state.terminalId,{state,output:'AGY_READY\r\n> ',sequence:1});byProject.set(input.workspaceId,state);
    if(exitBeforeOpenReturns){states.get(state.terminalId).exitCode=9;exits.forEach(fn=>fn({terminalId:state.terminalId,exitCode:9}));exitBeforeOpenReturns=false}
    return state
  },
  createTerminal:async input=>{shellCreates.push(input);throw new Error('项目 AGY 不应创建普通 shell')},
  getTerminalSnapshot:async id=>{const snapshot=states.get(id);if(!snapshot)throw new Error('终端不存在');return snapshot},
  resizeTerminal:async input=>resizes.push(input),acknowledgeTerminalOutput:()=>{},
  writeTerminal:async input=>writes.push(input),
  killTerminal:async id=>{kills.push(id);states.delete(id);closes.forEach(fn=>fn({terminalId:id,sessionId:'project-agy:a'}))},
  getTerminalClipboardContent:async()=>({type:'empty'}),getPathForFile:()=>'',
}
const root=createRoot(document.getElementById('root'))
let setPanelWidth
function Shell(){
  const [width,setWidth]=React.useState(660);setPanelWidth=setWidth
  return React.createElement(React.Fragment,null,React.createElement(LeftSidebar,{width:220,noTransition:true}),React.createElement('div',{style:{height:'100%',width,display:'flex'}},React.createElement(RightSidePanel,{width})),React.createElement(TerminalLifecycleObserver))
}
root.render(React.createElement(Provider,{store},React.createElement(TooltipProvider,{delayDuration:0},React.createElement(ErrorBoundary,null,React.createElement(Shell)))))
window.agyPanel={
  until,delay,errors,store,opens,kills,writes,resizes,shellCreates,
  launched:()=>counter,
  exitEarly:()=>{exitBeforeOpenReturns=true},
  setPlatform:platform=>{Object.defineProperty(navigator,'platform',{value:platform,configurable:true});Object.defineProperty(navigator,'userAgentData',{value:undefined,configurable:true})},
  entry:id=>store.get(projectAgyTerminalsAtom).get(id),
  selected:()=>document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),
  sidebar:()=>document.querySelector('nav[aria-label="工作区"] button[aria-label="AGY"]'),
  tab:label=>[...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent.trim()===label),
  click:label=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label);if(!button)throw new Error('找不到按钮'+label);button.click()},
  selectProjectOnly:id=>store.set(currentAgentWorkspaceIdAtom,id),
  switchSession:id=>{store.set(currentAgentSessionIdAtom,id);store.set(agentSidePanelOpenAtomFamily(id),true);store.set(tabsAtom,[{id,sessionId:id,title:id,type:'agent'}]);store.set(activeTabIdAtom,id)},
  setSplit:()=>store.set(agentSidePanelSplitMapAtom,new Map([['s-a',{leftTab:'files',rightTab:'agy-terminal',focusedPane:'right',ratio:0.5}]])),
  collapseSplit:()=>store.set(agentSidePanelSplitMapAtom,new Map()),
  emitQuery:id=>{const snapshot=states.get(id);snapshot.sequence++;outputs.forEach(fn=>fn({terminalId:id,sequence:snapshot.sequence,data:'\x1b[6n'}))},
  closePanel:()=>store.set(agentSidePanelOpenAtomFamily(store.get(currentAgentSessionIdAtom)),false),
  openPanel:()=>store.set(agentSidePanelOpenAtomFamily(store.get(currentAgentSessionIdAtom)),true),
  size:width=>setPanelWidth(width),
  exit:id=>{const snapshot=states.get(id);snapshot.exitCode=0;exits.forEach(fn=>fn({terminalId:id,exitCode:0}))},
  boot:async()=>{await until(()=>document.querySelector('nav[aria-label="工作区"] button[aria-label="AGY"]'));document.querySelector('nav[aria-label="工作区"] button[aria-label="AGY"]').click();await until(()=>document.querySelector('[role="alertdialog"]'));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='接受风险并启动').click();await until(()=>!document.querySelector('[role="alertdialog"]')&&document.querySelector('.xterm-helper-textarea'));await delay()},
  dragToRight:async()=>{
    const tab=[...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent.trim()==='AGY');
    const content=document.querySelector('[data-testid="right-workspace-content"]') ?? document.querySelector('[role="tablist"]').closest('.titlebar-drag-region').lastElementChild;
    const r=tab.getBoundingClientRect(),cr=content.getBoundingClientRect(),id=31;
    window.agyPanel.dragDebug={r:r.toJSON(),cr:cr.toJSON(),before:store.get(agentDiffPanelTabAtom).get('s-a')};
    // Chromium synthetic pointer 没有原生 capture；只替换该 DOM API，仍走真实 tab 的拖拽监听。
    tab.setPointerCapture=()=>{};tab.releasePointerCapture=()=>{};
    tab.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:id,clientX:r.x+10,clientY:r.y+10}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:id,clientX:cr.right-35,clientY:cr.top+90}));
    await delay(40);
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:id,clientX:cr.right-35,clientY:cr.top+90}));
    await delay(40);
    window.agyPanel.dragDebug.after=store.get(agentDiffPanelTabAtom).get('s-a');
    window.agyPanel.dragDebug.split=store.get(agentSidePanelSplitMapAtom).get('s-a');
  },
}
`
