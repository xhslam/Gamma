import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { AgentSendOutboxEntry } from '@gamma/shared'
import { parseSendOutboxEntry } from '../../../main/lib/agent-send-outbox'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let renderer: ElectronRendererHarness
let validationDirectory: string
beforeAll(async () => {
  validationDirectory = await mkdtemp(join(tmpdir(), 'gamma-send-ipc-'))
  const validationModule = join(validationDirectory, 'outbox.cjs')
  const outboxCjsSource = `
const fs = require('node:fs');
const path = require('node:path');
const GAMMA_PERMISSION_MODES = ['bypassPermissions', 'plan'];

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSendOutboxEntry(value, sessionId) {
  if (!isRecord(value) || value.sessionId !== sessionId || typeof value.id !== 'string'
    || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt) || (value.status !== 'pending' && value.status !== 'failed')
    || !isRecord(value.draft) || typeof value.draft.text !== 'string' || typeof value.draft.html !== 'string'
    || !Array.isArray(value.draft.attachments) || !isRecord(value.input)) {
    throw new Error('失败消息快照格式无效');
  }
  const input = value.input;
  if (input.sessionId !== sessionId) throw new Error('发送快照的会话不一致');
  if (input.queueMessageId !== value.id || input.userMessageUuid !== value.id) throw new Error('发送快照的消息 ID 不一致');
  if (typeof input.userMessage !== 'string' || !input.userMessage.trim()) throw new Error('发送正文为空，请检查消息引用');
  if (typeof input.channelId !== 'string' || !input.channelId) throw new Error('发送渠道无效，请重新选择渠道');
  if (input.dispatch !== 'now' && input.dispatch !== 'after_current') throw new Error('发送调度方式无效，请重新提交消息');
  const attachments = value.draft.attachments.map((file) => {
    if (!isRecord(file) || typeof file.filename !== 'string' || typeof file.mediaType !== 'string'
      || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0
      || typeof file.targetPath !== 'string' || !path.isAbsolute(file.targetPath)) throw new Error('失败消息附件无效');
    return { filename: file.filename, mediaType: file.mediaType, size: file.size, targetPath: file.targetPath };
  });
  const safeInput = {
    sessionId, queueMessageId: value.id, userMessageUuid: value.id,
    channelId: input.channelId, userMessage: input.userMessage, dispatch: input.dispatch,
  };
  for (const key of ['rawUserMessage', 'modelId', 'workspaceId', 'retryOfErrorUuid', 'retryOfUserMessageUuid']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new Error('失败消息参数类型无效');
      safeInput[key] = input[key];
    }
  }
  for (const key of ['additionalDirectories', 'mentionedSkills', 'mentionedMcpServers', 'mentionedSessionIds', 'mentionedTodoIds', 'mentionedCalendarEventIds']) {
    const items = input[key];
    if (items !== undefined) {
      if (!Array.isArray(items) || !items.every((item) => typeof item === 'string')) throw new Error('失败消息引用无效');
      safeInput[key] = items;
    }
  }
  if (input.contextRefs !== undefined) safeInput.contextRefs = input.contextRefs;
  if (input.contextRefIds !== undefined) {
    if (!Array.isArray(input.contextRefIds) || input.contextRefIds.length > 5 || !input.contextRefIds.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('发送引用ID无效');
    safeInput.contextRefIds = [...input.contextRefIds];
  }
  if (input.permissionModeOverride !== undefined) {
    if (!GAMMA_PERMISSION_MODES.some((mode) => mode === input.permissionModeOverride)) throw new Error('失败消息权限模式无效');
    safeInput.permissionModeOverride = input.permissionModeOverride;
  }
  if (typeof input.startedAt === 'number' && Number.isFinite(input.startedAt)) safeInput.startedAt = input.startedAt;
  return {
    id: value.id, sessionId, createdAt: value.createdAt, status: value.status,
    ...(typeof value.error === 'string' && { error: value.error.slice(0, 2000) }),
    draft: { text: value.draft.text, html: value.draft.html, attachments }, input: safeInput,
  };
}

class AgentSendOutbox {
  constructor(resolvePath) {
    this.resolvePath = resolvePath;
  }
  list(sessionId) {
    const p = this.resolvePath(sessionId);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const document = JSON.parse(raw);
    return document.entries.map((entry) => parseSendOutboxEntry(entry, sessionId));
  }
  save(value) {
    const entry = parseSendOutboxEntry(value, value.sessionId);
    const entries = this.list(entry.sessionId);
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
    const p = this.resolvePath(entry.sessionId);
    const tmp = p + '.' + Math.random().toString(36).slice(2) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }), 'utf8');
    fs.renameSync(tmp, p);
  }
}

module.exports = { parseSendOutboxEntry, AgentSendOutbox };
`;
  await writeFile(validationModule, outboxCjsSource, 'utf-8')
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { Toaster } from 'sonner'
    import { AgentView } from '@/components/agent/AgentView'
    import { useGlobalAgentListeners } from '@/hooks/useGlobalAgentListeners'
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
        const calls = [], routes = [], saves = [], retries = [], created = [], cancellations = [], queuedAccepted = [], disk = options.disk ?? [];
        const listeners = { queue: new Set(), stream: new Set(), complete: new Set() };
        let rejectSend, resolveSend, rejectSave, resolveSave, resolveRetry;
        const pendingSubmissions = [];
        const submit = (input, route) => {
          calls.push(input);
          routes.push(route);
          return new Promise((resolve, reject) => {
            const receive = result => {
              if (options.trackMainQueue && result.disposition === 'queued' && !queuedAccepted.some(entry => entry.input.queueMessageId === input.queueMessageId)) {
                queuedAccepted.push({ input: structuredClone(input), queuedAt: Date.now() });
              }
              resolve(result);
            };
            rejectSend = reject; resolveSend = receive;
            pendingSubmissions.push({ resolve: receive, reject });
          });
        };
        const subscribe = name => callback => { listeners[name].add(callback); return () => listeners[name].delete(callback); };
        const api = {
          onAgentQueuedMessageStatus: subscribe('queue'), onAgentStreamEvent: subscribe('stream'), onAgentStreamComplete: subscribe('complete'),
          sendAgentMessage: input => submit(input, 'direct'), submitOrEnqueueAgentMessage: input => submit(input, 'submit'),
          saveAgentSendOutbox: async entry => {
            saves.push(structuredClone(entry));
            if (options.failPersist) throw new Error('磁盘写入失败');
            await window.outboxValidation.save(entry);
            const index = disk.findIndex(item => item.id === entry.id && item.sessionId === entry.sessionId);
            if (index < 0) disk.push(structuredClone(entry)); else disk[index] = structuredClone(entry);
          },
          listAgentSendOutbox: async id => structuredClone(disk.filter(entry => entry.sessionId === id)),
          retryAgentSendOutbox: async input => {
            retries.push(structuredClone(input));
            if (options.waitRetry) await new Promise(resolve => { resolveRetry = resolve; });
            if (options.failRetry) throw new Error('仍然离线');
            const index = disk.findIndex(entry => entry.id === input.messageId && entry.sessionId === input.sessionId);
            if (options.retryDisposition === 'queued' && index >= 0) queuedAccepted.push({ input: structuredClone(disk[index].input), queuedAt: Date.now() });
            if (index >= 0) disk.splice(index, 1);
            return { disposition: options.retryDisposition ?? 'started' };
          },
          cancelAgentQueuedMessage: async input => {
            cancellations.push(structuredClone(input));
            if (options.failCancel) throw new Error('取消队列失败');
            const index = queuedAccepted.findIndex(entry => entry.input.queueMessageId === input.messageId && entry.input.sessionId === input.sessionId);
            if (index < 0) return false;
            if (!input.preserveSendOutbox) {
              const logIndex = disk.findIndex(entry => entry.id === input.messageId && entry.sessionId === input.sessionId);
              if (logIndex >= 0) disk.splice(logIndex, 1);
            }
            queuedAccepted.splice(index, 1); return true;
          },
          getQueuedAgentMessages: async () => options.mainAccepted && calls[0]?.queueMessageId ? [{ input: calls[0], queuedAt: 1 }] : structuredClone(queuedAccepted),
          listActiveAgentSessionSnapshots: async () => options.mainAccepted && calls[0]?.startedAt ? [{ sessionId: calls[0].sessionId, startedAt: calls[0].startedAt }] : [],
          getPiReasoningCapability: async () => undefined,
          getAgentSessionSDKMessages: async id => id === 'a' ? structuredClone(options.history ?? []) : [],
          createAgentSession: async () => { const meta = session('new-session'); created.push(meta); return meta; },
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
        const GlobalListeners = () => { useGlobalAgentListeners(); return null; };
        const render = () => root.render(React.createElement(Provider, { store }, React.createElement(TooltipProvider, null,
          React.createElement(React.Fragment, null, options.globalListeners && React.createElement(GlobalListeners), React.createElement(AgentView, { sessionId: active, embedded: true }), React.createElement(Toaster)))));
        render();
        await until(() => document.querySelector('.tiptap')?.editor);
        await delay(100);
        const editor = () => document.querySelector('.tiptap').editor;
        const key = () => document.querySelector('.tiptap').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        if (options.initialText !== '') editor().commands.insertContent(options.initialText ?? '<p>失败草稿<strong>保留格式</strong></p>');
        return { store, root, calls, routes, saves, retries, created, disk, cancellations, queuedAccepted, editor, key, resolveRetry: () => resolveRetry(),
          resolve: () => resolveSend({ disposition: 'queued' }),
          resolveDuplicate: () => resolveSend({ disposition: 'accepted' }),
          resolveWith: result => resolveSend(result),
          resolveAt: index => pendingSubmissions[index].resolve({ disposition: 'queued' }),
          emitStream: event => { for (const listener of listeners.stream) listener(event); },
          emitQueue: event => { for (const listener of listeners.queue) listener(event); },
          emitComplete: event => { for (const listener of listeners.complete) listener(event); },
          running: () => store.get(atoms.agentStreamingStatesAtom).get('a')?.running ?? false,
          streamState: (id = 'a') => store.get(atoms.agentStreamingStatesAtom).get(id),
          queue: (id = 'a') => store.get(atoms.agentSessionMessageQueueAtom).get(id) ?? [],
          liveMessages: (id = 'a') => store.get(atoms.liveMessagesMapAtom).get(id) ?? [],
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
          switchTo: async id => { active = id; store.set(atoms.currentAgentSessionIdAtom, id); render(); await delay(80); },
          draft: id => store.get(atoms.agentSessionDraftsAtom).get(id) ?? '',
          html: id => store.get(atoms.agentSessionDraftHtmlAtom).get(id) ?? '',
          files: id => store.get(atoms.agentPendingFilesAtomFamily(id)),
          messages: id => store.get(atoms.agentSDKMessagesCacheAtom).get(id) ?? [],
        };
      }
    };
  `, {
    mainProcessSetup: `
      const { ipcMain } = require('electron');
      const { AgentSendOutbox } = require(${JSON.stringify(validationModule)});
      const outbox = new AgentSendOutbox(id => require('node:path').join(${JSON.stringify(validationDirectory)}, process.pid + '-' + id + '.json'));
      ipcMain.handle('test:save-send-outbox', (_, entry) => outbox.save(entry));
    `,
    preloadSource: `
      const { contextBridge, ipcRenderer } = require('electron');
      contextBridge.exposeInMainWorld('outboxValidation', { save: entry => ipcRenderer.invoke('test:save-send-outbox', entry) });
    `,
  })
}, 90_000)
afterAll(async () => {
  await renderer?.dispose()
  if (validationDirectory) await rm(validationDirectory, { recursive: true, force: true })
})

describe('Given 真实 AgentView 与可控的拒绝 IPC', () => {
  for (const streaming of [false, true]) {
    for (const text of ['普通文字消息', '/skill:gamma-coach', '#mcp:example', '&session:other-session', '&todo:todo-1', '&calendar_event:event-1']) {
      test(`When ${streaming ? '工作中排队' : '空闲发送'} ${text} Then 真实主进程暂存校验接受同一份发送参数`, async () => {
        const snapshots = await renderer.run<AgentSendOutboxEntry[]>(`
          const api = window.sendRecovery, f = await api.mount({ streaming: ${streaming}, initialText: '' });
          f.editor().commands.insertContent(${JSON.stringify(text)});
          await api.delay(); document.querySelector('button[aria-label="${streaming ? '排队发送消息' : '发送消息'}"]').click();
          await api.until(() => f.calls.length === 1);
          const result = structuredClone(f.saves); f.resolve(); await api.delay(30); f.root.unmount(); return result;
        `)
        expect(snapshots).toHaveLength(1)
        for (const snapshot of snapshots) {
          expect(() => parseSendOutboxEntry(snapshot, snapshot.sessionId)).not.toThrow()
          expect(snapshot.input.userMessage.trim()).not.toBe('')
          expect(snapshot.input.dispatch).toBe('after_current')
        }
      }, 30_000)
    }
  }
  test('When 工作中排队后撤回 Then 正文和附件回到输入框，保留新草稿与新选区且清除暂存日志', async () => {
    expect(await renderer.run<{ queued: number; mainQueued: number; disk: number; files: number; oldText: boolean; newText: boolean; html: boolean; quote: string; inlineQuote: boolean }>(`
      const api = window.sendRecovery, f = await api.mount({ streaming: true, trackMainQueue: true, attachment: true, quote: true });
      f.key(); await api.until(() => f.calls.length === 1); f.resolve();
      await api.until(() => !!document.querySelector('button[aria-label="撤回到输入框"]'));
      f.editor().commands.insertContent('<p>新草稿<strong>新格式</strong></p>'); f.newQuote();
      document.querySelector('button[aria-label="撤回到输入框"]').click();
      await api.until(() => f.queue().length === 0 && f.editor().getText().includes('失败草稿'));
      const result = { queued: f.queue().length, mainQueued: f.queuedAccepted.length, disk: f.disk.length, files: f.files('a').length,
        oldText: f.editor().getText().includes('失败草稿'), newText: f.editor().getText().includes('新草稿'), html: f.html('a').includes('<strong>新格式</strong>'),
        quote: f.quote('a').text, inlineQuote: f.draft('a').includes('&quote:') };
      f.root.unmount(); return result;
    `)).toEqual({ queued: 0, mainQueued: 0, disk: 0, files: 1, oldText: true, newText: true, html: true, quote: '新选区正文', inlineQuote: true })
  }, 30_000)

  test('When 点击立即插队两次 Then 同一 ID 只插队一次，保留当前新草稿并传递中断意图', async () => {
    expect(await renderer.run<{ calls: number; cancellations: number; dispatch: string; interrupt: boolean; sameId: boolean; preserved: boolean; queued: number; draft: string }>(`
      const api = window.sendRecovery, f = await api.mount({ streaming: true, trackMainQueue: true });
      f.key(); await api.until(() => f.calls.length === 1); f.resolve();
      await api.until(() => !!document.querySelector('button[aria-label="立即插队（打断当前执行）"]'));
      f.editor().commands.insertContent('继续编辑的新草稿');
      const button = document.querySelector('button[aria-label="立即插队（打断当前执行）"]'); button.click(); button.click();
      await api.until(() => f.calls.length === 2); f.resolveWith({ disposition: 'injected' }); await api.delay();
      const result = { calls: f.calls.length, cancellations: f.cancellations.length, dispatch: f.calls[1].dispatch, interrupt: f.calls[1].interrupt,
        sameId: f.calls[0].queueMessageId === f.calls[1].queueMessageId, preserved: f.cancellations[0].preserveSendOutbox,
        queued: f.queue().length, draft: f.editor().getText() }; f.root.unmount(); return result;
    `)).toEqual({ calls: 2, cancellations: 1, dispatch: 'now', interrupt: true, sameId: true, preserved: true, queued: 0, draft: '继续编辑的新草稿' })
  }, 30_000)

  for (const response of ['queued', 'rejected']) {
    test(`When 插队启动事件先于 ${response} 回执 Then 不复活队列消息、不再次提交`, async () => {
      expect(await renderer.run<{ calls: number; queued: number; failed: boolean }>(`
        const api = window.sendRecovery, f = await api.mount({ streaming: true, trackMainQueue: true });
        f.key(); await api.until(() => f.calls.length === 1); f.resolve();
        await api.until(() => !!document.querySelector('button[aria-label="立即插队（打断当前执行）"]'));
        document.querySelector('button[aria-label="立即插队（打断当前执行）"]').click();
        await api.until(() => f.calls.length === 2);
        f.emitQueue({ sessionId: 'a', messageId: f.calls[1].queueMessageId, status: 'started', startedAt: Date.now() });
        ${response === 'queued' ? 'f.resolve();' : 'f.reject();'} await api.delay(80);
        const result = { calls: f.calls.length, queued: f.queue().length, failed: f.disk[0]?.status === 'failed' }; f.root.unmount(); return result;
      `)).toEqual({ calls: 2, queued: 0, failed: false })
    }, 30_000)
  }

  for (const failRestore of [false, true]) {
    test(`When 插队失败且重新入队${failRestore ? '也失败' : '成功'} Then ${failRestore ? '显式暂存，不显示虚假队列' : '恢复主进程队列，不只恢复界面'}`, async () => {
      expect(await renderer.run<{ calls: number; queued: number; mainQueued: number; failed: boolean; dispatch: string; interrupt: boolean; sameId: boolean }>(`
        const api = window.sendRecovery, f = await api.mount({ streaming: true, trackMainQueue: true });
        f.key(); await api.until(() => f.calls.length === 1); f.resolve();
        await api.until(() => !!document.querySelector('button[aria-label="立即插队（打断当前执行）"]'));
        document.querySelector('button[aria-label="立即插队（打断当前执行）"]').click();
        await api.until(() => f.calls.length === 2); f.reject(); await api.until(() => f.calls.length === 3);
        ${failRestore ? 'f.reject(); await api.until(() => f.disk[0]?.status === "failed");' : 'f.resolve(); await api.until(() => f.queue().length === 1);'}
        const result = { calls: f.calls.length, queued: f.queue().length, mainQueued: f.queuedAccepted.length, failed: f.disk[0]?.status === 'failed',
          dispatch: f.calls[2].dispatch, interrupt: f.calls[2].interrupt, sameId: f.calls.every(input => input.queueMessageId === f.calls[0].queueMessageId) };
        f.root.unmount(); return result;
      `)).toEqual({ calls: 3, queued: failRestore ? 0 : 1, mainQueued: failRestore ? 0 : 1, failed: failRestore, dispatch: 'after_current', interrupt: false, sameId: true })
    }, 30_000)
  }

  test('When 连续发送前校验失败 Then 保留原草稿且同会话只显示一条失败提示', async () => {
    expect(await renderer.run<{ toasts: number; calls: number; draft: boolean }>(`
      const api = window.sendRecovery, f = await api.mount({ streaming: true, failPersist: true });
      for (let i = 0; i < 3; i++) { f.key(); await api.until(() => f.saves.length === i + 1); await api.delay(80); }
      const result = { toasts: document.querySelectorAll('[data-sonner-toast]').length, calls: f.calls.length, draft: f.editor().getText().includes('失败草稿') };
      f.root.unmount(); return result;
    `)).toEqual({ toasts: 1, calls: 0, draft: true })
  }, 30_000)

  test('When renderer 空闲但主进程仍忙 Then 统一提交并转为队列，不能留下虚假的运行和已发送气泡', async () => {
    expect(await renderer.run<{ routes: string[]; dispatch: string; queued: number; running: boolean; messages: number; draft: string }>(`
      const api = window.sendRecovery, f = await api.mount(); f.key();
      await api.until(() => f.calls.length === 1);
      f.resolveWith({ disposition: 'queued' });
      await api.delay(80);
      const first = { running: f.running(), messages: f.messages('a').length, draft: f.draft('a') };
      f.editor().commands.insertContent('主进程收尾时的下一条消息'); f.key();
      await api.until(() => f.calls.length === 2); f.resolveWith({ disposition: 'queued' });
      await api.delay(60);
      const result = { routes: f.routes, dispatch: f.calls[0].dispatch, queued: f.queue().length, ...first };
      f.root.unmount(); return result;
    `)).toEqual({ routes: ['submit', 'submit'], dispatch: 'after_current', queued: 2, running: false, messages: 0, draft: '' })
  }, 30_000)

  test('When 主进程立即确认启动 Then 不等待任务完成就可提交下一条消息', async () => {
    expect(await renderer.run<{ routes: string[]; running: boolean; messages: number; queued: number }>(`
      const api = window.sendRecovery, f = await api.mount(); f.key();
      await api.until(() => f.calls.length === 1); f.resolveWith({ disposition: 'started' }); await api.delay(60);
      const first = { running: f.running(), messages: f.messages('a').length };
      f.editor().commands.insertContent('任务执行中的消息'); f.key();
      await api.until(() => f.calls.length === 2); f.resolveWith({ disposition: 'queued' }); await api.delay(60);
      const result = { routes: f.routes, ...first, queued: f.queue().length }; f.root.unmount(); return result;
    `)).toEqual({ routes: ['submit', 'submit'], running: true, messages: 1, queued: 1 })
  }, 30_000)

  test('When started 先到且 queued 回执晚到 Then 保留权威新 run，旧 complete 不清运行态且后续仍可排队', async () => {
    expect(await renderer.run<{ generation: number; queuedBefore: number; running: boolean; calls: number; queuedAfter: number }>(`
      const api = window.sendRecovery, f = await api.mount({ globalListeners: true }); f.key();
      await api.until(() => f.calls.length === 1);
      const input = f.calls[0], startedAt = Date.now() + 10;
      f.emitQueue({ sessionId: 'a', messageId: input.userMessageUuid, status: 'started', userMessage: input.userMessage, rawUserMessage: input.rawUserMessage, startedAt, runGeneration: 2 });
      f.resolveWith({ disposition: 'queued' }); await api.delay(60);
      f.emitComplete({ sessionId: 'a', messages: [], startedAt: startedAt - 1, runGeneration: 1, stoppedByUser: false });
      await api.delay(60);
      const first = { generation: f.streamState()?.runGeneration, queuedBefore: f.queue().length, running: f.running() };
      f.editor().commands.insertContent('旧完成事件之后继续发送'); f.key();
      await api.until(() => f.calls.length === 2); f.resolveWith({ disposition: 'queued' }); await api.delay(60);
      const result = { ...first, calls: f.calls.length, queuedAfter: f.queue().length }; f.root.unmount(); return result;
    `)).toEqual({ generation: 2, queuedBefore: 0, running: true, calls: 2, queuedAfter: 1 })
  }, 30_000)

  for (const confirmation of ['run_started', 'sdk_message']) {
    test(`When ${confirmation} 已确认首条消息但 IPC 仍在等待整轮任务 Then 可继续排队且旧请求收尾不解锁新提交`, async () => {
      expect(await renderer.run<{ before: number; after: number; queued: boolean; oldFinishKeptLock: boolean; running: boolean }>(`
        const api = window.sendRecovery, f = await api.mount(); f.key();
        await api.until(() => f.calls.length === 1);
        await api.delay(); f.editor().commands.insertContent('运行中追加的消息');
        f.emitStream({ sessionId: 'a', payload: { kind: 'gamma_event', event: { type: 'run_started', startedAt: -1 } } });
        f.key(); await api.delay(60); const before = f.calls.length;
        f.emitStream({ sessionId: 'a', payload: ${confirmation === 'run_started'
          ? "{ kind: 'gamma_event', event: { type: 'run_started', startedAt: f.calls[0].startedAt } }"
          : "{ kind: 'sdk_message', message: { type: 'user', uuid: f.calls[0].userMessageUuid, message: { content: [] } } }"} });
        f.key(); await api.until(() => f.calls.length === 2);
        const queued = f.calls[1].dispatch === 'after_current' && f.calls[1].rawUserMessage.includes('运行中追加的消息');
        f.editor().commands.insertContent('第三条草稿'); f.resolveAt(0); await api.delay(80);
        f.key(); await api.delay(80); const oldFinishKeptLock = f.calls.length === 2;
        const result = { before, after: f.calls.length, queued, oldFinishKeptLock, running: f.running() };
        f.resolveAt(1); await api.delay(50); f.root.unmount(); return result;
      `)).toEqual({ before: 1, after: 2, queued: true, oldFinishKeptLock: true, running: true })
    }, 30_000)
  }

  test('When 运行中仅附加文件 Then 可点击排队发送并保留停止入口', async () => {
    expect(await renderer.run<{ enabled: boolean; stop: boolean; queued: boolean; attachment: boolean }>(`
      const api = window.sendRecovery, f = await api.mount({ streaming: true, attachment: true, initialText: '' });
      const send = document.querySelector('button[aria-label="排队发送消息"]');
      const enabled = !!send && !send.disabled, stop = !!document.querySelector('button[aria-label="停止 Agent"]');
      if (send) send.click();
      await api.until(() => f.calls.length === 1);
      const result = { enabled, stop, queued: f.calls[0].dispatch === 'after_current', attachment: f.calls[0].userMessage.includes('附件.txt') };
      f.resolve(); await api.delay(50); f.root.unmount(); return result;
    `)).toEqual({ enabled: true, stop: true, queued: true, attachment: true })
  }, 30_000)

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

describe('Given 持久化发送日志与真实 AgentView', () => {
  test('When Agent 运行中显式重试失败项 Then 原消息排队且保留当前运行和新草稿，双击只提交一次', async () => {
    expect(await renderer.run<{ enabled: boolean; retries: number; automatic: number; queued: number; sameId: boolean; draft: string; running: boolean; startedAt: number }>(`
      const api = window.sendRecovery, first = await api.mount(); first.key();
      await api.until(() => first.calls.length === 1); first.reject(); await api.until(() => first.disk[0]?.status === 'failed');
      const disk = first.disk, id = disk[0].id; first.root.unmount(); await api.delay(30);
      const f = await api.mount({ disk, streaming: true, retryDisposition: 'queued', waitRetry: true, initialText: '正在写的新草稿' });
      await api.until(() => document.querySelector('[aria-label="待恢复消息"]'));
      const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送');
      const enabled = !button.disabled; button.click(); button.click();
      if (enabled) { await api.until(() => f.retries.length === 1); f.editor().commands.insertContent('继续编辑'); f.resolveRetry(); await api.until(() => f.queue().length === 1); }
      const state = f.streamState(), result = { enabled, retries: f.retries.length, automatic: f.calls.length, queued: f.queue().length,
        sameId: f.queue()[0]?.id === id, draft: f.editor().getText(), running: f.running(), startedAt: state?.startedAt };
      f.root.unmount(); return result;
    `)).toEqual({ enabled: true, retries: 1, automatic: 0, queued: 1, sameId: true, draft: '正在写的新草稿继续编辑', running: true, startedAt: 1 })
  }, 30_000)

  test('When 点击发送 Then 网络调用前已保存完整正文、HTML、附件与引用快照', async () => {
    const result = await renderer.run<{ saves: number; id: string; sentId: string; html: string; text: string; attachments: number; includesQuote: boolean }>(`
      const f = await window.sendRecovery.mount({ attachment: true, quote: true }); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1);
      const entry = f.saves[0];
      const result = { saves: f.saves.length, id: entry.id, sentId: f.calls[0].userMessageUuid, html: entry.draft.html, text: entry.draft.text, attachments: entry.draft.attachments.length, includesQuote: entry.input.userMessage.includes('原选区正文') };
      f.reject(); await window.sendRecovery.delay(80); f.root.unmount(); return result;
    `)
    expect(result.saves).toBe(1)
    expect(result.id).toBe(result.sentId)
    expect(result.html).toContain('<strong>保留格式</strong>')
    expect(result.text).toContain('&quote:')
    expect(result.attachments).toBe(1)
    expect(result.includesQuote).toBe(true)
  }, 30_000)

  test('When 发送前落盘失败 Then 不调用网络且原草稿和附件可继续编辑', async () => {
    expect(await renderer.run<{ calls: number; draft: string; files: number; disk: number }>(`
      const f = await window.sendRecovery.mount({ failPersist: true, attachment: true }); f.key();
      await window.sendRecovery.until(() => document.body.innerText.includes('磁盘写入失败'));
      const result = { calls: f.calls.length, draft: f.editor().getText(), files: f.files('a').length, disk: f.disk.length };
      f.root.unmount(); return result;
    `)).toEqual({ calls: 0, draft: '失败草稿保留格式', files: 1, disk: 0 })
  }, 30_000)

  test('When 重挂载模拟重启 Then 暂存入口仍在、不自动发送，连续点击只重试一次且保留新草稿', async () => {
    expect(await renderer.run<{ restored: number; automatic: number; retries: number; kept: string; remaining: number }>(`
      const first = await window.sendRecovery.mount({ attachment: true, quote: true }); first.key();
      await window.sendRecovery.until(() => first.calls.length === 1); first.reject();
      await window.sendRecovery.until(() => first.disk[0]?.status === 'failed');
      const disk = first.disk; first.root.unmount(); await window.sendRecovery.delay(30);
      const f = await window.sendRecovery.mount({ disk, initialText: '<p>重启后的新草稿</p>', waitRetry: true });
      await window.sendRecovery.until(() => document.querySelector('[aria-label="待恢复消息"]'));
      const restored = f.disk.length, automatic = f.calls.length + f.retries.length;
      const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送');
      button.click(); button.click(); await window.sendRecovery.delay(40); const retries = f.retries.length;
      f.editor().commands.insertContent('继续编辑'); f.resolveRetry();
      await window.sendRecovery.until(() => !document.querySelector('[aria-label="待恢复消息"]'));
      const result = { restored, automatic, retries, kept: f.editor().getText(), remaining: f.disk.length };
      f.root.unmount(); return result;
    `)).toEqual({ restored: 1, automatic: 0, retries: 1, kept: '重启后的新草稿继续编辑', remaining: 0 })
  }, 30_000)

  test('When 恢复到输入框 Then 显式追加完整引用附件且重复点击幂等', async () => {
    const result = await renderer.run<{ count: number; files: number; quote: boolean; newDraft: boolean; html: boolean }>(`
      const first = await window.sendRecovery.mount({ attachment: true, quote: true }); first.key();
      await window.sendRecovery.until(() => first.calls.length === 1); first.reject();
      await window.sendRecovery.until(() => first.disk[0]?.status === 'failed');
      const disk = first.disk; first.root.unmount(); await window.sendRecovery.delay(30);
      const f = await window.sendRecovery.mount({ disk, initialText: '<p>新草稿</p>' });
      await window.sendRecovery.until(() => document.querySelector('[aria-label="待恢复消息"]'));
      const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '追加到输入框');
      button.click(); await window.sendRecovery.delay(60); button.click(); await window.sendRecovery.delay(60);
      const html = f.editor().getHTML(), text = f.editor().getText();
      const result = { count: text.split('失败草稿').length - 1, files: f.files('a').length, quote: html.includes('data-mention-quote'), newDraft: text.includes('新草稿'), html: html.includes('<strong>保留格式</strong>') };
      f.root.unmount(); return result;
    `)
    expect(result).toEqual({ count: 1, files: 1, quote: true, newDraft: true, html: true })
  }, 30_000)

  test('When 重试仍然失败 Then 横幅保留且允许再次尝试', async () => {
    expect(await renderer.run<{ kept: boolean; retries: number; files: number }>(`
      const first = await window.sendRecovery.mount({ attachment: true }); first.key();
      await window.sendRecovery.until(() => first.calls.length === 1); first.reject();
      await window.sendRecovery.until(() => first.disk[0]?.status === 'failed');
      const disk = first.disk; first.root.unmount(); await window.sendRecovery.delay(30);
      const f = await window.sendRecovery.mount({ disk, failRetry: true, initialText: '' });
      await window.sendRecovery.until(() => document.querySelector('[aria-label="待恢复消息"]'));
      const button = () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送');
      button().click(); await window.sendRecovery.until(() => document.body.innerText.includes('暂存消息重试失败'));
      await window.sendRecovery.delay(30); button().click(); await window.sendRecovery.delay(80);
      const result = { kept: !!document.querySelector('[aria-label="待恢复消息"]'), retries: f.retries.length, files: f.disk[0].draft.attachments.length };
      f.root.unmount(); return result;
    `)).toEqual({ kept: true, retries: 2, files: 1 })
  }, 30_000)

  test('When 失败草稿未改动而直接再次发送 Then 复用原ID不叠加另一条暂存记录', async () => {
    expect(await renderer.run<{ sameId: boolean; records: number }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1); const id = f.calls[0].userMessageUuid; f.reject();
      await window.sendRecovery.until(() => f.disk[0]?.status === 'failed'); await window.sendRecovery.delay(50);
      f.key(); await window.sendRecovery.until(() => f.calls.length === 2);
      const result = { sameId: f.calls[1].userMessageUuid === id, records: f.disk.length };
      f.reject(); await window.sendRecovery.delay(60); f.root.unmount(); return result;
    `)).toEqual({ sameId: true, records: 1 })
  }, 30_000)
})

