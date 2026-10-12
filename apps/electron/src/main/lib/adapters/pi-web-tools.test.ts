import { describe, expect, mock, test } from 'bun:test'
import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { buildPiWebTools, type PiWebToolDependencies } from './pi-web-tools'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

const sdk = {
  defineTool: (definition: ToolDefinition) => definition,
} as unknown as PiSdk

function createDependencies(): PiWebToolDependencies {
  return {
    getEffectiveProxyUrl: mock(async () => undefined),
    searchWeb: mock(async (input) => ({
      query: input.query,
      searchedAt: '2026-10-09T04:00:00.000Z',
      provider: 'exa' as const,
      results: [{ title: '公开来源', url: 'https://example.com/source', snippet: '已检索的摘要' }],
      text: '搜索上下文',
      truncated: false,
    })),
    fetchWeb: mock(async (input) => ({
      url: input.url,
      title: '原文标题',
      content: '公开网页正文',
      contentType: 'text/html',
      truncated: false,
      route: 'direct' as const,
    })),
  }
}

function findTool(dependencies: PiWebToolDependencies, name: string): ToolDefinition {
  const tool = buildPiWebTools(sdk, dependencies).find((definition) => definition.name === name)
  if (!tool) throw new Error(`缺少工具 ${name}`)
  return tool
}

async function executeTool(tool: ToolDefinition, params: Record<string, unknown>, signal?: AbortSignal) {
  return tool.execute('web-call', params, signal, undefined, {} as ExtensionContext)
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>): string {
  return result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
}

