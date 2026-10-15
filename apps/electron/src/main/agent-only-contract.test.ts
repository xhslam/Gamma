import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 架构边界测试只检查源码，不启动 Electron、不读取用户配置或调用模型。
const source = (path: string): string => readFileSync(resolve(import.meta.dir, path), 'utf-8')

describe('Agent-only 主进程和 preload 契约', () => {
  test('Given 注册入口 When 检查主进程与 preload Then 不含 Chat CRUD、流订阅、模板工具或迁移接口', () => {
    for (const path of ['ipc.ts', '../preload/index.ts']) {
      const text = source(path)
      expect(text).not.toMatch(/\b(?:CHAT_IPC_CHANNELS|CHAT_TOOL_IPC_CHANNELS|SYSTEM_PROMPT_IPC_CHANNELS)\b/)
      expect(text).not.toMatch(/\b(?:listConversations|createConversation|migrateChatToAgent|extractAttachmentText|onStreamChunk)\b/)
      expect(text).toContain('AGENT_IPC_CHANNELS.STREAM_EVENT')
      expect(text).toContain('AUTOMATIC_MEMORY_IPC_CHANNELS')
      expect(text).toContain('WECHAT_IPC_CHANNELS')
      expect(text).toContain('CODEX_OAUTH_LOGIN')
      for (const channel of ['SAVE_ATTACHMENT', 'READ_ATTACHMENT', 'DELETE_ATTACHMENT', 'OPEN_FILE_DIALOG', 'OPEN_FILE_OR_FOLDER_DIALOG', 'SAVE_IMAGE_AS', 'SAVE_RESOURCE_FILE_AS']) {
        expect(text).toContain(`ATTACHMENT_IPC_CHANNELS.${channel}`)
      }
    }
  })

  test('Given 启动、退出和托盘 When 检查生命周期 Then 不启动 Chat watcher、不归档历史 Chat且只能新建 Agent', () => {
    expect(source('ipc.ts')).not.toContain('autoArchiveConversations')
    expect(source('ipc.ts')).toContain('autoArchiveAgentSessions(days)')
    expect(source('application.ts')).not.toMatch(/startChatToolsWatcher|stopChatToolsWatcher|stopAllGenerations|createChatSession/)
    expect(source('application.ts')).toContain('stopAllAgents()')
    expect(source('tray.ts')).not.toContain('createChatSession')
    expect(source('tray.ts')).toContain('createAgentSession()')
    expect(source('ipc.ts')).not.toContain('mode: input.mode')
    expect(source('application.ts')).not.toMatch(/mode: ['"](?:chat|agent)['"]/)
  })

  test('Given 已退役服务 When 检查工程文件和存储统计 Then 专属服务不存在且不扫描或创建历史 Chat 目录', () => {
    for (const path of ['chat-service.ts', 'conversation-manager.ts', 'document-parser.ts', 'system-prompt-manager.ts', 'chat-tool-config.ts', 'chat-tool-registry.ts', 'chat-tool-executor.ts', 'chat-tools-watcher.ts', 'chat-tools']) {
      expect(existsSync(resolve(import.meta.dir, 'lib', path))).toBe(false)
    }
    expect(source('lib/storage-service.ts')).not.toContain('getConversationsDir')
    expect(source('lib/config-paths.ts')).not.toMatch(/getConversationsDir|getConversationsIndexPath|getConversationMessagesPath|getSystemPromptsPath|getChatToolsConfigPath/)
    expect(source('lib/config-paths.ts')).toContain("join(getConfigDir(), 'attachments')")
  })
})
