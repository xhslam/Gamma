import { expect, test } from 'bun:test'
import { build } from 'esbuild'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'

/** 真实ElectronMain/完整preload/AgentView/默认utilityPi链路；仅模型的HTTP响应为本地合成数据。 */
test('Given 完整生产桥与隔离HOME When UI附加、轮询、发送和重载 Then 历史引用持久化且上下文不写入历史', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gamma-reference-real-bridge-'))
  const requests: string[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(await request.text())
    const frame = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'gpt-4o-mini', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(frame({ role: 'assistant', content: '本地桥接回答7391' }, null) + frame({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  let renderer: Awaited<ReturnType<typeof createElectronRendererHarness>> | undefined
  try {
    const home = join(directory, 'home')
    const project = join(directory, 'project')
    await Promise.all([mkdir(home), mkdir(project), symlink(resolve(import.meta.dir, '../../../../node_modules'), join(directory, 'node_modules'))])
    const external = ['electron', '@earendil-works/pi-coding-agent', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'sharp', 'node-pty']
    await Promise.all([
      build({ entryPoints: [resolve(import.meta.dir, '../../../test-utils/reference-bridge-main.fixture.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'services.cjs'), external }),
      build({ entryPoints: [resolve(import.meta.dir, '../../../utility/agent-runtime.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'agent-runtime.cjs'), external }),
      build({ entryPoints: [resolve(import.meta.dir, '../../../preload/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'preload.cjs'), external: ['electron'] }),
    ])
    renderer = await createElectronRendererHarness(`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {Provider,createStore} from 'jotai'; import {Toaster} from 'sonner';
      import {AgentView} from '@/components/agent/AgentView';
      import {useGlobalAgentListeners} from '@/hooks/useGlobalAgentListeners';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import * as atoms from '@/atoms/agent-atoms'; import {channelsAtom} from '@/atoms/channel-atoms';
      import '@/styles/globals.css';
      const api=window.electronAPI, store=createStore();
      window.bridgeReady=(async()=>{
        const sessions=await api.listAgentSessions(), workspaces=await api.listAgentWorkspaces();
        const target=sessions.find(s=>s.title==='桥接目标会话');
        store.set(atoms.agentSessionsAtom,sessions); store.set(atoms.agentWorkspacesAtom,workspaces);
        store.set(channelsAtom,await api.listChannels());
        store.set(atoms.currentAgentSessionIdAtom,target.id); store.set(atoms.currentAgentWorkspaceIdAtom,target.workspaceId);
        const Global=()=>{useGlobalAgentListeners();return null};
        createRoot(document.getElementById('root')).render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,
          React.createElement(React.Fragment,null,React.createElement(Global),React.createElement(AgentView,{sessionId:target.id,embedded:true}),React.createElement(Toaster)))));
        return target;
      })();
    `, {
      preloadSource: await readFile(join(directory, 'preload.cjs'), 'utf8'),
      mainProcessSetup: `const fixture=require(${JSON.stringify(join(directory, 'services.cjs'))});`,
      mainProcessReady: `await fixture.initialize(${JSON.stringify(`http://127.0.0.1:${server.port}/v1`)},${JSON.stringify(project)});`,
      mainWindowSetup: 'fixture.bindMainWindow(window);',
      environment: { HOME: home, GAMMA_DEV: '1', GAMMA_AGENT_RUNTIME: '', NO_PROXY: 'localhost,127.0.0.1' },
      timeoutMs: 60_000,
    })
    const result = await renderer.run<{ before: { isolated: boolean; attached: boolean; ready: boolean; history: boolean; rawPromptAbsent: boolean }; after: { historyCard: boolean; composerCleared: boolean } }>(`
      const target=await window.bridgeReady, api=window.electronAPI;
      const wait=async(fn)=>{const until=Date.now()+30000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw new Error('真实桥条件未满足: '+document.body.innerText.slice(-1000))};
      const isolated=typeof require==='undefined'&&typeof process==='undefined'&&!!api;
      await wait(()=>document.querySelector('.tiptap')?.editor);
      const button=document.querySelector('[aria-label="添加附件或引用对话"]');
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',ctrlKey:false}));
      await wait(()=>[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('引用对话')));
      [...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('引用对话')).click();
      await wait(()=>document.querySelector('[data-reference-project]'));
      document.querySelector('[data-reference-project]').click();
      await wait(()=>[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.includes('桥接源资料7391')));
      [...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.includes('桥接源资料7391')).click();
      await wait(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('确定引用 (1)')));
      [...document.querySelectorAll('button')].find(e=>e.textContent.includes('确定引用 (1)')).click();
      let polled;
      await wait(async()=>{polled=await api.getContextRefs({sessionId:target.id});return polled.refs.length===1&&polled.summaryStatuses[polled.refs[0].refId]==='ready'});
      const attached=document.body.innerText.includes('桥接源资料7391'), ready=polled.summaryStatuses[polled.refs[0].refId]==='ready';
      const editor=document.querySelector('.tiptap');editor.editor.commands.insertContent('依据引用回答合成暗号。');
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await wait(()=>document.body.innerText.includes('本地桥接回答7391'));
      let messages;
      await wait(async()=>{messages=await api.getAgentSessionSDKMessages(target.id);return messages.some(m=>m.contextRefs?.length===1)});
      const rawPromptAbsent=!JSON.stringify(messages).includes('<referenced_conversations>');
      await api.updateContextRefs({sessionId:target.id,refs:[]});
      return {isolated,attached,ready,history:messages.some(m=>m.contextRefs?.[0]?.titleAtAttach==='桥接源资料7391'),rawPromptAbsent};
    `, `
      await window.bridgeReady;
      const until=Date.now()+10000;
      while(Date.now()<until&&!document.body.innerText.includes('已引用 1 个对话作为背景'))await new Promise(r=>setTimeout(r,50));
      return {historyCard:document.body.innerText.includes('已引用 1 个对话作为背景'),composerCleared:!document.body.innerText.includes('引用对话 (1/5)')};
    `)
    expect(result).toEqual({ before: { isolated: true, attached: true, ready: true, history: true, rawPromptAbsent: true }, after: { historyCard: true, composerCleared: true } })
    expect(requests.some(body => body.includes('桥接青花瓷7391') && body.includes('<referenced_conversations>'))).toBe(true)
  } finally {
    await renderer?.dispose()
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 120_000)
