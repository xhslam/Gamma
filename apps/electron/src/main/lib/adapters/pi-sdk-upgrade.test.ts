import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import { Type, validateToolCall, type ToolCall } from '@earendil-works/pi-ai'
import { createGammaManagedResourceLoaderOptions, createGammaProjectInstructionFilesOverride } from './pi-resource-loader-overrides'
import { getCodexCatalogModels } from './pi-model-registry'
import { CodexModelStore } from './pi-codex-model-store'
import { setConfigHomeForTest } from '../config-paths'
import { writeJsonFileAtomic } from '../safe-file'

describe('Pi 1.3 受管升级边界', () => {
  test('Given 项目及 agent 目录存在环境式资源 When 使用 Gamma loader Then 仅保留显式指令和内联扩展，不激活 MCP/Codemode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-pi-upgrade-'))
    const cwd = join(root, 'project')
    const agentDir = join(root, 'agent')
    let inlineLoaded = false
    try {
      for (const directory of [cwd, join(cwd, '.pi'), agentDir]) {
        mkdirSync(join(directory, 'extensions'), { recursive: true })
        mkdirSync(join(directory, 'skills', 'ambient'), { recursive: true })
        writeFileSync(join(directory, 'AGENTS.md'), 'UNAUTHORIZED_CONTEXT')
        writeFileSync(join(directory, 'APPEND_SYSTEM.md'), 'UNAUTHORIZED_APPEND')
        writeFileSync(join(directory, 'extensions', 'ambient.ts'), 'throw new Error("UNAUTHORIZED_EXTENSION")')
        writeFileSync(join(directory, 'skills', 'ambient', 'SKILL.md'), '---\nname: ambient\ndescription: unauthorized\n---\nambient')
      }
      mkdirSync(join(cwd, '.pi'), { recursive: true })
      writeJsonFileAtomic(join(cwd, '.pi', 'mcp.json'), { mcpServers: { unauthorized: { command: 'never-execute-me' } } })
      writeJsonFileAtomic(join(agentDir, 'mcp.json'), { mcpServers: { unauthorized: { command: 'never-execute-me' } } })
      const loader = new DefaultResourceLoader({
        cwd, agentDir, settingsManager: SettingsManager.inMemory(),
        ...createGammaManagedResourceLoaderOptions(),
        agentsFilesOverride: createGammaProjectInstructionFilesOverride([{ path: join(cwd, 'explicit.md'), content: 'AUTHORIZED_CONTEXT' }]),
        extensionFactories: [() => { inlineLoaded = true }],
      })
      await loader.reload()
      expect(inlineLoaded).toBe(true)
      expect(loader.getExtensions().errors).toEqual([])
      expect(loader.getExtensions().extensions).toHaveLength(1)
      expect(loader.getExtensions().extensions[0]?.tools.size).toBe(0)
      expect(loader.getSkills().skills).toEqual([])
      expect(loader.getAppendSystemPrompt()).toEqual([])
      expect(loader.getAgentsFiles().agentsFiles.map((file) => file.content)).toEqual(['AUTHORIZED_CONTEXT'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Given 缓存同时包含聊天和非聊天模型 When 查询 Codex 会话目录 Then 排除非聊天模型', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-pi-catalog-upgrade-'))
    const previous = setConfigHomeForTest(root)
    try {
      const base = {
        provider: 'openai-codex', api: 'openai-codex-responses' as const,
        baseUrl: 'https://example.invalid', reasoning: false, input: ['text' as const],
        contextWindow: 1000, maxTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }
      await new CodexModelStore().write('openai-codex', { models: [
        { ...base, id: 'upgrade-chat', name: 'Chat', type: 'chat' },
        { ...base, id: 'upgrade-classifier', name: 'Classifier', type: 'classifier' },
      ] })
      const models = await getCodexCatalogModels()
      expect(models.some((model) => model.id === 'upgrade-chat')).toBe(true)
      expect(models.some((model) => model.id === 'upgrade-classifier')).toBe(false)
    } finally {
      setConfigHomeForTest(previous)
      rmSync(root, { recursive: true, force: true })
    }
  })

  const tool = { name: 'fixture', description: '本地校验夹具', parameters: Type.Object({ path: Type.String() }) }
  test('Given 正常工具参数 When 新版校验 Then 保留完整参数', () => {
    expect(validateToolCall([tool], { type: 'toolCall', id: 'valid', name: 'fixture', arguments: { path: 'safe.txt' } })).toEqual({ path: 'safe.txt' })
  })
  test('Given 流末参数 JSON 损坏 When 新版校验 Then 拒绝执行已解析的部分参数', () => {
    const call: ToolCall = {
      type: 'toolCall', id: 'invalid', name: 'fixture', arguments: { path: 'safe.txt' },
      argumentsError: 'Malformed JSON: {"path":"safe.txt",',
    }
    expect(() => validateToolCall([tool], call)).toThrow()
  })
})
