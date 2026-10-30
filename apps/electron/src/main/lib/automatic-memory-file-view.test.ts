import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutomaticMemoryStore } from './automatic-memory-store'
import { createAutomaticMemoryFileView } from './automatic-memory-file-view'
import { MemoryCatalog } from './memory-catalog'
import { createMemoryExtension } from './memory'
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent'

describe('自动记录的只读文件视图', () => {
  let root: string
  let store: AutomaticMemoryStore
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gamma-memory-view-')); mkdirSync(join(root, 'w')); store = new AutomaticMemoryStore({ resolveWorkspaceRoot: () => join(root, 'w') }); store.updateSettings('w', { enabled: true }) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const add = (sensitive = false): void => {
    const content = sensitive ? '我有医疗病史' : '我使用 Bun'
    store.applyCandidates('w', [{ category: sensitive ? 'areas' : 'profile', title: sensitive ? '健康' : '工具偏好', key: 'one', content, evidence: content, sensitive }], { kind: 'agent', sessionId: 's', messageId: String(sensitive), createdAt: 1 }, content, store.captureRevision('w'))
  }
  it('Given 已记录 When 列目录与读取 Then 不复制权威数据且虚拟文件只读', async () => {
    add()
    const memoryRoot = join(root, 'w', 'memory')
    const catalog = new MemoryCatalog({ roots: [{ scope: 'workspace', root: memoryRoot }], virtualFiles: createAutomaticMemoryFileView(memoryRoot, 'w') })
    const files = await catalog.scan()
    expect(files).toHaveLength(1)
    expect(files[0]?.readOnly).toBe(true)
    const path = files[0]!.path
    expect((await catalog.read(path)).files[0]?.content).toContain('我使用 Bun')
    const tools = new Map<string, ToolDefinition>()
    createMemoryExtension({ root: join(root, 'global'), workspaceRoot: memoryRoot, virtualFiles: createAutomaticMemoryFileView(memoryRoot, 'w') })({ registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool), on() {} } as unknown as ExtensionAPI)
    await expect(tools.get('memory_write')!.execute('write', { path, content: '试图绕过管理器', if_version: files[0]!.version }, undefined, undefined, {} as ExtensionToolContext)).rejects.toThrow('只读')
    expect(readdirSync(memoryRoot).filter(name => name.endsWith('.md'))).toHaveLength(0)
  })
  it('Given 人工编辑再删除 When 更新视图 Then 看到修订且删除不回流', async () => {
    add(); const entry = store.getSnapshot('w').entries[0]!
    const view = createAutomaticMemoryFileView(join(root, 'w', 'memory'), 'w')
    store.editEntry('w', entry.id, '使用 Deno', store.captureRevision('w'))
    expect((await view())[0]?.content).toContain('使用 Deno')
    store.deleteEntry('w', entry.id, store.captureRevision('w'))
    expect(await view()).toEqual([])
    add(); expect(await view()).toEqual([])
  })
  it('Given 敏感开关或记录开关变化 When 更新视图 Then 继续遵守权威过滤', async () => {
    store.updateSettings('w', { includeSensitive: true }); add(true)
    const view = createAutomaticMemoryFileView(join(root, 'w', 'memory'), 'w')
    expect(await view()).toHaveLength(1)
    store.updateSettings('w', { includeSensitive: false }); expect(await view()).toEqual([])
    add(); store.updateSettings('w', { enabled: false }); expect(await view()).toEqual([])
  })
})
