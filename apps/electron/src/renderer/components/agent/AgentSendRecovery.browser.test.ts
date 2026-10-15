import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { Toaster } from 'sonner'
    import { AgentView } from '@/components/agent/AgentView'
    import { TooltipProvider } from '@/components/ui/tooltip'
    import { channelsAtom } from '@/atoms/channel-atoms'
    import { richTextRenderingEnabledAtom } from '@/atoms/ui-preferences'
    import * as atoms from '@/atoms/agent-atoms'
    import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
    import '@/styles/globals.css'
    const delay = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
    const errors = [];
    window.addEventListener('error', event => errors.push(event.error?.stack || event.message));
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    const until = async predicate => {
      for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
      throw new Error('发送回归未达到预期：' + document.body.innerText.slice(-1000) + errors.join(';'));
    };
    window.sendRecovery = {
      delay, until,
      async mount(options = {}) {
        const store = createStore(), root = createRoot(document.getElementById('root'));
        store.set(richTextRenderingEnabledAtom, true);
        const calls = [], listeners = { queue: new Set(), stream: new Set() };
        let rejectSend, resolveSend, rejectSave, resolveSave;
        const submit = input => {
          calls.push(input);
          return new Promise((resolve, reject) => { rejectSend = reject; resolveSend = resolve; });
        };
        const subscribe = name => callback => { listeners[name].add(callback); return () => listeners[name].delete(callback); };
        const api = {
          onAgentQueuedMessageStatus: subscribe('queue'), onAgentStreamEvent: subscribe('stream'),
          sendAgentMessage: submit, submitOrEnqueueAgentMessage: submit,
          getQueuedAgentMessages: async () => options.mainAccepted && calls[0]?.queueMessageId ? [{ input: calls[0], queuedAt: 1 }] : [],
          listActiveAgentSessionSnapshots: async () => options.mainAccepted && calls[0]?.startedAt ? [{ sessionId: calls[0].sessionId, startedAt: calls[0].startedAt }] : [],
          getPiReasoningCapability: async () => undefined,
          getAgentSessionSDKMessages: async () => [],
          getAgentSessionPath: async () => '/fixture', getWorkspaceFilesPath: async () => '/fixture',
          getWorkspaceAttachedFiles: async () => [],
          getWorkspaceCapabilities: async () => ({ skills: [], mcpServers: [] }),
          listAgentTasks: async () => [], getAgentTasks: async () => [],
          saveFilesToAgentSession: async input => {
            if (options.waitSave) await new Promise((resolve, reject) => { rejectSave = reject; resolveSave = resolve; });
            return input.files.map(file => ({ filename: file.filename, targetPath: '/fixture/' + file.filename }));
          },
        };
        window.electronAPI = new Proxy(api, { get: (target, name) => target[name] ?? (String(name).startsWith('on') ? () => () => {} : async () => []) });
        const session = id => ({ id, title: id, workspaceId: 'workspace', channelId: 'channel', modelId: 'model', createdAt: 1, updatedAt: 1 });
        store.set(atoms.agentSessionsAtom, [session('a'), session('b')]);
        store.set(atoms.agentWorkspacesAtom, [{ id: 'workspace', slug: 'fixture', name: 'fixture', projectRootPath: '/fixture' }]);
        store.set(atoms.currentAgentSessionIdAtom, 'a');
        store.set(atoms.currentAgentWorkspaceIdAtom, 'workspace');
        store.set(channelsAtom, [{ id: 'channel', name: 'fixture', provider: 'anthropic', baseUrl: 'https://fixture.invalid', apiKey: '', createdAt: 1, updatedAt: 1, enabled: true, models: [{ id: 'model', name: 'model', enabled: true }] }]);
        if (options.streaming) store.set(atoms.agentStreamingStatesAtom, new Map([['a', { running: true, startedAt: 1 }]]));
        if (options.background) store.set(atoms.agentStreamingStatesAtom, new Map([['a', { running: false, backgroundWaiting: true, startedAt: 1 }]]));
        if (options.attachment) {
          store.set(atoms.agentPendingFilesAtomFamily('a'), [{ id: 'file', filename: '附件.txt', mediaType: 'text/plain', size: 4 }]);
          window.__pendingAgentFileData = new Map([['file', 'ZGF0YQ==']]);
        }
        const quote = { text: '原选区正文', filePath: '/fixture/原文件.md', sourceType: 'file', capturedAt: 1 };
        if (options.quote) store.set(quotedSelectionMapAtom, new Map([['a', quote]]));
        let active = 'a';
        const render = () => root.render(React.createElement(Provider, { store }, React.createElement(TooltipProvider, null,
          React.createElement(React.Fragment, null, React.createElement(AgentView, { sessionId: active, embedded: true }), React.createElement(Toaster)))));
        render();
        await until(() => document.querySelector('.tiptap')?.editor);
        await delay(100);
        const editor = () => document.querySelector('.tiptap').editor;
        const key = () => document.querySelector('.tiptap').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        editor().commands.insertContent('<p>失败草稿<strong>保留格式</strong></p>');
        return { store, root, calls, editor, key,
          newQuote: () => store.set(quotedSelectionMapAtom, new Map([['a', { ...quote, text: '新选区正文', capturedAt: 2 }]])),
          quote: id => store.get(quotedSelectionMapAtom).get(id),
          addNewFile: () => store.set(atoms.agentPendingFilesAtomFamily('a'), previous => [...previous, { id: 'new-file', filename: '新附件.txt', mediaType: 'text/plain', size: 1, sourcePath: '/fixture/new.txt' }]),
          reject: () => rejectSend(new Error('隔离 IPC 失败')),
          rejectSave: () => rejectSave(new Error('附件准备失败')),
          resolveSave: () => resolveSave(),
          accept: () => {
            const input = calls[0];
            if (input.queueMessageId && options.background) for (const listener of listeners.stream) listener({ sessionId: input.sessionId, payload: { kind: 'sdk_message', message: { type: 'user', uuid: input.queueMessageId } } });
            else if (input.queueMessageId) for (const listener of listeners.queue) listener({ sessionId: input.sessionId, messageId: input.queueMessageId, status: 'started', startedAt: 100 });
            else for (const listener of listeners.stream) listener({ sessionId: input.sessionId, payload: { kind: 'gamma_event', event: { type: 'run_started', startedAt: input.startedAt } } });
          },
          switch: async () => { active = 'b'; store.set(atoms.currentAgentSessionIdAtom, 'b'); render(); await delay(60); },
          draft: id => store.get(atoms.agentSessionDraftsAtom).get(id) ?? '',
          html: id => store.get(atoms.agentSessionDraftHtmlAtom).get(id) ?? '',
          files: id => store.get(atoms.agentPendingFilesAtomFamily(id)),
          messages: id => store.get(atoms.agentSDKMessagesCacheAtom).get(id) ?? [],
        };
      }
    };
  `)
}, 90_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 AgentView 与可控的拒绝 IPC', () => {
  for (const mode of ['direct', 'queue', 'background']) {
    test(`When ${mode} 提交失败 Then 恢复正文/富文本/附件并回滚本次乐观消息`, async () => {
      const result = await renderer.run<{ draft: string; html: string; files: number; calls: number; messages: number; error: boolean }>(`
        const f = await window.sendRecovery.mount({ streaming: ${mode === 'queue'}, background: ${mode === 'background'}, attachment: true });
        f.key(); f.key();
        await window.sendRecovery.until(() => f.calls.length === 1);
        await window.sendRecovery.delay(); f.reject();
        await window.sendRecovery.until(() => f.draft('a').includes('失败草稿'));
        const result = { draft: f.draft('a'), html: f.html('a'), files: f.files('a').length, calls: f.calls.length, messages: f.messages('a').length, error: document.body.innerText.includes('消息发送失败') };
        f.root.unmount(); return result;
      `)
      expect(result.draft).toContain('失败草稿')
      expect(result.html).toContain('<strong>保留格式</strong>')
      expect(result.files).toBe(1)
      expect(result.calls).toBe(1)
      expect(result.messages).toBe(0)
      expect(result.error).toBe(true)
    }, 30_000)
  }

  test('When 失败前输入新草稿且尚未同步 Then 不覆盖，显式恢复只追加', async () => {
    expect(await renderer.run<{ kept: string; appended: string }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1);
      await window.sendRecovery.delay();
      f.editor().commands.insertContent('新草稿'); f.reject();
      await window.sendRecovery.until(() => document.body.innerText.includes('追加失败草稿'));
      const kept = f.editor().getText();
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === '追加失败草稿').click();
      await window.sendRecovery.delay();
      const appended = f.editor().getText(); f.root.unmount(); return { kept, appended };
    `)).toEqual({ kept: '新草稿', appended: '新草稿\n\n失败草稿保留格式' })
  }, 30_000)

  test('When 提交期间切会话后 IPC 失败 Then 只恢复原会话', async () => {
    expect(await renderer.run<{ old: string; active: string }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1);
      await f.switch(); f.editor().commands.insertContent('B 的新草稿'); f.reject();
      await window.sendRecovery.until(() => f.draft('a').includes('失败草稿'));
      const result = { old: f.draft('a'), active: f.editor().getText() };
      f.root.unmount(); return result;
    `)).toEqual({ old: '失败草稿**保留格式**', active: 'B 的新草稿' })
  }, 30_000)

  test('When 附件准备失败 Then 原始输入/附件都不清空且没有提交 IPC', async () => {
    expect(await renderer.run<{ draft: string; files: number; calls: number }>(`
      const f = await window.sendRecovery.mount({ attachment: true, waitSave: true }); f.key(); f.key();
      await window.sendRecovery.delay(80); f.rejectSave();
      await window.sendRecovery.delay(80);
      const result = { draft: f.editor().getText(), files: f.files('a').length, calls: f.calls.length };
      f.root.unmount(); return result;
    `)).toEqual({ draft: '失败草稿保留格式', files: 1, calls: 0 })
  }, 30_000)

  test('When 真实 started 已先到达且重复重放 Then IPC 拒绝也不能恢复已发送消息', async () => {
    expect(await renderer.run<{ draft: string; messages: number }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1);
      await window.sendRecovery.delay(); f.accept(); f.accept(); f.reject();
      await window.sendRecovery.delay(80);
      const result = { draft: f.draft('a'), messages: f.messages('a').length };
      f.root.unmount(); return result;
    `)).toEqual({ draft: '', messages: 1 })
  }, 30_000)
  test('When 附件准备中切会话并新增附件 Then 失败只回填原会话，不清空新附件或另一会话历史', async () => {
    expect(await renderer.run<{ files: number; current: string; old: string; otherMessages: number }>(`
      const f = await window.sendRecovery.mount({ attachment: true, waitSave: true });
      f.key(); await window.sendRecovery.delay(80);
      f.addNewFile(); await f.switch();
      f.editor().commands.insertContent('另一个会话');
      f.resolveSave();
      await window.sendRecovery.until(() => f.calls.length === 1);
      f.reject(); await window.sendRecovery.until(() => document.body.innerText.includes('追加失败草稿'));
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === '追加失败草稿').click();
      await window.sendRecovery.delay();
      const result = { files: f.files('a').length, current: f.editor().getText(), old: f.draft('a'), otherMessages: f.messages('b').length };
      f.root.unmount(); return result;
    `)).toEqual({ files: 2, current: '另一个会话', old: '失败草稿**保留格式**', otherMessages: 0 })
  }, 30_000)

  test('When 失败前用户选中另一段引用 Then 新引用不被覆盖，原引用作为可编辑 chip 恢复', async () => {
    expect(await renderer.run<{ quote: string; inlineQuote: boolean; htmlQuote: boolean }>(`
      const f = await window.sendRecovery.mount({ quote: true }); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1);
      await window.sendRecovery.delay(); f.newQuote(); f.reject();
      await window.sendRecovery.until(() => document.body.innerText.includes('追加失败草稿'));
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === '追加失败草稿').click();
      await window.sendRecovery.delay();
      const result = { quote: f.quote('a').text, inlineQuote: f.draft('a').includes('&quote:'), htmlQuote: f.html('a').includes('data-mention-quote=') };
      f.root.unmount(); return result;
    `)).toEqual({ quote: '新选区正文', inlineQuote: true, htmlQuote: true })
  }, 30_000)

  for (const streaming of [false, true]) {
    test(`When ${streaming ? '队列' : '直接运行'}已在主进程接管但事件晚到 Then IPC 拒绝不恢复草稿`, async () => {
      expect(await renderer.run<{ draft: string; visible: boolean }>(`
        const f = await window.sendRecovery.mount({ mainAccepted: true, streaming: ${streaming} }); f.key();
        await window.sendRecovery.until(() => f.calls.length === 1);
        await window.sendRecovery.delay(); f.reject();
        await window.sendRecovery.until(() => document.body.innerText.includes('消息已被 Agent 接收'));
        const result = { draft: f.draft('a'), visible: document.body.innerText.includes('消息已被 Agent 接收') };
        f.root.unmount(); return result;
      `)).toEqual({ draft: '', visible: true })
    }, 30_000)
  }

  test('When 后台追加的真实 SDK 用户消息先到且重放 Then IPC 拒绝也不恢复已注入内容', async () => {
    expect(await renderer.run<{ draft: string; visible: boolean }>(`
      const f = await window.sendRecovery.mount({ background: true }); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1);
      await window.sendRecovery.delay(); f.accept(); f.accept(); f.reject();
      await window.sendRecovery.until(() => document.body.innerText.includes('消息已被 Agent 接收'));
      const result = { draft: f.draft('a'), visible: document.body.innerText.includes('消息已被 Agent 接收') };
      f.root.unmount(); return result;
    `)).toEqual({ draft: '', visible: true })
  }, 30_000)

  for (const mode of ['direct', 'queue', 'background']) {
    test(`When ${mode} 的 A 失败而用户已输入 B Then 不自动混入 A 附件和引用，显式恢复整体合并且幂等`, async () => {
      expect(await renderer.run<{ before: { text: string; files: number; quote: boolean }; after: { text: string; files: number; quote: string } }>(`
        const f = await window.sendRecovery.mount({ attachment: true, quote: true, streaming: ${mode === 'queue'}, background: ${mode === 'background'} });
        f.key(); await window.sendRecovery.until(() => f.calls.length === 1);
        await window.sendRecovery.delay(); f.editor().commands.insertContent('B 新草稿'); f.reject();
        await window.sendRecovery.until(() => document.body.innerText.includes('追加失败草稿'));
        const before = { text: f.editor().getText(), files: f.files('a').length, quote: !!f.quote('a') };
        const action = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '追加失败草稿');
        action.click(); action.click();
        await window.sendRecovery.delay();
        const after = { text: f.editor().getText(), files: f.files('a').length, quote: f.quote('a')?.text };
        f.root.unmount(); return { before, after };
      `)).toEqual({ before: { text: 'B 新草稿', files: 0, quote: false }, after: { text: 'B 新草稿\n\n失败草稿保留格式', files: 1, quote: '原选区正文' } })
    }, 30_000)
  }

})
