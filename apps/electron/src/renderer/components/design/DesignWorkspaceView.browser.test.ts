import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {Provider,createStore} from 'jotai';
    import {DesignWorkspaceView} from '@/components/design/DesignWorkspaceView';
    import {agentWorkspacesAtom,agentSessionsAtom,currentAgentWorkspaceIdAtom,currentAgentSessionIdAtom,currentSessionSidePanelOpenAtom,agentDiffPanelTabAtom,agentSessionDraftsAtom,agentSessionDraftHtmlAtom,agentSessionDraftSyncVersionsAtom,agentSessionPendingFilesAtom,agentPendingPromptAtom} from '@/atoms/agent-atoms';
    import {browserPanelOpenMapAtom,browserPanelMinimizedMapAtom,browserFocusRequestMapAtom} from '@/atoms/browser-atoms';
    import {activeViewAtom} from '@/atoms/active-view';import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root'));let store,installed=false,sqlite=true,fail=false,failOpen=false,deliveryOptions={};const calls=[];let artifacts=[];
    const until=async(predicate)=>{for(let i=0;i<180;i++){if(predicate())return;await new Promise(r=>setTimeout(r,15))}throw new Error('UI 超时:'+document.body.innerText)};
    const make=(id,kind='canvas',title='已有作品')=>({id,workspaceId:'a',sessionId:'session-a',title,kind,rootPath:'/project/designs/'+id,createdAt:1,updatedAt:2});
    window.electronAPI={
      getDesignBundleStatus:async()=>{if(fail)throw Error('读取状态失败');return {installed,revision:'fixed',nodeVersion:'22',supportsSqlite:sqlite}},
      installDesignBundle:async accepted=>{calls.push(['install',accepted]);installed=true;return window.electronAPI.getDesignBundleStatus()},
      listDesignArtifacts:async workspaceId=>{calls.push(['list',workspaceId]);return artifacts},
      createDesignArtifact:async input=>{calls.push(['create',input]);const artifact={...make('new',input.kind,input.title),sessionId:input.sessionId};artifacts=[artifact,...artifacts];return artifact},
      openDesignArtifact:async(workspaceId,id)=>{if(failOpen)throw Error('无法打开画板');calls.push(['open',workspaceId,id]);const artifact=artifacts.find(item=>item.id===id),session=store.get(agentSessionsAtom).find(item=>item.id===artifact.sessionId);return {artifact,url:'http://127.0.0.1:5555/design/'+id+'/',session,browser:{sessionId:session.id,activeTabId:'editor-'+id,tabs:[{tabId:'editor-'+id,url:'http://127.0.0.1:5555/design/'+id+'/'}]}}},
      exportDesignArtifact:async(workspace,id)=>{calls.push(['export',workspace,id]);await new Promise(r=>setTimeout(r,15));if(deliveryOptions.failExport)throw Error('保存失败');return deliveryOptions.cancelExport?{canceled:true}:{canceled:false,filePath:'/downloads/完整稿.zip'}},
      prepareDesignHandoff:async(workspace,id)=>{calls.push(['handoff',workspace,id]);await new Promise(r=>setTimeout(r,15));if(deliveryOptions.failHandoff)throw Error('设计稿尚未保存');return {artifactId:id,sessionId:'session-a',title:'完整稿',snapshotPath:'/session/design-handoffs/draft/root',archivePath:'/session/design-handoffs/draft/design.zip',archiveBytes:128,fileCount:4,prompt:'根据完整设计稿实施应用代码。读取 /session/design-handoffs/draft/root 中的全部页面与素材。'}},
      closeDesignArtifact:async id=>{calls.push(['close',id])},
      updateDesignTheme:async(id,theme)=>{calls.push(['theme',id,theme])},
      updateSettings:async()=>({}),createAgentSession:async(title,channel,workspaceId,modelId)=>{calls.push(['session',workspaceId]);return {id:'new-session',title:'新会话',workspaceId,channelId:channel,modelId,createdAt:1,updatedAt:1}},
    };
    const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);
    window.designTest={calls,until,button,make,
      async mount(options={}){root.render(null);await new Promise(r=>setTimeout(r,30));calls.length=0;installed=options.installed??true;sqlite=options.sqlite??true;fail=options.fail??false;failOpen=options.failOpen??false;deliveryOptions=options;artifacts=options.artifacts??[];store=createStore();
        store.set(agentWorkspacesAtom,['a','b'].map(id=>({id,name:'项目 '+id,slug:id,createdAt:1,updatedAt:1})));
        store.set(agentSessionsAtom,options.noSession?[]:[{id:'session-a',workspaceId:'a',title:'已有会话',channelId:'my-channel',modelId:'my-chat-model',createdAt:1,updatedAt:1}]);
        store.set(currentAgentWorkspaceIdAtom,options.selected??'a');store.set(currentAgentSessionIdAtom,options.noSession?null:'session-a');
        if(options.draft)store.set(agentSessionDraftsAtom,new Map([['session-a',options.draft]]));
        if(options.html)store.set(agentSessionDraftHtmlAtom,new Map([['session-a',options.html]]));
        if(options.attachment)store.set(agentSessionPendingFilesAtom,new Map([['session-a',[options.attachment]]]));
        store.set(currentSessionSidePanelOpenAtom,false);store.set(browserPanelMinimizedMapAtom,new Map([['session-a',true]]));
        root.render(React.createElement(Provider,{store},React.createElement(DesignWorkspaceView,{workspaceId:'a',sessionId:options.noSession?undefined:'session-a',embedded:options.embedded??false})));
        await until(()=>document.querySelector('[aria-label="design 作品库"]'));await until(()=>!document.body.innerText.includes('正在加载作品'));
      },
      fill(selector,value){const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))},
      async remount(){root.render(null);await new Promise(r=>setTimeout(r,30));root.render(React.createElement(Provider,{store},React.createElement(DesignWorkspaceView,{workspaceId:'a',sessionId:'session-a'})));await until(()=>document.querySelector('[aria-label="design 创作工作台"]'))},
      draft:()=>({text:store.get(agentSessionDraftsAtom).get('session-a'),html:store.get(agentSessionDraftHtmlAtom).get('session-a'),files:store.get(agentSessionPendingFilesAtom).get('session-a')??[],sync:store.get(agentSessionDraftSyncVersionsAtom).get('session-a'),pending:store.get(agentPendingPromptAtom)}),
      sessions:()=>store.get(agentSessionsAtom),
      addSession:session=>store.set(agentSessionsAtom,items=>[...items,session]),
      browser:()=>{const id=store.get(currentAgentSessionIdAtom);return {session:id,workspace:store.get(currentAgentWorkspaceIdAtom),open:store.get(browserPanelOpenMapAtom).get(id)===true,minimized:store.get(browserPanelMinimizedMapAtom).get(id)===true,panel:store.get(currentSessionSidePanelOpenAtom),tab:store.get(agentDiffPanelTabAtom).get(id),focus:store.get(browserFocusRequestMapAtom).get(id),view:store.get(activeViewAtom)}},
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
  test('When 在宽屏和窄屏查看六个入口 Then 始终两列三行且不横向溢出', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount();const root=document.getElementById('root');const layouts=[];
      for(const width of [1200,600,300]){
        root.style.width=width+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const first=[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('设计画布'));
        const grid=first.parentElement;const cards=[...grid.children].map(card=>card.getBoundingClientRect());
        layouts.push({count:cards.length,twoColumns:cards[0].top===cards[1].top&&cards[1].left>cards[0].left,threeRows:cards[2].top===cards[3].top&&cards[4].top===cards[5].top&&cards[2].top>cards[0].top&&cards[4].top>cards[2].top,fits:grid.scrollWidth<=grid.clientWidth+1});
      }
      root.style.width='';return layouts;
    `)
    expect(result).toEqual(Array.from({length:3},()=>({count:6,twoColumns:true,threeRows:true,fits:true})))
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
      await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      return {created:t.calls.find(call=>call[0]==='create')[1],agent:document.querySelector('[data-testid="design-agent"]').dataset.session,inlineEditors:document.querySelectorAll('[data-testid="design-editor"]').length,browser:t.browser(),model:t.sessions().find(item=>item.id==='session-a').modelId,newSession:t.calls.some(call=>call[0]==='session')};
    `)
    expect(result).toEqual({ created: { workspaceId: 'a', sessionId: 'session-a', title: '阅读应用', kind: 'canvas' }, agent: 'session-a', inlineEditors: 0, browser: {session:'session-a',workspace:'a',open:true,minimized:false,panel:true,tab:'browser:editor-new',focus:'editor-new',view:'conversations'}, model: 'my-chat-model', newSession: false })
  }, 30_000)
  test('When 创建白板 Then 复用 Gamma 聊天且不再挂载内联编辑器', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount();[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('白板')).click();
      await t.until(()=>document.querySelector('input[id^="design-name"]'));t.fill('input[id^="design-name"]','架构白板');await new Promise(r=>setTimeout(r,20));t.button('创建并打开').click();
      await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      return {created:t.calls.find(call=>call[0]==='create')[1],session:document.querySelector('[data-testid="design-agent"]').dataset.session,editor:!!document.querySelector('[data-testid="design-editor"]')};
    `)
    expect(result).toEqual({ created: { workspaceId: 'a', sessionId: 'session-a', title: '架构白板', kind: 'whiteboard' }, session: 'session-a', editor: false })
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
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[t.make('resume')]});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      const before=t.calls.filter(call=>call[0]==='open').length;await t.remount();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      return {before,after:t.calls.filter(call=>call[0]==='open').length,session:document.querySelector('[data-testid="design-agent"]').dataset.session,browser:t.browser(),inlineEditors:document.querySelectorAll('[data-testid="design-editor"]').length};
    `)
    expect(result).toEqual({before:1,after:2,session:'session-a',browser:{session:'session-a',workspace:'a',open:true,minimized:false,panel:true,tab:'browser:editor-resume',focus:'editor-resume',view:'conversations'},inlineEditors:0})
  }, 30_000)
  test('When 打开另一会话的作品 Then 对话和唯一侧边浏览器切到作品所属会话', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[{...t.make('other'),sessionId:'session-other'}]});
      t.addSession({id:'session-other',workspaceId:'a',title:'作品会话',channelId:'other-channel',modelId:'other-model',createdAt:1,updatedAt:1});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      return {agent:document.querySelector('[data-testid="design-agent"]').dataset.session,browser:t.browser(),inlineEditors:document.querySelectorAll('[data-testid="design-editor"]').length};
    `)
    expect(result).toEqual({agent:'session-other',browser:{session:'session-other',workspace:'a',open:true,minimized:false,panel:true,tab:'browser:editor-other',focus:'editor-other',view:'conversations'},inlineEditors:0})
  }, 30_000)
  test('When 从侧栏作品库打开 Then 转到 Design 主区并聚焦已有侧边浏览器，不挂载内联编辑器', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({embedded:true,artifacts:[t.make('embedded')]});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>t.browser().view==='design');
      return {browser:t.browser(),inlineEditors:document.querySelectorAll('[data-testid="design-editor"]').length};
    `)
    expect(result).toEqual({browser:{session:'session-a',workspace:'a',open:true,minimized:false,panel:true,tab:'browser:editor-embedded',focus:'editor-embedded',view:'design'},inlineEditors:0})
  }, 30_000)
  test('When 打开画板失败 Then 保留作品库并显示错误，不展开空浏览器', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({failOpen:true,artifacts:[t.make('failed')]});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[role="alert"]'));
      return {error:document.querySelector('[role="alert"]').textContent,library:!!document.querySelector('[aria-label="design 作品库"]'),open:t.browser().open,panel:t.browser().panel};
    `)
    expect(result).toEqual({error:'无法打开画板',library:true,open:false,panel:false})
  }, 30_000)
  test('When 窄屏打开工作台 Then 主区始终保留对话，不恢复独立编辑器或切换按钮', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[t.make('narrow')]});document.getElementById('root').style.width='300px';
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      const workbench=document.querySelector('[aria-label="design 创作工作台"]');
      return {agent:!!workbench.querySelector('[data-testid="design-agent"]'),editors:document.querySelectorAll('[data-testid="design-editor"]').length,switcher:!!t.button('编辑器'),fits:workbench.scrollWidth<=workbench.clientWidth+1};
    `)
    expect(result).toEqual({agent:true,editors:0,switcher:false,fits:true})
  }, 30_000)
  test('When 添加完整设计稿到对话 Then 保留已有富文本和附件，追加 ZIP 与实施草稿且不自动发送', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[t.make('handoff')],draft:'原来的需求',html:'<p><strong>原来的需求</strong></p>',attachment:{id:'old',filename:'before.txt',size:1,mediaType:'text/plain',sourcePath:'/before.txt'}});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      const button=document.querySelector('[aria-label="添加完整设计稿到对话"]');button.click();button.click();
      await t.until(()=>document.body.innerText.includes('确认后发送即可'));
      const draft=t.draft();return {calls:t.calls.filter(call=>call[0]==='handoff'),text:draft.text,keptHtml:draft.html.startsWith('<p><strong>原来的需求</strong></p>'),files:draft.files.map(({filename,sourcePath,mediaType})=>({filename,sourcePath,mediaType})),sync:draft.sync,pending:draft.pending,editors:document.querySelectorAll('[data-testid="design-editor"]').length};
    `)
    expect(result).toEqual({calls:[['handoff','a','handoff']],text:'原来的需求\n\n根据完整设计稿实施应用代码。读取 /session/design-handoffs/draft/root 中的全部页面与素材。',keptHtml:true,files:[{filename:'before.txt',sourcePath:'/before.txt',mediaType:'text/plain'},{filename:'完整稿.zip',sourcePath:'/session/design-handoffs/draft/design.zip',mediaType:'application/zip'}],sync:1,pending:null,editors:0})
  }, 30_000)
  test('When 只有富文本而没有纯文本草稿 Then 添加完整设计稿仍保留富文本内容', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[t.make('rich-only')],html:'<p><strong>保留格式内容</strong></p>'});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[aria-label="design 创作工作台"]'));
      document.querySelector('[aria-label="添加完整设计稿到对话"]').click();await t.until(()=>document.querySelector('[role="status"]')?.textContent.includes('确认后发送'));
      return {html:t.draft().html,text:t.draft().text,files:t.draft().files.length};
    `)
    expect(result).toMatchObject({ files: 1 })
    expect((result as { html: string }).html).toStartWith('<p><strong>保留格式内容</strong></p>')
    expect((result as { text: string }).text).toContain('根据完整设计稿实施应用代码')
  }, 30_000)
  test('When 下载完整设计稿 Then 显示实际保存路径；取消保存时不误报成功', async () => {
    const result = await renderer.run(`
      const t=window.designTest;const output=[];
      for(const cancelExport of [false,true]){
        await t.mount({artifacts:[t.make('download')],cancelExport});
        [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
        document.querySelector('[aria-label="下载完整设计稿"]').click();await t.until(()=>t.calls.some(call=>call[0]==='export'));await t.until(()=>!document.querySelector('[aria-label="下载完整设计稿"]').disabled);
        output.push({calls:t.calls.filter(call=>call[0]==='export'),saved:document.body.innerText.includes('已保存完整设计稿：/downloads/完整稿.zip'),files:t.draft().files.length});
      }return output;
    `)
    expect(result).toEqual([{calls:[['export','a','download']],saved:true,files:0},{calls:[['export','a','download']],saved:false,files:0}])
  }, 30_000)
  test('When 完整稿尚未保存或下载失败 Then 展示错误并保留用户草稿，不添加失效附件', async () => {
    const result = await renderer.run(`
      const t=window.designTest;await t.mount({artifacts:[t.make('failed-delivery')],draft:'不要覆盖',failHandoff:true,failExport:true});
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('已有作品')).click();await t.until(()=>document.querySelector('[data-testid="design-agent"]'));
      document.querySelector('[aria-label="添加完整设计稿到对话"]').click();await t.until(()=>document.querySelector('[role="alert"]'));const handoff=document.querySelector('[role="alert"]').textContent;
      document.querySelector('[aria-label="下载完整设计稿"]').click();await t.until(()=>document.querySelector('[role="alert"]')?.textContent==='保存失败');
      return {handoff,download:document.querySelector('[role="alert"]').textContent,text:t.draft().text,files:t.draft().files.length,pending:t.draft().pending};
    `)
    expect(result).toEqual({handoff:'设计稿尚未保存',download:'保存失败',text:'不要覆盖',files:0,pending:null})
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