describe('Given 已审查的重试时序边界', () => {
  for (const restoreVia of ['banner', 'toast']) {
    test(`When B 草稿追加失败 A 后通过 ${restoreVia} 恢复并重试 A Then 不清空 B`, async () => {
      const result = await renderer.run<{ preserved: boolean; retryCount: number }>(`
        const f = await window.sendRecovery.mount(); f.key();
        await window.sendRecovery.until(() => f.calls.length === 1);
        f.editor().commands.insertContent('新草稿B'); f.reject();
        await window.sendRecovery.until(() => document.body.innerText.includes('追加失败草稿'));
        await window.sendRecovery.delay(40);
        const label = ${JSON.stringify(restoreVia === 'banner' ? '追加到输入框' : '追加失败草稿')};
        Array.from(document.querySelectorAll('button')).find(button => button.textContent === label).click();
        await window.sendRecovery.delay(60);
        Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送').click();
        await window.sendRecovery.until(() => f.retries.length === 1 && !document.querySelector('[aria-label="待恢复消息"]'));
        const result = { preserved: f.editor().getText().includes('新草稿B'), retryCount: f.retries.length };
        f.root.unmount(); return result;
      `)
      expect(result).toEqual({ preserved: true, retryCount: 1 })
    }, 30_000)
  }

  test('When A 重试中切换 B 再返回 Then 不残留禁用状态也不覆盖 B 草稿', async () => {
    expect(await renderer.run<{ bEnabled: boolean; bDraft: string; aEnabled: boolean }>(`
      const first = await window.sendRecovery.mount(); first.key();
      await window.sendRecovery.until(() => first.calls.length === 1); first.reject();
      await window.sendRecovery.until(() => first.disk[0]?.status === 'failed');
      const disk = first.disk;
      const bEntry = structuredClone(disk[0]); bEntry.sessionId = 'b'; bEntry.id = 'b-message'; bEntry.input = { ...bEntry.input, sessionId: 'b', queueMessageId: 'b-message', userMessageUuid: 'b-message' }; disk.push(bEntry);
      first.root.unmount(); await window.sendRecovery.delay(30);
      const f = await window.sendRecovery.mount({ disk, waitRetry: true, initialText: '' });
      await window.sendRecovery.until(() => document.querySelector('[aria-label="待恢复消息"]'));
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送').click();
      await window.sendRecovery.until(() => f.retries.length === 1);
      await f.switchTo('b'); f.editor().commands.insertContent('B独立草稿');
      const bEnabled = !Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送').disabled;
      f.resolveRetry(); await window.sendRecovery.delay(80);
      const bDraft = f.editor().getText(); await f.switchTo('a');
      // A 已确认，手动保留另一条失败项验证 busy 状态不残留。
      disk.push({ ...structuredClone(bEntry), sessionId: 'a', id: 'a-other', input: { ...bEntry.input, sessionId: 'a', queueMessageId: 'a-other', userMessageUuid: 'a-other' } });
      await f.switchTo('b'); await f.switchTo('a');
      const aEnabled = !Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送').disabled;
      f.root.unmount(); return { bEnabled, bDraft, aEnabled };
    `)).toEqual({ bEnabled: true, bDraft: 'B独立草稿', aEnabled: true })
  }, 30_000)

  test('When 未改动的纯恢复草稿重试成功 Then 清除该副本防止再次发送', async () => {
    expect(await renderer.run<{ draft: string; records: number }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1); f.reject();
      await window.sendRecovery.until(() => f.disk[0]?.status === 'failed'); await window.sendRecovery.delay(60);
      Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重试发送').click();
      await window.sendRecovery.until(() => f.retries.length === 1 && !document.querySelector('[aria-label="待恢复消息"]'));
      const result = { draft: f.editor().getText(), records: f.disk.length };
      f.root.unmount(); return result;
    `)).toEqual({ draft: '', records: 0 })
  }, 30_000)

  test('When 渲染真实 AgentView Then 工具行位于输入外壳之外且发送仍可用', async () => {
    expect(await renderer.run<{ independent: boolean; calls: number }>(`
      const f = await window.sendRecovery.mount();
      const footer = document.querySelector('[data-input-mode="agent"] > .gamma-composer-footer');
      const independent = !!footer && !footer.closest('.gamma-composer');
      f.key(); await window.sendRecovery.until(() => f.calls.length === 1); f.reject();
      await window.sendRecovery.delay(60); f.root.unmount(); return { independent, calls: f.calls.length };
    `)).toEqual({ independent: true, calls: 1 })
  }, 30_000)
})

describe('Given 主进程稳定ID回执', () => {
  for (const action of ['compact', 'retry', 'retry_in_new_session']) {
    test(`When ${action} 在主进程收尾期排队 Then 使用统一入口且重复点击不重复执行，并撤销临时运行状态`, async () => {
      expect(await renderer.run<{ routes: string[]; calls: number; queued: number; running: boolean; compacting: boolean; live: number; created: number; stableId: boolean }>(`
        const api = window.sendRecovery, action = ${JSON.stringify(action)};
        const history = [
          { type: 'user', uuid: 'old-user', message: { content: [{ type: 'text', text: '需要继续的任务' }] }, parent_tool_use_id: null, _createdAt: 1 },
          { type: 'assistant', uuid: 'old-error', message: { content: [] }, error: { message: '上轮执行失败', errorType: 'unknown_error' }, _errorCode: 'unknown_error', _errorActions: [{ action, label: '执行恢复动作' }], parent_tool_use_id: null, _createdAt: 2 },
        ];
        const f = await api.mount({ history, initialText: '' });
        await api.until(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === '执行恢复动作'));
        const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '执行恢复动作');
        button.click(); button.click(); await api.until(() => f.calls.length === 1);
        const input = f.calls[0], target = input.sessionId; f.resolveWith({ disposition: 'queued' }); await api.delay(80);
        const state = f.streamState(target);
        const result = { routes: f.routes, calls: f.calls.length, queued: f.queue(target).length, running: state?.running ?? false,
          compacting: !!(state?.isCompacting || state?.compactInFlight), live: f.liveMessages(target).length, created: f.created.length,
          stableId: !!input.userMessageUuid && input.userMessageUuid === input.queueMessageId };
        f.root.unmount(); return result;
      `)).toEqual({ routes: ['submit'], calls: 1, queued: 1, running: false, compacting: false, live: 0, created: action === 'retry_in_new_session' ? 1 : 0, stableId: true })
    }, 30_000)
  }

  test('When 旧窗口重复提交已接收的恢复草稿 Then 回滚乐观消息和运行态但不恢复重复正文', async () => {
    expect(await renderer.run<{ sameId: boolean; draft: string; running: boolean; messages: number }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1); const id = f.calls[0].userMessageUuid; f.reject();
      await window.sendRecovery.until(() => f.disk[0]?.status === 'failed'); await window.sendRecovery.delay(60);
      f.key(); await window.sendRecovery.until(() => f.calls.length === 2);
      f.disk.splice(0); f.resolveDuplicate();
      await window.sendRecovery.until(() => document.body.innerText.includes('未重复发送'));
      const result = { sameId: f.calls[1].userMessageUuid === id, draft: f.editor().getText(), running: f.running(), messages: f.messages('a').length };
      f.root.unmount(); return result;
    `)).toEqual({ sameId: true, draft: '', running: false, messages: 0 })
  }, 30_000)
  test('When 恢复后添加新附件 Then 使用新ID，不能被旧消息接受证据吞掉', async () => {
    expect(await renderer.run<{ different: boolean; records: number }>(`
      const f = await window.sendRecovery.mount(); f.key();
      await window.sendRecovery.until(() => f.calls.length === 1); const id = f.calls[0].userMessageUuid; f.reject();
      await window.sendRecovery.until(() => f.disk[0]?.status === 'failed'); await window.sendRecovery.delay(60);
      f.addNewFile(); await window.sendRecovery.delay(30); f.key();
      await window.sendRecovery.until(() => f.calls.length === 2);
      const result = { different: f.calls[1].userMessageUuid !== id, records: f.disk.length };
      f.reject(); await window.sendRecovery.delay(60); f.root.unmount(); return result;
    `)).toEqual({ different: true, records: 2 })
  }, 30_000)
})
