import { describe, expect, test } from 'bun:test'
import type { CallbackResponse, OnBeforeRequestListenerDetails, Session } from 'electron'
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesignBrowserPolicy, parseDesignEditorScope, shouldBlockDesignBrowserRequest } from './design-browser-policy'

const EDITOR = 'http://127.0.0.1:43210/design/artifact-token/'
const scope = parseDesignEditorScope(EDITOR)
const blocked = (url: string, method = 'POST') => shouldBlockDesignBrowserRequest({ url, method }, [scope])

describe('design 页面分享权限边界', () => {
  test('Given 已登记的六类编辑器 When 修改嵌套 __share Then 阻止页面自行更改 LAN/链接/角色权限', () => {
    for (const kind of ['slides', 'design', 'design-system', 'dashboard', 'motion', 'whiteboard']) {
      const url = `http://127.0.0.1:43210/${kind}/artifact-token/`
      const policy = createDesignBrowserPolicy()
      policy.registerDesignEditorOrigin(url)
      for (const method of ['POST', 'post', 'PUT', 'PATCH', 'DELETE']) {
        expect(policy.isBlockedDesignEditorRequest({ url: `${url}__share`, method })).toBe(true)
        expect(policy.isBlockedDesignEditorRequest({ url: `${url}__share?action=lan&on=true`, method })).toBe(true)
      }
    }
  })
  test('Given hub 支持按 Referer 转交根路由 When 请求根 __share 或 __hub mount Then 不依赖可省略的 Referer/正文而拒绝写入', () => {
    expect(blocked('http://127.0.0.1:43210/__share')).toBe(true)
    expect(blocked('http://127.0.0.1:43210/__share?anything=1')).toBe(true)
    expect(blocked('http://127.0.0.1:43210/__hub')).toBe(true)
    expect(blocked('http://127.0.0.1:43210/__hub?lan=true')).toBe(true)
  })
  test('Given GET/HEAD/OPTIONS 只读请求 When 读取分享状态、UI、邀请或 hub 信息 Then 保持可用', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      for (const url of [`${EDITOR}__share`, `${EDITOR}__share/boot.js`, `${EDITOR}__share/ui.js`, `${EDITOR}__share/invite`, 'http://127.0.0.1:43210/__share', 'http://127.0.0.1:43210/__hub']) {
        expect(blocked(url, method)).toBe(false)
      }
    }
  })
  test('Given 本地 archive/save 与作品编辑请求 When 导出、保存、评论、历史、上传 Then 不按 __share 前缀一刀切阻断', () => {
    for (const route of ['__share/archive', '__share/save', '__comments', '__comments/reply', '__comments/resolve', '__deck/save', '__deck/history', '_api/db', '_api/upload', 'project/canvas.json']) {
      expect(blocked(`${EDITOR}${route}`)).toBe(false)
    }
    expect(blocked('http://127.0.0.1:43210/__share/archive')).toBe(false)
    expect(blocked('http://127.0.0.1:43210/__share/save')).toBe(false)
  })
  test('Given 相似 origin/作品前缀 When 请求不属于登记作品的精确路由 Then 不误伤普通受管浏览器', () => {
    for (const url of [
      'https://127.0.0.1:43210/design/artifact-token/__share',
      'http://127.0.0.1:43211/design/artifact-token/__share',
      'http://127.0.0.1.evil.example:43210/design/artifact-token/__share',
      'http://127.0.0.1:43210@evil.example/design/artifact-token/__share',
      'http://example.com:43210/design/artifact-token/__share',
      'http://127.0.0.1:43210/design/artifact-token-extra/__share',
      'http://127.0.0.1:43210/design/artifact-token__share',
      'http://127.0.0.1:43210/design/another-token/__share',
      `${EDITOR}__share-save`, `${EDITOR}files/__share`, `${EDITOR}__share/save?route=__share`,
      'http://127.0.0.1:43210/__hub-other', `${EDITOR}?action=lan`, 'not a URL',
    ]) expect(blocked(url)).toBe(false)
    expect(shouldBlockDesignBrowserRequest({ url: `${EDITOR}__share`, method: 'POST' }, [])).toBe(false)
  })
  test('Given URL 标准归一化 When 路径点段回到真实分享路由 Then 不能通过字符串匹配差异绕过', () => {
    expect(blocked(`${EDITOR}files/../__share`)).toBe(true)
    expect(blocked(`${EDITOR}files/%2e%2e/__share`)).toBe(true)
    expect(blocked('http://2130706433:43210/design/artifact-token/__share')).toBe(true)
  })
  test('Given 主进程注册入口 When 输入非 loopback/非作品根/凭据或含 query 的地址 Then 拒绝登记且不扩大范围', () => {
    for (const url of ['https://127.0.0.1:43210/design/id/', 'http://example.com:43210/design/id/', 'http://127.0.0.1/design/id/', 'http://user:pass@127.0.0.1:43210/design/id/', 'http://127.0.0.1:43210/', 'http://127.0.0.1:43210/design/id', `${EDITOR}?mode=share`, `${EDITOR}#share`, `${EDITOR}nested/`, 'invalid']) {
      expect(() => parseDesignEditorScope(url)).toThrow()
    }
  })
  test('Given 重复打开或多个作品共用 origin When 单个注册释放 Then 其他注册仍受保护且 disposer 幂等', () => {
    const policy = createDesignBrowserPolicy()
    const first = policy.registerDesignEditorOrigin(EDITOR)
    const second = policy.registerDesignEditorOrigin(EDITOR)
    const otherUrl = 'http://127.0.0.1:43210/design/another-token/'
    const third = policy.registerDesignEditorOrigin(otherUrl)
    first(); first()
    expect(policy.isBlockedDesignEditorRequest({ url: `${EDITOR}__share`, method: 'POST' })).toBe(true)
    second()
    expect(policy.isBlockedDesignEditorRequest({ url: `${EDITOR}__share`, method: 'POST' })).toBe(false)
    expect(policy.isBlockedDesignEditorRequest({ url: `${otherUrl}__share`, method: 'POST' })).toBe(true)
    expect(policy.isBlockedDesignEditorRequest({ url: 'http://127.0.0.1:43210/__hub', method: 'POST' })).toBe(true)
    third()
    expect(policy.isBlockedDesignEditorRequest({ url: 'http://127.0.0.1:43210/__hub', method: 'POST' })).toBe(false)
  })
})

