import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { createVisualRendererHarness, type VisualRendererHarness } from '../../../test-utils/visual-renderer'
import { join } from 'node:path'
import { composerRegressionFixture } from '../../../test-utils/composer-regression-fixture'

const fixture = composerRegressionFixture
  .replace("import '@/styles/globals.css'", `
    import { ConversationReferenceDialog } from '@/components/agent/ConversationReferenceDialog'
    import { agentSessionsAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
    import '@/styles/globals.css'
  `)
  .replace('searchWorkspaceFiles: async () => {', `
    getContextRefDetail: async () => ({detail:{exists:true,messageCount:2,estTokens:80,lastCompleteMessageId:'m-last',firstMessagePreview:'背景内容'}}),
    searchWorkspaceFiles: async () => {
  `)
  .replace('store.set(richTextRenderingEnabledAtom, true);', `
    store.set(richTextRenderingEnabledAtom, true);
    store.set(agentSessionsAtom,[{id:'source',workspaceId:'project',title:'背景对话',createdAt:1,updatedAt:2}]);
    store.set(agentWorkspacesAtom,[{id:'project',name:'项目',slug:'fixture'}]);
  `)
  .replace("const [value, change] = React.useState('');", `
    const [value, change] = React.useState('');
    const [refs,setRefs]=React.useState([]);
    window.confirmedRefs=refs;
  `)
  .replace('onBackspaceEmpty: options.onBackspaceEmpty', `
    onBackspaceEmpty: options.onBackspaceEmpty,
    renderConversationReference: onClose => React.createElement(ConversationReferenceDialog,{
      embedded:true,open:true,currentSessionId:'current',currentWorkspaceId:'project',initialRefs:refs,
      onOpenChange:open=>{if(!open)onClose()},onConfirm:async next=>setRefs(next)
    })
  `)

let renderer: ElectronRendererHarness
let visual: VisualRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(fixture)
  visual = await createVisualRendererHarness(fixture)
}, 60_000)
afterAll(async () => { await renderer?.dispose(); await visual?.dispose() })

describe('Given 文件与对话共用的真实编辑器引用框', () => {
  for (const dark of [false, true]) {
    test(`When ${dark ? '深色' : '浅色'}主题显示对话页签 Then 共用框的头尾均在视口内`, async () => {
      const directory = process.env.GAMMA_REFERENCE_SCREENSHOT_DIR
      expect(await visual.run<{single:boolean;tabs:number;inside:boolean;noDialog:boolean}>(`
        document.documentElement.classList.toggle('dark',${dark});
        document.getElementById('root').style.cssText='position:fixed;bottom:24px;left:24px;width:600px';
        const f=await window.composerRegression.mount();const {until,delay}=window.composerRegression;
        f.ref.current.openReferencePicker('conversations');await until(()=>document.querySelector('[data-reference-project]'));
        document.querySelector('[data-reference-project]').click();await delay(150);
        const shell=document.querySelector('[data-reference-picker]'),bounds=shell.getBoundingClientRect();
        return {single:document.querySelectorAll('[data-reference-picker]').length===1,tabs:shell.querySelectorAll('[role="tab"]').length,
          inside:bounds.top>=0&&bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight,noDialog:!document.querySelector('[role="dialog"]')};
      `,{screenshot:directory?join(directory,`unified-reference-${dark ? 'dark' : 'light'}.png`):undefined})).toEqual({single:true,tabs:2,inside:true,noDialog:true})
    }, 30_000)
  }
  test('When @打开后往返切换 Then 始终只有原来同一个框且保留对话选择', async () => {
    expect(await renderer.run<{ focusRetained: boolean; fileVisible: boolean; selected: number; single: boolean; noDialog: boolean; confirmed: boolean; clean: boolean }>(`
      const f=await window.composerRegression.mount();const {until,delay}=window.composerRegression;
      f.editor.commands.insertContent('@');await until(()=>document.querySelector('[data-reference-picker]'));
      const shell=document.querySelector('[data-reference-picker]');
      const tab=name=>[...shell.querySelectorAll('[role="tab"]')].find(e=>e.textContent===name);
      tab('引用对话').click();await until(()=>shell.querySelector('[data-reference-project]'));
      const search=shell.querySelector('[aria-label="搜索对话"]');search.focus();await delay(150);
      const focusRetained=document.querySelector('[data-reference-picker]')===shell;
      shell.querySelector('[data-reference-project]').click();await delay(30);
      shell.querySelector('[data-flat-index]').click();await delay(30);
      tab('文件').click();await delay(30);
      const fileVisible=shell.querySelector('[role="tabpanel"][aria-label="文件"]').getBoundingClientRect().height>0;
      tab('引用对话').click();await delay(30);
      const selected=shell.querySelectorAll('[data-flat-index][aria-selected="true"]').length;
      const single=document.querySelectorAll('[data-reference-picker]').length===1&&document.querySelector('[data-reference-picker]')===shell;
      const noDialog=document.querySelectorAll('[role="dialog"]').length===0;
      [...shell.querySelectorAll('button')].find(e=>e.textContent.includes('确定引用')).click();await delay(150);
      const confirmed=window.confirmedRefs.length===1;
      const clean=!f.ref.current.getMarkdown().includes('@')&&!document.querySelector('[data-reference-picker]');
      f.root.unmount();return {focusRetained,fileVisible,selected,single,noDialog,confirmed,clean};
    `)).toEqual({focusRetained:true,fileVisible:true,selected:1,single:true,noDialog:true,confirmed:true,clean:true})
  }, 30_000)

  test('When 工具栏直接打开对话页签再切换文件 Then 在同一框内选中文件', async () => {
    expect(await renderer.run<{ initial: boolean; file: boolean; closed: boolean }>(`
      const f=await window.composerRegression.mount();const {until,delay}=window.composerRegression;
      f.ref.current.openReferencePicker('conversations');
      await until(()=>document.querySelector('[aria-label="搜索对话"]'));
      const shell=document.querySelector('[data-reference-picker]');
      const initial=shell.querySelector('[role="tab"][aria-selected="true"]').textContent==='引用对话';
      [...shell.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='文件').click();await delay(30);
      await until(()=>shell.querySelector('[data-mention-item]'));
      shell.querySelector('[data-mention-item]').click();await delay(80);
      const markdown=f.ref.current.getMarkdown();const file=decodeURIComponent(markdown).includes('中文说明.md');
      const closed=!document.querySelector('[data-reference-picker]');
      f.root.unmount();return {initial,file,closed};
    `)).toEqual({initial:true,file:true,closed:true})
  }, 30_000)

  test('When 对话搜索框按Escape Then 关闭共用框且不发送消息', async () => {
    expect(await renderer.run<{ closed: boolean; notSent: boolean }>(`
      const f=await window.composerRegression.mount({empty:true});const {until,delay}=window.composerRegression;
      f.ref.current.openReferencePicker('conversations');await until(()=>document.querySelector('[aria-label="搜索对话"]'));
      const search=document.querySelector('[aria-label="搜索对话"]');search.focus();
      search.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await delay(150);
      const closed=!document.querySelector('[data-reference-picker]'),notSent=f.submissions.length===0;
      f.root.unmount();return {closed,notSent};
    `)).toEqual({closed:true,notSent:true})
  }, 30_000)
})
