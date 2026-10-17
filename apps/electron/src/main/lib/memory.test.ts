import { describe, expect, test, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sdk from '@earendil-works/pi-coding-agent'
import { createMemoryExtension } from './memory'
import { getMemoryDir, setConfigHomeForTest } from './config-paths'
import { PiAgentAdapter } from './adapters/pi-agent-adapter'

// 全局沙箱目录：确保整个测试文件生命周期内绝不接触 ~/.gamma/memory/
const globalTestSandbox = mkdtempSync(join(tmpdir(), 'gamma-memory-global-sandbox-'))
const prevConfigHome = setConfigHomeForTest(globalTestSandbox)

afterAll(() => {
  setConfigHomeForTest(prevConfigHome)
  rmSync(globalTestSandbox, { recursive: true, force: true })
})

function createSseFrame(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-memory-test',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

describe('长期记忆扩展 (createMemoryExtension)', () => {
  test('When 目录为空 Then memory_list 返回 (empty)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-unit-'))
    const memoryDir = join(root, 'memory')
    try {
      const ext = createMemoryExtension({ root: memoryDir })
      let listTool: any
      ext({
        registerTool(tool: any) {
          if (tool.name === 'memory_list') listTool = tool
        },
        on() {},
      } as any)

      expect(listTool).toBeDefined()
      const res = await listTool.execute('id', {}, undefined, undefined, {} as any)
      expect(res.content[0].text).toBe('(empty)')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 写入新记忆文件并读取 Then 正确保存并在更新时核对版本号', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-unit-'))
    const memoryDir = join(root, 'memory')
    try {
      const ext = createMemoryExtension({ root: memoryDir })
      const tools: Record<string, any> = {}
      ext({
        registerTool(tool: any) {
          tools[tool.name] = tool
        },
        on() {},
      } as any)

      // 1. 新建 profile.md
      const initialContent = '---\nname: 测试用户\ndescription: 用户档案\n---\n- [stated] 喜欢简洁回答\n'
      const writeRes = await tools.memory_write.execute('id', {
        path: 'profile.md',
        content: initialContent,
        if_version: 'new',
      })
      expect(writeRes.content[0].text).toContain('saved.')
      expect(existsSync(join(memoryDir, 'profile.md'))).toBe(true)

      // 2. 读取 profile.md
      const readRes = await tools.memory_read.execute('id', { path: 'profile.md' })
      expect(readRes.content[0].text).toContain(initialContent)
      const versionMatch = readRes.content[0].text.match(/\[version:\s*([a-f0-9]+)\]/)
      expect(versionMatch).not.toBeNull()
      const currentVer = versionMatch![1]

      // 3. 版本不匹配时应抛错
      await expect(
        tools.memory_write.execute('id', {
          path: 'profile.md',
          content: 'conflict',
          if_version: 'wrong_version',
        }),
      ).rejects.toThrow('version conflict')

      // 4. 追加记忆 memory_append
      const appendRes = await tools.memory_append.execute('id', {
        path: 'profile.md',
        content: '- [stated] 擅长 TypeScript',
        if_version: currentVer,
      })
      expect(appendRes.content[0].text).toContain('appended.')

      // 5. 替换记忆 memory_str_replace
      const readRes2 = await tools.memory_read.execute('id', { path: 'profile.md' })
      const ver2 = readRes2.content[0].text.match(/\[version:\s*([a-f0-9]+)\]/)![1]
      const replaceRes = await tools.memory_str_replace.execute('id', {
        path: 'profile.md',
        old_str: '- [stated] 擅长 TypeScript',
        new_str: '- [stated] 精通 TypeScript',
        if_version: ver2,
      })
      expect(replaceRes.content[0].text).toContain('edited.')

      const finalRead = await tools.memory_read.execute('id', { path: 'profile.md' })
      expect(finalRead.content[0].text).toContain('- [stated] 精通 TypeScript')

      // 6. 路径跨目录防御
      await expect(
        tools.memory_read.execute('id', { path: '../escape.md' }),
      ).rejects.toThrow('path must be a .md file inside the memory directory')

      await expect(
        tools.memory_read.execute('id', { path: 'not-md.txt' }),
      ).rejects.toThrow('path must be a .md file inside the memory directory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 检查工具注册 Then 五个工具全部注册', () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-reg-'))
    try {
      const ext = createMemoryExtension({ root })
      const registeredTools: string[] = []
      ext({
        registerTool(tool: any) {
          registeredTools.push(tool.name)
        },
        on() {},
      } as any)

      expect(registeredTools).toContain('memory_list')
      expect(registeredTools).toContain('memory_read')
      expect(registeredTools).toContain('memory_write')
      expect(registeredTools).toContain('memory_append')
      expect(registeredTools).toContain('memory_str_replace')
      expect(registeredTools.length).toBe(5)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 路径穿越 Then 抛出安全异常并拒绝访问', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-sec-'))
    try {
      const ext = createMemoryExtension({ root })
      const tools: Record<string, any> = {}
      ext({
        registerTool(tool: any) {
          tools[tool.name] = tool
        },
        on() {},
      } as any)

      await expect(
        tools.memory_read.execute('id', { path: '../../etc/passwd.md' }),
      ).rejects.toThrow('path must be a .md file inside the memory directory')

      await expect(
        tools.memory_write.execute('id', { path: '../escape.md', content: 'test', if_version: 'new' }),
      ).rejects.toThrow('path must be a .md file inside the memory directory')

      await expect(
        tools.memory_read.execute('id', { path: 'profile.txt' }),
      ).rejects.toThrow('path must be a .md file inside the memory directory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 版本冲突 Then 抛错并返回当前内容', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-conflict-'))
    try {
      const ext = createMemoryExtension({ root })
      const tools: Record<string, any> = {}
      ext({
        registerTool(tool: any) {
          tools[tool.name] = tool
        },
        on() {},
      } as any)

      const initialContent = '---\nname: 冲突测试\n---\n- [stated] 原始条目\n'
      await tools.memory_write.execute('id', {
        path: 'profile.md',
        content: initialContent,
        if_version: 'new',
      })

      // 携带错误版本号写入，预期抛错并附带当前最新文本
      let thrownError: Error | undefined
      try {
        await tools.memory_write.execute('id', {
          path: 'profile.md',
          content: '新修改',
          if_version: 'bad_version_token',
        })
      } catch (err: any) {
        thrownError = err
      }

      expect(thrownError).toBeDefined()
      expect(thrownError!.message).toContain('version conflict')
      expect(thrownError!.message).toContain('current version:')
      expect(thrownError!.message).toContain(initialContent)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When str_replace 匹配 0 次或多次 Then 明确抛错', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-replace-'))
    try {
      const ext = createMemoryExtension({ root })
      const tools: Record<string, any> = {}
      ext({
        registerTool(tool: any) {
          tools[tool.name] = tool
        },
        on() {},
      } as any)

      const content = '---\nname: 匹配测试\n---\n- [stated] 重复条目\n- [stated] 重复条目\n'
      await tools.memory_write.execute('id', {
        path: 'topics/notes.md',
        content,
        if_version: 'new',
      })

      const readRes = await tools.memory_read.execute('id', { path: 'topics/notes.md' })
      const currentVer = readRes.content[0].text.match(/\[version:\s*([a-f0-9]+)\]/)![1]

      // 匹配 0 次
      await expect(
        tools.memory_str_replace.execute('id', {
          path: 'topics/notes.md',
          old_str: '不存在的内容',
          new_str: '新内容',
          if_version: currentVer,
        }),
      ).rejects.toThrow('old_str must match exactly once, found 0')

      // 匹配 2 次
      await expect(
        tools.memory_str_replace.execute('id', {
          path: 'topics/notes.md',
          old_str: '- [stated] 重复条目',
          new_str: '- [stated] 单一条目',
          if_version: currentVer,
        }),
      ).rejects.toThrow('old_str must match exactly once, found 2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 并发同时向同一文件 append 两次 Then withFileMutationQueue 确保两行均成功写入无数据丢失', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-concurrent-'))
    try {
      const ext = createMemoryExtension({ root })
      const tools: Record<string, any> = {}
      ext({
        registerTool(tool: any) {
          tools[tool.name] = tool
        },
        on() {},
      } as any)

      const initialContent = '---\nname: 并发测试\n---\n'
      await tools.memory_write.execute('id', {
        path: 'profile.md',
        content: initialContent,
        if_version: 'new',
      })

      // 真正同时发起两次 append（并发 Promise.all），两笔均不带 if_version 进行盲追加
      const append1Promise = tools.memory_append.execute('id1', {
        path: 'profile.md',
        content: '- [stated] 条目1',
      })
      const append2Promise = tools.memory_append.execute('id2', {
        path: 'profile.md',
        content: '- [stated] 条目2',
      })

      await Promise.all([append1Promise, append2Promise])

      const finalRead = await tools.memory_read.execute('id', { path: 'profile.md' })
      expect(finalRead.content[0].text).toContain('- [stated] 条目1')
      expect(finalRead.content[0].text).toContain('- [stated] 条目2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 模拟压缩后 before_agent_start 再次返回记忆消息；未压缩时不重复返回', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-compact-'))
    try {
      const ext = createMemoryExtension({ root })
      let beforeAgentStartHandler: any
      let compactHandler: any
      ext({
        registerTool() {},
        on(event: string, handler: any) {
          if (event === 'before_agent_start') beforeAgentStartHandler = handler
          if (event === 'session_compact') compactHandler = handler
        },
      } as any)

      const activeEntries: any[] = []
      const fakeCtx: any = {
        sessionManager: {
          buildContextEntries: () => activeEntries,
        },
      }

      // 1. 首轮：未注入过，返回记忆消息（必须包含 customType === 'memory'）
      const res1 = await beforeAgentStartHandler({ messageType: 'user' }, fakeCtx)
      expect(res1).toBeDefined()
      expect(res1.message.customType).toBe('memory')

      // 模拟 Pi 会话将记忆消息加入上下文
      activeEntries.push({
        id: 'msg-memory-1',
        type: 'custom_message',
        customType: 'memory',
        content: res1.message.content,
      })

      // 2. 第二轮（未压缩）：上下文里已有 customType === 'memory'，不重复注入
      const res2 = await beforeAgentStartHandler({ messageType: 'user' }, fakeCtx)
      expect(res2).toBeUndefined()

      // 3. 模拟发生压缩：触发 session_compact，并且 buildContextEntries 丢弃了前面的旧记忆条目
      compactHandler?.()
      activeEntries.length = 0 // 压缩后活跃上下文丢失旧记忆

      // 4. 压缩后的下一轮：检测到活跃上下文中无记忆，按 customType === 'memory' 检查未通过，再次返回记忆消息
      const res3 = await beforeAgentStartHandler({ messageType: 'user' }, fakeCtx)
      expect(res3).toBeDefined()
      expect(res3.message.customType).toBe('memory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When memoryEnabled 默认为关闭 Then 只有显式传 true 才挂载长期记忆扩展', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-mount-'))
    let lastTools: string[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const bodyText = await req.text()
        const parsed = JSON.parse(bodyText)
        lastTools = (parsed.tools ?? []).map((t: any) => t.function?.name ?? t.name)
        return new Response(
          `${createSseFrame({ role: 'assistant', content: 'ok' }, null)}${createSseFrame({}, 'stop')}data: [DONE]\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      },
    })
    const adapter = new PiAgentAdapter()
    try {
      // 1. memoryEnabled 未传（默认应当为 false）
      for await (const _ of adapter.query({
        sessionId: 'test-session-disabled',
        prompt: '测试',
        model: 'gpt-4o-mini',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        cwd: root,
        piAgentDir: join(root, 'agent'),
        piSessionDir: join(root, 'sessions'),
        permissionMode: 'bypassPermissions',
        systemPrompt: '测试系统提示词',
      })) {}
      expect(lastTools).not.toContain('memory_list')
      expect(lastTools).not.toContain('memory_write')

      // 2. 显式传 memoryEnabled: true，确认挂载
      for await (const _ of adapter.query({
        sessionId: 'test-session-enabled',
        prompt: '测试',
        model: 'gpt-4o-mini',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        cwd: root,
        piAgentDir: join(root, 'agent'),
        piSessionDir: join(root, 'sessions'),
        permissionMode: 'bypassPermissions',
        systemPrompt: '测试系统提示词',
        memoryEnabled: true,
      })) {}
      expect(lastTools).toContain('memory_list')
      expect(lastTools).toContain('memory_write')
    } finally {
      adapter.dispose()
      await server.stop(true)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('When 指定 userId Then 记忆存储在按用户隔离的子目录', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'gamma-memory-sandbox-'))
    const prev = setConfigHomeForTest(sandbox)
    try {
      const dirA = getMemoryDir('user-alice')
      const dirB = getMemoryDir('user-bob')
      expect(dirA).not.toBe(dirB)
      expect(dirA).toContain('user-alice')
      expect(dirB).toContain('user-bob')
      expect(existsSync(dirA)).toBe(true)
      expect(existsSync(dirB)).toBe(true)
    } finally {
      setConfigHomeForTest(prev)
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

describe('长期记忆接入冒烟测试 (Smoke Test)', () => {
  test('When 发一句"我叫落花流水" Then memory/profile.md 被写入，新开 session 第一轮上下文包含该记忆', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-memory-smoke-'))
    const memoryRoot = join(root, 'memory')
    let requestIndex = 0
    const receivedRequests: Array<{ messages: any[] }> = []

    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const bodyText = await req.text()
        const parsed = JSON.parse(bodyText)
        receivedRequests.push(parsed)
        requestIndex++

        if (requestIndex === 1) {
          // Session 1 第一轮：模型决定使用 memory_write 记录用户身份
          const toolCallDelta = {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_mem_write_1',
              type: 'function',
              function: {
                name: 'memory_write',
                arguments: JSON.stringify({
                  path: 'profile.md',
                  content: '---\nname: 落花流水\ndescription: 用户姓名\n---\n- [stated] 用户叫落花流水\n',
                  if_version: 'new',
                }),
              },
            }],
          }
          return new Response(
            `${createSseFrame(toolCallDelta, null)}${createSseFrame({}, 'tool_calls')}data: [DONE]\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        } else if (requestIndex === 2) {
          // Session 1 第二轮：工具执行成功后的回答
          return new Response(
            `${createSseFrame({ role: 'assistant', content: '好的，我记住了，你叫落花流水。' }, null)}${createSseFrame({}, 'stop')}data: [DONE]\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        } else if (requestIndex === 3) {
          // Session 2 第一轮：模型接收上下文并回复
          return new Response(
            `${createSseFrame({ role: 'assistant', content: '你好落花流水，有什么可以帮你的？' }, null)}${createSseFrame({}, 'stop')}data: [DONE]\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        } else {
          // Session 3 第一轮：用户说"帮我翻译这句话"，模型直接翻译，不调用记忆工具
          return new Response(
            `${createSseFrame({ role: 'assistant', content: 'Sure, here is the translation.' }, null)}${createSseFrame({}, 'stop')}data: [DONE]\n\n`,
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        }
      },
    })

    const adapter = new PiAgentAdapter()
    try {
      // 步骤 1：发送"我叫落花流水"
      const session1Events: any[] = []
      for await (const event of adapter.query({
        sessionId: 'session-1-smoke',
        prompt: '我叫落花流水',
        model: 'gpt-4o-mini',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        cwd: root,
        piAgentDir: join(root, 'agent'),
        piSessionDir: join(root, 'sessions'),
        memoryRoot,
        memoryEnabled: true,
        permissionMode: 'bypassPermissions',
        systemPrompt: '测试系统提示词',
      })) {
        session1Events.push(event)
      }

      // 步骤 2：确认 memory/profile.md 被写入且内容正确
      const profilePath = join(memoryRoot, 'profile.md')
      expect(existsSync(profilePath)).toBe(true)
      const profileContent = readFileSync(profilePath, 'utf8')
      expect(profileContent).toContain('落花流水')
      expect(profileContent).toContain('用户叫落花流水')

      // 步骤 3：新开一个 session，确认第一轮上下文里带着这条记忆
      const session2Events: any[] = []
      for await (const event of adapter.query({
        sessionId: 'session-2-smoke',
        prompt: '请问你还记得我叫什么名字吗？',
        model: 'gpt-4o-mini',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        cwd: root,
        piAgentDir: join(root, 'agent'),
        piSessionDir: join(root, 'sessions'),
        memoryRoot,
        memoryEnabled: true,
        permissionMode: 'bypassPermissions',
        systemPrompt: '测试系统提示词',
      })) {
        session2Events.push(event)
      }

      // 确认 Session 2 发送给模型的请求包含注入的记忆
      expect(receivedRequests.length).toBeGreaterThanOrEqual(3)
      const session2Request = receivedRequests[2]
      expect(session2Request).toBeDefined()

      // 检查请求 messages 中包含 profile.md 及其内容
      const serializedSession2Messages = JSON.stringify(session2Request!.messages)
      expect(serializedSession2Messages).toContain('profile.md')
      expect(serializedSession2Messages).toContain('落花流水')
      expect(serializedSession2Messages).toContain('<memory_rules>')
      expect(serializedSession2Messages).toContain('<profile>')
      expect(serializedSession2Messages).toContain('<preferences>')
      expect(serializedSession2Messages).toContain('<reminder>')

      // 步骤 4：发"帮我翻译这句话"，确认没有产生写入
      const mtimeBefore = readFileSync(profilePath, 'utf8')
      for await (const _event of adapter.query({
        sessionId: 'session-3-smoke',
        prompt: '帮我翻译这句话',
        model: 'gpt-4o-mini',
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        cwd: root,
        piAgentDir: join(root, 'agent'),
        piSessionDir: join(root, 'sessions'),
        memoryRoot,
        memoryEnabled: true,
        permissionMode: 'bypassPermissions',
        systemPrompt: '测试系统提示词',
      })) {
        // 正常流式处理
      }
      const mtimeAfter = readFileSync(profilePath, 'utf8')
      expect(mtimeAfter).toBe(mtimeBefore)
    } finally {
      adapter.dispose()
      await server.stop(true)
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})
