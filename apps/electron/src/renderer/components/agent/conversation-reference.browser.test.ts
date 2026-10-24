import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../test-utils/visual-renderer'
import { join } from 'node:path'

let renderer: ElectronRendererHarness
let visual: VisualRendererHarness
const fixtureSource = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {Provider,createStore} from 'jotai'; import {TooltipProvider} from '@/components/ui/tooltip';
    import {FileMentionList} from '@/components/file-browser/FileMentionList';
    import {ConversationReferenceDialog} from '@/components/agent/ConversationReferenceDialog';
    import {AttachmentPreviewItem} from '@/components/session/AttachmentPreviewItem';
    import {messageAttachmentClassName} from '@/components/session/attachment-styles';
    import {ConversationReferenceChips} from '@/components/agent/ConversationReferenceChips';
    import {ReferencedConversationsMessageCard} from '@/components/agent/ReferencedConversationsMessageCard';
    import {agentSessionsAtom,agentWorkspacesAtom} from '@/atoms/agent-atoms'; import '@/styles/globals.css';
    const store=createStore(), now=1700000000000;
    const sessions=Array.from({length:36},(_,i)=>({id:'source-'+i,title:'测试会话-'+i,workspaceId:i<20?'project-a':'project-b',channelId:i===0?'channel-source-legacy':'channel-target-active',createdAt:now,updatedAt:now+i}));
    store.set(agentSessionsAtom,sessions);
    store.set(agentWorkspacesAtom,[{id:'project-a',name:'当前测试项目',slug:'a'},{id:'project-b',name:'跨项目测试',slug:'b'}]);
    window.requests=[]; window.summaryState='running';
    window.electronAPI={
      getContextRefs:async ()=>({refs:[],summaryStatuses:{r1:window.summaryState,r_cross:window.summaryState}}),
      getContextRefDetail:async ({sourceSessionId})=>{
        await new Promise(r=>setTimeout(r,15)); window.requests.push(sourceSessionId);
        return {detail:{sourceConversationId:sourceSessionId,sourceProjectId:'project-a',title:sourceSessionId,lastCompleteMessageId:'m1',messageCount:42,estTokens:1234,firstMessagePreview:'预览-'+sourceSessionId,updatedAt:now,exists:true}};
      },
    };
    window.wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.rename=()=>store.set(agentSessionsAtom,sessions.map(s=>s.id==='source-0'?{...s,title:'已改名的源会话'}:s));
    window.deleteSource=()=>store.set(agentSessionsAtom,sessions.filter(s=>s.id!=='source-0'));
    function Fixture(){const [open,setOpen]=React.useState(true),[refs,setRefs]=React.useState([]);
      const [currentChannelId,setCurrentChannelId]=React.useState('channel-target-active');
      const anchorRef=React.useRef(null);
      window.fixture={setOpen,setRefs,setCurrentChannelId};
      const onBackspaceEmpty=()=>{
        if(refs.length>0){setRefs(prev=>prev.slice(0,-1));return true;}
        return false;
      };
      return React.createElement(React.Fragment,null,
        React.createElement('div',{id:'test-file-menu',style:{position:'absolute',left:24,top:24,width:'min(400px, calc(100vw - 48px))'}},React.createElement(FileMentionList,{sessionEntries:[],workspaceEntries:[{name:'project-notes.md',path:'project-notes.md',type:'file',source:'workspace'}],onSelect:()=>{},conversationContent:React.createElement('div',{'data-test-conversation-content':true},'同框对话内容')})),
        React.createElement('output',{id:'confirmed'},JSON.stringify(refs)),
        React.createElement('div',{id:'test-attachments',style:{display:'flex',gap:8,flexWrap:'wrap'}},
          React.createElement(AttachmentPreviewItem,{filename:'notes.md',mediaType:'text/plain',onRemove:()=>{}}),
          React.createElement(ConversationReferenceChips,{embedded:true,sessionId:'current',currentChannelId,refs,onRemoveRef:id=>setRefs(r=>r.filter(x=>x.refId!==id)),onToggleMode:id=>setRefs(r=>r.map(x=>x.refId===id?{...x,mode:x.mode==='live'?'snapshot':'live'}:x))})),
        React.createElement('button',{id:'test-message-file',className:messageAttachmentClassName},'notes.md'),
        React.createElement('div',{ref:anchorRef,style:{position:'fixed',bottom:48,left:24}}),
        React.createElement(ReferencedConversationsMessageCard,{refs}),
        React.createElement('input',{
          id:'test-composer',
          onKeyDown:(e)=>{
            if(e.key==='Backspace'&&!e.currentTarget.value){onBackspaceEmpty();}
          }
        }),
        React.createElement(ConversationReferenceDialog,{anchorRef,open,onOpenChange:setOpen,currentSessionId:'current',currentWorkspaceId:'project-a',initialRefs:refs,onConfirm:async next=>{if(window.confirmError)throw new Error('合成保存失败');setRefs(next)}}));}
    createRoot(document.getElementById('root')).render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(Fixture))));
  `
beforeAll(async () => {
  renderer = await createElectronRendererHarness(fixtureSource)
  visual = await createVisualRendererHarness(fixtureSource)
}, 60_000)
afterAll(async () => { await renderer?.dispose(); await visual?.dispose() })

describe('Given 隔离数据与真实 Chromium 引用组件', () => {
  test('When 已选对话与文件同排 Then 共享附件样式且消息直接展示不再折叠', async () => {
    const result = await visual.run(`
      window.fixture.setOpen(false);
      window.fixture.setRefs([{refId:'r1',sourceConversationId:'source-1',sourceProjectId:'project-a',titleAtAttach:'背景资料',mode:'snapshot'}]);
      await window.wait(250);
      const file=document.querySelector('#test-attachments > div');
      const conversation=document.querySelector('[data-conversation-attachments] > div');
      const fileStyle=getComputedStyle(file),refStyle=getComputedStyle(conversation);
      const historical=document.querySelector('[aria-label="引用对话附件"] button');
      const mode=document.querySelector('[aria-label^="切换引用模式"]');mode.click();await window.wait(40);
      return {sameRow:file.getBoundingClientRect().top===conversation.getBoundingClientRect().top,
        sameBackground:fileStyle.backgroundColor===refStyle.backgroundColor,
        sameRadius:fileStyle.borderRadius===refStyle.borderRadius,
        samePadding:fileStyle.paddingTop===refStyle.paddingTop,
        direct:historical.textContent.includes('背景资料')&&!historical.hasAttribute('aria-expanded'),
        sameMessageStyle:historical.className===document.querySelector('#test-message-file').className,
        toggled:document.querySelector('[aria-label^="切换引用模式"]').textContent==='实时'};
    `);
    expect(result).toEqual({sameRow:true,sameBackground:true,sameRadius:true,samePadding:true,direct:true,sameMessageStyle:true,toggled:true});
  }, 30_000)
  test('When 打开引用选择器 Then 弹层锚定输入区域且没有模态遮罩', async () => {
    const result = await visual.run(`
      await window.wait(250);
      const panel=document.querySelector('[role="dialog"]'),bounds=panel.getBoundingClientRect();
      return {compact:bounds.width===400&&bounds.height<=360,anchored:Math.abs(bounds.bottom-(innerHeight-56))<2,
        modal:panel.getAttribute('aria-modal')==='true',search:document.activeElement.getAttribute('aria-label')==='搜索对话'};
    `);
    expect(result).toEqual({compact:true,anchored:true,modal:false,search:true});
  }, 30_000)
  test('When 未确认即关闭 Then 不保存草稿选择；保存失败后可重试', async () => {
    const result = await renderer.run(`
      await window.wait(300);
      document.querySelector('[data-reference-project="project-a"]').click();await window.wait(40);
      document.querySelector('[data-flat-index]').click();await window.wait(40);
      document.querySelector('[aria-label="关闭"]').click();await window.wait(80);
      const cancelled=document.querySelector('#confirmed').textContent==='[]';
      window.fixture.setOpen(true);await window.wait(80);
      document.querySelector('[data-reference-project="project-a"]').click();await window.wait(40);
      const reset=document.querySelectorAll('[data-flat-index][aria-selected="true"]').length===0;
      document.querySelector('[data-flat-index]').click();await window.wait(40);
      window.confirmError=true;
      const confirm=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('确定引用'));
      confirm().click();await window.wait(80);
      const retryable=Boolean(document.querySelector('[role="dialog"]'))&&!confirm().disabled&&document.querySelectorAll('[data-flat-index][aria-selected="true"]').length===1;
      window.confirmError=false;confirm().click();await window.wait(80);
      return {cancelled,reset,retryable,saved:JSON.parse(document.querySelector('#confirmed').textContent).length===1};
    `);
    expect(result).toEqual({cancelled:true,reset:true,retryable:true,saved:true});
  }, 20_000)
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
  test('When 默认收起项目再展开选择并收起 Then 隐藏项不可选且选择保留', async () => {
    const result = await renderer.run(`
      window.fixture.setRefs([]);window.fixture.setOpen(true);await window.wait(500);
      const input=document.querySelector('[role="dialog"] input');input.focus();
      const initial=document.querySelectorAll('[data-flat-index]').length;
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await window.wait(30);
      const hiddenSelected=document.querySelectorAll('[role="dialog"] [aria-selected="true"]').length;
      const group=document.querySelector('[data-reference-project="project-a"]');
      group.click();await window.wait(50);
      const expanded=document.querySelectorAll('[data-flat-index]').length;
      document.querySelector('[data-flat-index]').click();await window.wait(50);
      group.click();await window.wait(50);
      const collapsed=document.querySelectorAll('[data-flat-index]').length;
      group.click();await window.wait(50);
      return {initial,hiddenSelected,expanded,collapsed,retained:document.querySelectorAll('[data-flat-index][aria-selected="true"]').length};
    `)
    expect(result).toEqual({initial:0,hiddenSelected:0,expanded:20,collapsed:0,retained:1})
  }, 20_000)
  test('When 搜索跨项目并清空 Then 匹配自动展开且恢复原折叠状态', async () => {
    const result = await renderer.run(`
      await window.wait(500);document.querySelector('[data-reference-project="project-a"]').click();await window.wait(50);
      const input=document.querySelector('[role="dialog"] input');
      const fill=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      fill('测试会话-35');await window.wait(80);
      const matched=document.querySelectorAll('[data-flat-index]').length;
      fill('');await window.wait(80);
      return {matched,restored:document.querySelector('[data-reference-project="project-a"]').getAttribute('aria-expanded'),other:document.querySelector('[data-reference-project="project-b"]').getAttribute('aria-expanded')};
    `)
    expect(result).toEqual({matched:1,restored:'true',other:'false'})
  }, 20_000)
  test('When 异步加载超过30条并展开后Enter Then 详情不遗漏且可见首项可选', async () => {
    const result = await renderer.run(`
      await window.wait(500); document.querySelector('[data-reference-project="project-a"]').click();await window.wait(50);
      const input=document.querySelector('[role="dialog"] input'); input.focus();
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
  test('When 键盘展开项目并选择六项再切换模式 Then 只保存五项且模式不误触取消选择', async () => {
    const result = await renderer.run(`
      await window.wait(500);
      const input=document.querySelector('[aria-label="搜索对话"]');input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await window.wait(40);
      const group=document.activeElement;
      group.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await window.wait(40);
      group.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await window.wait(40);
      const rowFocused=document.activeElement.hasAttribute('data-flat-index');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await window.wait(40);
      for(const row of [...document.querySelectorAll('[data-flat-index]')].slice(1,6)){row.click();await window.wait(30);}
      const count=document.querySelectorAll('[data-flat-index][aria-selected="true"]').length;
      document.querySelector('[aria-label^="切换引用模式"]').click();await window.wait(40);
      const live=[...document.querySelectorAll('[aria-label^="切换引用模式"]')].filter(button=>button.textContent==='实时').length;
      [...document.querySelectorAll('button')].find(button=>button.textContent.includes('确定引用')).click();await window.wait(80);
      const refs=JSON.parse(document.querySelector('#confirmed').textContent);
      return {rowFocused,count,live,saved:refs.length,frozen:refs.every(ref=>ref.snapshotUpToMessageId==='m1'),unique:new Set(refs.map(ref=>ref.sourceConversationId)).size};
    `)
    expect(result).toEqual({rowFocused:true,count:5,live:1,saved:5,frozen:true,unique:5})
  }, 20_000)
  test('When 点击或聚焦文件菜单引用入口后激活 Then 在原框内切换且鼠标按下保留选区', async () => {
    const result = await renderer.run(`
      window.fixture.setOpen(false);await window.wait(100);
      const button=[...document.querySelectorAll('#test-file-menu button')].find(button=>button.textContent==='引用对话');
      const event=new MouseEvent('mousedown',{bubbles:true,cancelable:true});button.dispatchEvent(event);button.click();button.focus();button.click();await window.wait(50);
      return {selected:button.getAttribute('aria-selected')==='true',sameFrame:Boolean(document.querySelector('#test-file-menu [data-test-conversation-content]')),focus:document.activeElement===button,preserved:event.defaultPrevented,blue:button.className.includes('sky-')};
    `)
    expect(result).toEqual({selected:true,sameFrame:true,focus:true,preserved:true,blue:false})
  }, 20_000)
  for (const variant of [{name:'collapsed',dark:false,zoom:1},{name:'light',dark:false,zoom:1},{name:'dark',dark:true,zoom:1},{name:'narrow',dark:false,zoom:1.3}]) {
    test(`When ${variant.name} 真实视口显示引用 Then 列表独立滚动且固定头尾和关闭计数不重叠`, async () => {
      const screenshotDirectory = process.env.GAMMA_REFERENCE_SCREENSHOT_DIR
      const result = await visual.run<{inside:boolean;footer:boolean;scrolls:boolean;separate:boolean;overflow:boolean}>(`
        document.documentElement.classList.toggle('dark',${variant.dark});
        await window.wait(500);
        if (${variant.name !== 'collapsed'}) {
          document.querySelector('[data-reference-project="project-a"]').click();await window.wait(100);
          document.querySelector('[data-flat-index]').click();await window.wait(250);
        }
        const dialog=document.querySelector('[role="dialog"]'),bounds=dialog.getBoundingClientRect();
        const close=dialog.querySelector('[aria-label="关闭"]');
        const closeBounds=close.getBoundingClientRect(), count=dialog.querySelector('[data-reference-count]').getBoundingClientRect();
        const list=dialog.querySelector('[data-reference-list]');
        const confirm=[...dialog.querySelectorAll('button')].find(button=>button.textContent.includes('确定引用')).getBoundingClientRect();
        return {inside:bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1,footer:confirm.top>=bounds.top&&confirm.bottom<=bounds.bottom&&count.top>=bounds.top&&count.bottom<=bounds.bottom,scrolls:list.scrollHeight>list.clientHeight,separate:closeBounds.bottom<=count.top||count.right<=closeBounds.left,overflow:document.documentElement.scrollWidth>innerWidth};
      `,{zoom:variant.zoom,screenshot:screenshotDirectory?join(screenshotDirectory,`reference-ui-${variant.name}.png`):undefined})
      expect(result).toEqual({inside:true,footer:true,scrolls:variant.name !== 'collapsed',separate:true,overflow:false})
    }, 30_000)
  }
  test('When 文件引用菜单独立展示 Then 新入口与文件标识具有相同高度和图标尺寸', async () => {
    const directory = process.env.GAMMA_REFERENCE_SCREENSHOT_DIR
    const result = await visual.run(`
      window.fixture.setOpen(false);await window.wait(200);
      const header=document.querySelector('#test-file-menu > div > div');
      const [file,button]=header.querySelectorAll('[role="tab"]');
      return {height:file.getBoundingClientRect().height===button.getBoundingClientRect().height,icon:file.querySelector('svg').getBoundingClientRect().width===button.querySelector('svg').getBoundingClientRect().width};
    `,{screenshot:directory?join(directory,'reference-ui-menu.png'):undefined})
    expect(result).toEqual({height:true,icon:true})
  }, 30_000)
  test('When 源改名再删除 Then chip更新、历史标题固定且已删来源不可跳转', async () => {
    const result = await renderer.run(`
      await window.wait(100);window.fixture.setOpen(false);window.fixture.setRefs([{refId:'r1',sourceConversationId:'source-0',sourceProjectId:'project-a',titleAtAttach:'附加时原标题',mode:'snapshot',estTokens:1234}]);await window.wait(80);
      window.rename();await window.wait(80);const renamed=document.body.textContent.includes('已改名的源会话');
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('已引用 1 个对话'))?.click();await window.wait(50);const historical=document.querySelector('[aria-label="引用对话附件"]')?.textContent.includes('附加时原标题');
      window.deleteSource();await window.wait(80);const deleted=document.body.textContent.includes('源对话已删除');const disabled=[...document.querySelectorAll('button')].some(b=>b.disabled&&b.textContent.includes('附加时原标题'));
      document.querySelector('[aria-label^="移除引用"]')?.click();await window.wait(50);
      return {renamed,historical,deleted,disabled,removed:document.querySelector('#confirmed').textContent==='[]'};
    `)
    expect(result).toEqual({ renamed: true, historical: true, deleted: true, disabled: true, removed: true })
  }, 20_000)
  test('When 输入框为空按 Backspace Then 删除末尾 chip；输入框有内容时不触发', async () => {
    const result = await renderer.run(`
      window.fixture.setOpen(false);
      window.fixture.setRefs([
        { refId: 'ref_a', sourceConversationId: 'source-1', sourceProjectId: 'project-a', titleAtAttach: 'A', mode: 'snapshot' },
        { refId: 'ref_b', sourceConversationId: 'source-2', sourceProjectId: 'project-a', titleAtAttach: 'B', mode: 'snapshot' }
      ]);
      await window.wait(50);
      const input = document.querySelector('#test-composer');
      input.focus();

      // 输入框有文本时按 Backspace
      input.value = '@file';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await window.wait(50);
      const afterNonEmptyCount = JSON.parse(document.querySelector('#confirmed').textContent).length;

      // 清空输入框后按 Backspace
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await window.wait(50);
      const afterEmptyCount = JSON.parse(document.querySelector('#confirmed').textContent).length;

      // 再次按 Backspace，应删除最后一个 chip
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await window.wait(50);
      const finalCount = JSON.parse(document.querySelector('#confirmed').textContent).length;

      return { afterNonEmptyCount, afterEmptyCount, finalCount };
    `)
    expect(result).toEqual({ afterNonEmptyCount: 2, afterEmptyCount: 1, finalCount: 0 })
  }, 20_000)
  test('When 来源渠道与当前渠道不同 Then chip与列表提示“内容将发送给当前渠道的模型”且轮询不重复', async () => {
    const result = await renderer.run(`
      window.fixture.setOpen(false);
      // source-0 属于 channel-source-legacy，当前渠道为 channel-target-active
      window.fixture.setRefs([
        { refId: 'r_cross', sourceConversationId: 'source-0', sourceProjectId: 'project-a', titleAtAttach: '跨渠道测试', mode: 'snapshot' }
      ]);
      await window.wait(80);
      const hasIndicator = Boolean(document.querySelector('[data-testid="cross-channel-indicator"]'));
      const noticeText = document.querySelector('[data-testid="cross-channel-notice"]')?.textContent;

      // 等待多次 2s 轮询，验证提示稳定且不会重复出现多个 banner
      await window.wait(2200);
      const noticeCountAfterPoll = document.querySelectorAll('[data-testid="cross-channel-notice"]').length;

      // 切换当前渠道为与源渠道一致
      window.fixture.setCurrentChannelId('channel-source-legacy');
      await window.wait(80);
      const indicatorAfterSameChannel = Boolean(document.querySelector('[data-testid="cross-channel-indicator"]'));
      const noticeAfterSameChannel = Boolean(document.querySelector('[data-testid="cross-channel-notice"]'));

      // 恢复当前渠道
      window.fixture.setCurrentChannelId('channel-target-active');
      await window.wait(80);

      return {
        hasIndicator,
        noticeText,
        noticeCountAfterPoll,
        indicatorAfterSameChannel,
        noticeAfterSameChannel,
      };
    `)
    expect(result).toEqual({
      hasIndicator: true,
      noticeText: '内容将发送给当前渠道的模型',
      noticeCountAfterPoll: 1,
      indicatorAfterSameChannel: false,
      noticeAfterSameChannel: false,
    })
  }, 20_000)
})