describe('Pi 公开网络查询工具', () => {
  test('Given 服务可用 When 构建工具 Then 注册既有权限和渲染器识别的 WebSearch/WebFetch 名称', () => {
    const tools = buildPiWebTools(sdk, createDependencies())
    expect(tools.map((tool) => tool.name)).toEqual(['WebSearch', 'WebFetch'])
    expect(tools.every((tool) => tool.description.includes('不可信'))).toBe(true)
    expect(tools.every((tool) => tool.promptSnippet?.includes('Browser'))).toBe(true)
  })

  test('Given 省略数量参数 When 执行搜索 Then 传默认数量并返回可引用来源和检索时间', async () => {
    const dependencies = createDependencies()
    const result = await executeTool(findTool(dependencies, 'WebSearch'), { query: '  原始来源  ' })

    expect(dependencies.searchWeb).toHaveBeenCalledWith({ query: '原始来源', numResults: 5 }, { proxyUrl: undefined, signal: undefined })
    const text = resultText(result)
    expect(text).toContain('1. 公开来源\nhttps://example.com/source\n已检索的摘要')
    expect(text).toContain('2026-10-09T04:00:00.000Z')
    expect(text).toContain('不可信外部数据')
    expect(result.details).toMatchObject({ provider: 'exa', untrustedContent: true })
  })

  test('Given 用户在两次查询间切换代理 When 执行工具 Then 每次读取并传入实时代理配置', async () => {
    const dependencies = createDependencies()
    let proxyUrl: string | undefined = 'http://127.0.0.1:7897'
    dependencies.getEffectiveProxyUrl = mock(async () => proxyUrl)
    const search = findTool(dependencies, 'WebSearch')
    const fetch = findTool(dependencies, 'WebFetch')

    await executeTool(search, { query: '测试', numResults: 10 })
    proxyUrl = undefined
    await executeTool(fetch, { url: 'https://example.com' })

    expect(dependencies.getEffectiveProxyUrl).toHaveBeenCalledTimes(2)
    expect(dependencies.searchWeb).toHaveBeenCalledWith({ query: '测试', numResults: 10 }, { proxyUrl: 'http://127.0.0.1:7897', signal: undefined })
    expect(dependencies.fetchWeb).toHaveBeenCalledWith({ url: 'https://example.com', maxChars: 30000 }, { proxyUrl: undefined, signal: undefined })
  })

  test('Given 抓取发生重定向且正文截断 When 返回结果 Then 保留最终URL、真实路由和截断状态', async () => {
    const dependencies = createDependencies()
    dependencies.fetchWeb = mock(async () => ({
      url: 'https://example.com/final',
      title: '标题\n第二行',
      content: '截断后的正文',
      contentType: 'text/plain',
      truncated: true,
      route: 'proxy' as const,
    }))
    const result = await executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com/redirect', maxChars: 60000 })
    const text = resultText(result)

    expect(text).toContain('来源：https://example.com/final')
    expect(text).toContain('标题：标题 第二行')
    expect(text).toContain('请求路由：proxy')
    expect(text).toContain('正文截断：是')
    expect(text).toContain('截断后的正文')
    expect(result.details).toMatchObject({ url: 'https://example.com/final', route: 'proxy', truncated: true, untrustedContent: true })
  })

  test('Given 搜索没有可解析的来源条目 When 返回结果 Then 保留原始上下文且不生成虚构来源', async () => {
    const dependencies = createDependencies()
    dependencies.searchWeb = mock(async (input) => ({
      query: input.query,
      searchedAt: '2026-10-09T04:00:00.000Z',
      provider: 'exa' as const,
      results: [],
      text: '没有找到匹配结果',
      truncated: true,
    }))
    const text = resultText(await executeTool(findTool(dependencies, 'WebSearch'), { query: '罕见查询' }))
    expect(text).toContain('内容截断：是')
    expect(text).toContain('没有找到匹配结果')
    expect(text).not.toContain('https://example.com/source')
  })

  test('Given Exa 远端回退返回未截断正文 When 输出结果 Then 明示获取方式和实时性未知并保留来源', async () => {
    const dependencies = createDependencies()
    dependencies.fetchWeb = mock(async () => ({
      url: 'https://example.com/public-article',
      title: '公开文章',
      content: '远端取得的正文',
      contentType: 'text/plain',
      truncated: false,
      route: 'exa' as const,
    }))
    const result = await executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com/public-article' })
    const text = resultText(result)

    expect(text).toContain('来源：https://example.com/public-article')
    expect(text).toContain('Exa 远端正文提取')
    expect(text).toContain('缓存或索引，实时性未知')
    expect(text).toContain('不代表网页发布时间或内容更新时间')
    expect(text).toContain('不保证包含页面全部正文')
    expect(text).toContain('正文截断：否')
    expect(text).toContain('远端取得的正文')
    expect(result.details).toMatchObject({ route: 'exa', freshness: 'unknown', untrustedContent: true })
  })

  test('Given 直接请求和 Exa 回退均失败 When 返回错误 Then 保留失败信息并指向受管浏览器', async () => {
    const dependencies = createDependencies()
    dependencies.fetchWeb = mock(async () => { throw new Error('直连、代理与 Exa 远端提取均失败') })
    await expect(executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com' })).rejects.toThrow('直连、代理与 Exa 远端提取均失败')
    await expect(executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com' })).rejects.toThrow('BrowserNavigate')
  })

  test('Given 空白查询或超出数量边界 When 执行工具 Then 在发起网络请求前拒绝', async () => {
    const dependencies = createDependencies()
    const search = findTool(dependencies, 'WebSearch')
    const fetch = findTool(dependencies, 'WebFetch')

    await expect(executeTool(search, { query: '  ' })).rejects.toThrow('query')
    await expect(executeTool(search, { query: 'q'.repeat(2001) })).rejects.toThrow('query')
    for (const numResults of [0, 11, 1.5, Number.NaN]) {
      await expect(executeTool(search, { query: '有效查询', numResults })).rejects.toThrow('numResults')
    }
    for (const maxChars of [0, 60001, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(executeTool(fetch, { url: 'https://example.com', maxChars })).rejects.toThrow('maxChars')
    }
    expect(dependencies.getEffectiveProxyUrl).not.toHaveBeenCalled()
    expect(dependencies.searchWeb).not.toHaveBeenCalled()
    expect(dependencies.fetchWeb).not.toHaveBeenCalled()
  })

  test('Given 执行前已取消 When 执行任一网络工具 Then 不读取代理且不发起请求', async () => {
    const dependencies = createDependencies()
    const controller = new AbortController()
    controller.abort(new DOMException('用户已取消', 'AbortError'))

    await expect(executeTool(findTool(dependencies, 'WebSearch'), { query: '搜索' }, controller.signal)).rejects.toThrow('用户已取消')
    await expect(executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com' }, controller.signal)).rejects.toThrow('用户已取消')
    expect(dependencies.getEffectiveProxyUrl).not.toHaveBeenCalled()
    expect(dependencies.searchWeb).not.toHaveBeenCalled()
    expect(dependencies.fetchWeb).not.toHaveBeenCalled()
  })

  test('Given 读取代理配置期间取消 When 代理读取结束 Then 不进入网络服务', async () => {
    const dependencies = createDependencies()
    const controller = new AbortController()
    dependencies.getEffectiveProxyUrl = mock(async () => {
      controller.abort(new DOMException('代理读取时取消', 'AbortError'))
      return undefined
    })

    await expect(executeTool(findTool(dependencies, 'WebSearch'), { query: '搜索' }, controller.signal)).rejects.toThrow('代理读取时取消')
    expect(dependencies.searchWeb).not.toHaveBeenCalled()
  })

  test('Given 网络请求进行中 When 用户取消 Then 服务收到同一个signal且取消不变成浏览器回退错误', async () => {
    const dependencies = createDependencies()
    const controller = new AbortController()
    dependencies.fetchWeb = mock(async (_input, options) => {
      expect(options?.signal).toBe(controller.signal)
      controller.abort(new DOMException('请求已取消', 'AbortError'))
      throw controller.signal.reason
    })

    await expect(executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com' }, controller.signal)).rejects.toThrow('请求已取消')
  })

  test('Given 网络服务返回失败 When 工具报错 Then 保留原因并提供浏览器回退且不编造正文', async () => {
    const dependencies = createDependencies()
    dependencies.fetchWeb = mock(async () => { throw new Error('直连和代理均失败：ECONNRESET') })

    await expect(executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com' })).rejects.toThrow('直连和代理均失败：ECONNRESET')
    await expect(executeTool(findTool(dependencies, 'WebFetch'), { url: 'https://example.com' })).rejects.toThrow('BrowserNavigate')
  })

  test('Given 前台、定时任务和协作子会话 When 通过统一入口注册 Then 都能取得公开查询工具', async () => {
    // Electron 主进程模块需要替身；子进程隔离避免污染其他 Bun 测试的模块缓存。
    const builtinModule = new URL('./pi-builtin-tools.ts', import.meta.url).pathname
    const source = `
      import { mock } from 'bun:test';
      mock.module('electron', () => ({
        app: { isPackaged: false, getPath: () => '/tmp/gamma-web-tool-test' },
        BrowserWindow: class {}, WebContentsView: class {}, MessageChannelMain: class {},
        session: {}, utilityProcess: {}, safeStorage: {}, shell: {}, net: {}, dialog: {},
        nativeTheme: {}, ipcMain: {}, globalShortcut: {}, systemPreferences: {},
        screen: {}, clipboard: {}, nativeImage: {}, Notification: class {},
        powerMonitor: {}, powerSaveBlocker: {},
      }));
      const { buildPiBuiltinTools } = await import(${JSON.stringify(builtinModule)});
      const sdk = { defineTool: (definition) => definition };
      for (const triggeredBy of ['user', 'automation', 'delegation']) {
        const result = await buildPiBuiltinTools(sdk, {
          sessionId: 'web-test-' + triggeredBy, channelId: 'channel', triggeredBy,
          productivityTools: { todosEnabled: false, calendarEnabled: false, obsidianEnabled: false },
        });
        const names = result.tools.map((tool) => tool.name);
        if (!names.includes('WebSearch') || !names.includes('WebFetch')) {
          throw new Error(triggeredBy + ' 缺少网络查询工具');
        }
      }
      console.log('公开查询注册完成');
    `
    const subprocess = Bun.spawn([process.execPath, '-e', source], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toContain('公开查询注册完成')
  })
})
