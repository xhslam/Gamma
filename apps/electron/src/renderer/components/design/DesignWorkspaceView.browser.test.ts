import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {Provider,createStore} from 'jotai';
    import {DesignWorkspaceView} from '@/components/design/DesignWorkspaceView';
    import {agentWorkspacesAtom,agentSessionsAtom,currentAgentWorkspaceIdAtom,currentAgentSessionIdAtom} from '@/atoms/agent-atoms';
    import {activeViewAtom} from '@/atoms/active-view';import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root'));let store,installed=false,sqlite=true,fail=false;const calls=[];let artifacts=[];
    const until=async(predicate)=>{for(let i=0;i<180;i++){if(predicate())return;await new Promise(r=>setTimeout(r,15))}throw new Error('UI 超时:'+document.body.innerText)};
    const make=(id,kind='canvas',title='已有作品')=>({id,workspaceId:'a',sessionId:'session-a',title,kind,rootPath:'/project/designs/'+id,createdAt:1,updatedAt:2});
    window.electronAPI={
      getDesignBundleStatus:async()=>{if(fail)throw Error('读取状态失败');return {installed,revision:'fixed',nodeVersion:'22',supportsSqlite:sqlite}},
      installDesignBundle:async accepted=>{calls.push(['install',accepted]);installed=true;return window.electronAPI.getDesignBundleStatus()},
      listDesignArtifacts:async workspaceId=>{calls.push(['list',workspaceId]);return artifacts},
      createDesignArtifact:async input=>{calls.push(['create',input]);const artifact={...make('new',input.kind,input.title),sessionId:input.sessionId};artifacts=[artifact,...artifacts];return artifact},
      openDesignArtifact:async(workspaceId,id)=>{calls.push(['open',workspaceId,id]);const artifact=artifacts.find(item=>item.id===id),session=store.get(agentSessionsAtom).find(item=>item.id===artifact.sessionId);return {artifact,url:'http://127.0.0.1:5555/design/'+id+'/',session,browser:{sessionId:session.id,activeTabId:'editor-'+id,tabs:[{tabId:'editor-'+id,url:'http://127.0.0.1:5555/design/'+id+'/'}]}}},
      closeDesignArtifact:async id=>{calls.push(['close',id])},
      updateDesignTheme:async(id,theme)=>{calls.push(['theme',id,theme])},
      updateSettings:async()=>({}),createAgentSession:async(title,channel,workspaceId,modelId)=>{calls.push(['session',workspaceId]);return {id:'new-session',title:'新会话',workspaceId,channelId:channel,modelId,createdAt:1,updatedAt:1}},
    };
    const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);
    window.designTest={calls,until,button,make,
      async mount(options={}){root.render(null);await new Promise(r=>setTimeout(r,30));calls.length=0;installed=options.installed??true;sqlite=options.sqlite??true;fail=options.fail??false;artifacts=options.artifacts??[];store=createStore();
        store.set(agentWorkspacesAtom,['a','b'].map(id=>({id,name:'项目 '+id,slug:id,createdAt:1,updatedAt:1})));
        store.set(agentSessionsAtom,options.noSession?[]:[{id:'session-a',workspaceId:'a',title:'已有会话',channelId:'my-channel',modelId:'my-chat-model',createdAt:1,updatedAt:1}]);
        store.set(currentAgentWorkspaceIdAtom,options.selected??'a');store.set(currentAgentSessionIdAtom,options.noSession?null:'session-a');
        root.render(React.createElement(Provider,{store},React.createElement(DesignWorkspaceView,{workspaceId:'a',sessionId:options.noSession?undefined:'session-a'})));
        await until(()=>document.querySelector('[aria-label="design 作品库"]'));await until(()=>!document.body.innerText.includes('正在加载作品'));
      },
      fill(selector,value){const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))},
      async remount(){root.render(null);await new Promise(r=>setTimeout(r,30));root.render(React.createElement(Provider,{store},React.createElement(DesignWorkspaceView,{workspaceId:'a',sessionId:'session-a'})));await until(()=>document.querySelector('[aria-label="design 创作工作台"]'))},
      sessions:()=>store.get(agentSessionsAtom),
    };
  `, { moduleStubs: {
    'components/agent/AgentView.tsx': `import React from 'react';export function AgentView({sessionId,embedded}){return React.createElement('div',{'data-testid':'design-agent','data-session':sessionId,'data-embedded':String(embedded)},'复用 Gamma AgentView')}`,
    'components/browser/BrowserPanel.tsx': `import React from 'react';export function BrowserPanel({sessionId,tabId}){return React.createElement('div',{'data-testid':'design-editor','data-session':sessionId,'data-tab':tabId},'原版本地编辑器')}`,
  } })
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 完整 design 作品库和创作工作台', () => {
  test('When 首次打开 Then 六类内置编辑器直接可用，不显示下载、安装或 API Key 配置', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount();
      const types=['设计画布','白板','幻灯片','设计系统','数据看板','动画'];
      return {installed:t.calls.filter(call=>call[0]==='install'),noDownload:!document.body.innerText.includes('安装完整运行包'),noDialog:!document.querySelector('[role="alertdialog"]'),noKey:!document.querySelector('input[type="password"]'),ready:types.every(label=>[...document.querySelectorAll('button')].some(button=>button.textContent.startsWith(label)&&!button.disabled))};
    `)
    expect(result).toEqual({ installed: [], noDownload: true, noDialog: true, noKey: true, ready: true })
  }, 30_000)
  test('When 内置资源不完整 Then 显示资源错误且不提供运行时下载流程', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({installed:false});
      return {notice:document.body.innerText.includes('内置设计编辑器资源不完整'),download:!!t.button('安装完整运行包'),blocked:[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('设计画布')).disabled,installs:t.calls.filter(call=>call[0]==='install').length};
    `)
    expect(result).toEqual({notice:true,download:false,blocked:true,installs:0})
  }, 30_000)
  test('When 创建画布 Then 直接打开原版编辑器与既有聊天会话，不新建不同模型会话', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({selected:'b'});[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('设计画布')).click();
      await t.until(()=>document.querySelector('input[id^="design-name"]'));t.fill('input[id^="design-name"]','阅读应用');await new Promise(r=>setTimeout(r,20));t.button('创建并打开').click();
      await t.until(()=>document.querySelector('[data-testid="design-agent"]')&&document.querySelector('[data-testid="design-editor"]'));
      return {created:t.calls.find(call=>call[0]==='create')[1],agent:document.querySelector('[data-testid="design-agent"]').dataset.session,editor:document.querySelector('[data-testid="design-editor"]').dataset.session,model:t.sessions().find(item=>item.id==='session-a').modelId,newSession:t.calls.some(call=>call[0]==='session')};
    `)
    expect(result).toEqual({ created: { workspaceId: 'a', sessionId: 'session-a', title: '阅读应用', kind: 'canvas' }, agent: 'session-a', editor: 'session-a', model: 'my-chat-model', newSession: false })
  }, 30_000)
  test('When 创建白板 Then 传入白板作品类型并复用 Gamma 聊天和编辑器', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount();[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('白板')).click();
      await t.until(()=>document.querySelector('input[id^="design-name"]'));t.fill('input[id^="design-name"]','架构白板');await new Promise(r=>setTimeout(r,20));t.button('创建并打开').click();
      await t.until(()=>document.querySelector('[data-testid="design-agent"]')&&document.querySelector('[data-testid="design-editor"]'));
      return {created:t.calls.find(call=>call[0]==='create')[1],session:document.querySelector('[data-testid="design-agent"]').dataset.session,editor:!!document.querySelector('[data-testid="design-editor"]')};
    `)
    expect(result).toEqual({ created: { workspaceId: 'a', sessionId: 'session-a', title: '架构白板', kind: 'whiteboard' }, session: 'session-a', editor: true })
  }, 30_000)
  test('When 搜索并打开历史作品后返回 Then 恢复关联会话，停止该作品评论监听', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[t.make('first','slides','季度汇报'),t.make('second','canvas','阅读产品')]});
      t.fill('input[aria-label="搜索设计作品"]','季度');await t.until(()=>!document.body.innerText.includes('阅读产品'));
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('季度汇报')).click();await t.until(()=>document.querySelector('[aria-label="design 创作工作台"]'));
      document.querySelector('button[aria-label="返回设计作品库"]').click();await t.until(()=>document.querySelector('[aria-label="design 作品库"]'));
      return {opened:t.calls.find(call=>call[0]==='open'),closed:t.calls.some(call=>call[0]==='close'&&call[1]==='first')};
    `)
    expect(result).toEqual({ opened: ['open', 'a', 'first'], closed: true })
  }, 30_000)
  test('When 离开并重新进入已有工作台 Then 重新核验主进程上下文和编辑器而不是只用缓存', async () => {
    const result = await renderer.run<{ before: number; after: number; session: string }>(`
      const t=window.designTest;await t.mount({artifacts:[t.make('resume')]});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      const before=t.calls.filter(call=>call[0]==='open').length;await t.remount();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      return {before,after:t.calls.filter(call=>call[0]==='open').length,session:document.querySelector('[data-testid="design-agent"]').dataset.session};
    `)
    expect(result).toEqual({before:1,after:2,session:'session-a'})
  }, 30_000)
  test('When Node 缺少 SQLite Then 明确限制看板和动画，不影响画布和幻灯片', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({sqlite:false});const disabled=label=>[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith(label)).disabled;
      return {canvas:disabled('设计画布'),slides:disabled('幻灯片'),dashboard:disabled('数据看板'),motion:disabled('动画'),notice:document.body.innerText.includes('不支持 SQLite')};
    `)
    expect(result).toEqual({ canvas: false, slides: false, dashboard: true, motion: true, notice: true })
  }, 30_000)
  test('When Gamma 切换深色、特殊主题和强调色 Then 向已打开的原版编辑器实时同步实际令牌', async () => {
    const result = await renderer.run<{ light: string; dark: string; radius: number; changed: boolean }>(`
      const t=window.designTest;await t.mount({artifacts:[t.make('theme')]});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();
      const last=()=>t.calls.filter(call=>call[0]==='theme').at(-1)?.[2];
      await t.until(()=>last());const light=last().mode;
      document.documentElement.classList.add('dark','theme-terminal-dark');
      await t.until(()=>last()?.mode==='dark'&&last()?.radius===2);
      const themed=last();document.documentElement.style.setProperty('--primary','200 80% 50%');
      await t.until(()=>last()?.accent!==themed.accent);
      return {light,dark:themed.mode,radius:themed.radius,changed:last().accent!==themed.accent};
    `)
    expect(result).toEqual({light:'light',dark:'dark',radius:2,changed:true})
  }, 30_000)
  test('When 300px 窄屏浅深色使用 Then 作品库不横向溢出，失败时可读且不错误启用创建', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount();document.getElementById('root').style.width='300px';const fits=[];
      for(const dark of [false,true]){document.documentElement.classList.toggle('dark',dark);await new Promise(r=>setTimeout(r,30));const section=document.querySelector('[aria-label="design 作品库"]');fits.push(section.scrollWidth<=section.clientWidth+1)}
      await t.mount({fail:true});return {fits,error:document.querySelector('[role="alert"]').textContent,blocked:[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('设计画布')).disabled};
    `)
    expect(result).toEqual({ fits: [true, true], error: '读取状态失败', blocked: true })
  }, 30_000)
})