test('Given BrowserController 现有 session guard When 注册 design 并请求分享 Then 原有唯一 listener 内拒绝，且普通请求继续原有校验', async () => {
  // 隔离 bundle 而非修改全局 electron mock，避免破坏同进程内的其他测试。
  const bundle = await build({
    stdin: { contents: 'export { BrowserController } from "./browser-controller"; export { registerDesignEditorOrigin } from "./design-browser-policy";', resolveDir: import.meta.dir, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'isolated-browser-guard', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'design-test-electron' }))
      builder.onLoad({ filter: /.*/, namespace: 'design-test-electron' }, () => ({ contents: 'export class BrowserWindow {}; export class WebContentsView {}; export const app = {}; export const session = {}; export const net = {};', loader: 'js' }))
      builder.onLoad({ filter: /[/\\]settings-service\.ts$/ }, () => ({ contents: 'export const getSettings = () => ({})', loader: 'js' }))
    } }],
  })
  interface GuardController { installSessionGuards(session: Session): void }
  const temporary = await mkdtemp(join(tmpdir(), 'gamma-design-browser-policy-'))
  const modulePath = join(temporary, 'browser-guard.mjs')
  let integration: { BrowserController: new () => GuardController; registerDesignEditorOrigin(url: string): () => void }
  try {
    await writeFile(modulePath, bundle.outputFiles[0]!.text)
    integration = await import(modulePath) as typeof integration
  } finally { await rm(temporary, { recursive: true, force: true }) }
  const { BrowserController, registerDesignEditorOrigin } = integration
  let installed = 0
  let handler: ((details: OnBeforeRequestListenerDetails, callback: (response: CallbackResponse) => void) => void) | undefined
  const session = {
    setPermissionRequestHandler: () => {},
    setCertificateVerifyProc: () => {},
    webRequest: { onBeforeRequest: (listener: typeof handler) => { installed++; handler = listener } },
  } as unknown as Session
  const controller = new BrowserController()
  controller.installSessionGuards(session)
  controller.installSessionGuards(session)
  expect(installed).toBe(1)
  const dispose = registerDesignEditorOrigin(EDITOR)
  const request = (url: string, method: string): Promise<CallbackResponse> => new Promise((resolve) => handler!({ url, method } as OnBeforeRequestListenerDetails, resolve))
  try {
    expect(await request(`${EDITOR}__share`, 'POST')).toEqual({ cancel: true })
    expect(await request('http://127.0.0.1:43210/__hub', 'POST')).toEqual({ cancel: true })
    expect(await request(`${EDITOR}__share/archive`, 'POST')).toEqual({ cancel: false })
    expect(await request(`${EDITOR}__share/save`, 'POST')).toEqual({ cancel: false })
    expect(await request(`${EDITOR}__comments`, 'POST')).toEqual({ cancel: false })
    expect(await request(`${EDITOR}__share`, 'GET')).toEqual({ cancel: false })
    expect(await request('https://example.com/__share', 'POST')).toEqual({ cancel: false })
    expect(await request('not-a-url', 'POST')).toEqual({ cancel: true })
  } finally { dispose() }
  expect(await request(`${EDITOR}__share`, 'POST')).toEqual({ cancel: false })
})
