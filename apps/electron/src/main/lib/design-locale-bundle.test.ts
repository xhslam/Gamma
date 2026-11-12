import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { buildDesignLocaleBootstrap, DESIGN_LOCALE_SKILLS, extractDesignSourceMessages, prepareDesignLocaleBundle } from './design-locale-bundle'
import { DESIGN_LOCALE_STORAGE_KEY, resolveDesignLocale } from './design-locale-policy'
import { DESIGN_ZH_MESSAGES } from './design-locale-zh'
import type { DesignSourceMessage } from './design-locale-bundle'

const messages = [
  { id: 'close', defaultMessage: 'Close' },
  { id: 'remove', defaultMessage: 'Remove {item}' },
  { id: 'fallback', defaultMessage: 'Untranslated UI sentinel' },
]
function boot(source: readonly DesignSourceMessage[], language: string, stored?: string) {
  const artwork = { textContent: 'Close', name: 'Export', value: 'Settings', contentDocument: { textContent: 'Save' } }
  const document = { documentElement: { lang: 'en' }, artwork }
  const values = new Map<string, string>(stored ? [[DESIGN_LOCALE_STORAGE_KEY, stored]] : [])
  const context = createContext({ document, navigator: { languages: [language], language }, sessionStorage: { getItem: (key: string) => values.get(key) ?? null } })
  runInContext(buildDesignLocaleBootstrap(source), context)
  return { context, document, artwork, state: runInContext('({locale:__gammaDesignLocale, words:__appifact_i18n})', context) as { locale: string; words: { lang: string; settled: Record<string, string> } } }
}
const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('Given 六类编辑器的原生消息协议', () => {
  test('When 首选系统语言是中文 Then 使用简体中文；英文及其他语言回退英文', () => {
    for (const language of ['zh-CN', 'zh-TW', 'zh_Hans', 'ZH-hant-HK', 'zh']) expect(resolveDesignLocale([language])).toBe('zh-CN')
    for (const languages of [['en-US', 'zh-CN'], ['ja-JP'], [], ['english']]) expect(resolveDesignLocale(languages)).toBe('en-US')
  })
  test('When 引导原生 formatter Then 仅替换显式消息，保留未翻译的英文、参数和作品内容', () => {
    const f = boot(messages, 'zh-CN')
    expect(f.state.locale).toBe('zh-CN')
    expect(f.state.words).toEqual({ lang: 'zh-CN', settled: { __gamma_locale_active__: '1', close: '关闭', remove: '移除 {item}' } })
    expect(f.document.documentElement.lang).toBe('zh-CN')
    expect(f.artwork).toEqual({ textContent: 'Close', name: 'Export', value: 'Settings', contentDocument: { textContent: 'Save' } })
    expect(buildDesignLocaleBootstrap(messages)).not.toContain('MutationObserver')
    expect(buildDesignLocaleBootstrap(messages)).not.toContain('querySelector')
  })
  test('When 英文系统 Then 原生消息保持英文；主进程存储的 OS 语言覆盖 Chromium 默认英文', () => {
    expect(boot(messages, 'en-US').state.words.settled).toEqual({ __gamma_locale_active__: '1' })
    expect(boot(messages, 'en-US', 'zh-CN').state.words.settled.close).toBe('关闭')
    expect(boot(messages, 'zh-CN', 'en-US').state.words.settled.close).toBeUndefined()
    expect(boot(messages, 'en-US', 'untrusted-value').state.locale).toBe('en-US')
  })
  test('When sessionStorage 不可用或消息含 HTML Then 不阻止首屏，不注入 HTML', () => {
    const context = createContext({ document: { documentElement: {} }, navigator: { language: 'zh-CN' }, sessionStorage: { getItem: () => { throw new Error('disabled') } } })
    const script = buildDesignLocaleBootstrap([{ id: 'html', defaultMessage: '</script><script>alert(1)</script>' }])
    expect(script).not.toContain('</script>')
    expect(() => runInContext(script, context)).not.toThrow()
  })
  test('When 提取 JSON 字符串描述符 Then 不执行代码，识别转义字符并排除冲突 ID', () => {
    expect(extractDesignSourceMessages('({defaultMessage:"Close",id:"a"});({defaultMessage:"Close",id:"a"});globalThis.sideEffect=true')).toEqual([{ id: 'a', defaultMessage: 'Close' }])
    expect(extractDesignSourceMessages('defaultMessage:"Line\\n\\\"two\\\"",id:"b"')[0]?.defaultMessage).toBe('Line\n"two"')
    const conflicting = extractDesignSourceMessages('defaultMessage:"Close",id:"a";defaultMessage:"Open",id:"a"')
    expect(conflicting).toHaveLength(2)
    expect(boot(conflicting, 'zh-CN').state.words.settled.a).toBeUndefined()
  })
  test('When 构建六类资源并重复执行 Then 在上游脚本前注入一次且不改上游脚本或作品文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-locale-')); temporary.push(root)
    const source = messages.map((message) => `({defaultMessage:${JSON.stringify(message.defaultMessage)},id:${JSON.stringify(message.id)}});`).join('\n')
    for (const skill of DESIGN_LOCALE_SKILLS) {
      const path = join(root, 'skills', skill, 'scripts', 'editor')
      await mkdir(join(path, 'assets'), { recursive: true })
      await writeFile(join(path, 'assets', 'index.js'), source)
      await writeFile(join(path, 'index.html'), '<html><head><script type="module" src="./assets/index.js"></script></head><body></body></html>')
      await writeFile(join(path, 'artwork.html'), '<h1>Close</h1>')
      await writeFile(join(path, 'share-ui.js'), 'var zh=/^zh\\b/i.test(navigator.language);globalThis.shareLabel=zh?"共享":"Share";')
    }
    const first = await prepareDesignLocaleBundle(root)
    expect(first).toHaveLength(6)
    expect(first[0]).toMatchObject({ total: 3, translated: 2, untranslated: ['Untranslated UI sentinel'] })
    expect(await prepareDesignLocaleBundle(root)).toEqual(first)
    for (const skill of DESIGN_LOCALE_SKILLS) {
      const path = join(root, 'skills', skill, 'scripts', 'editor')
      const html = await readFile(join(path, 'index.html'), 'utf8')
      expect(html.match(/data-gamma-design-locale/g)).toHaveLength(1)
      expect(html.indexOf('data-gamma-design-locale')).toBeLessThan(html.indexOf('type="module"'))
      expect(await readFile(join(path, 'assets', 'index.js'), 'utf8')).toBe(source)
      expect(await readFile(join(path, 'artwork.html'), 'utf8')).toBe('<h1>Close</h1>')
      expect(html).toContain('__appifact_i18n')
      expect(html).not.toContain('src="./gamma-design-locale.js"')
      const share = await readFile(join(path, 'share-ui.js'), 'utf8')
      expect(share).toContain('globalThis.__gammaDesignLocale||navigator.language')
      const { context } = boot(messages, 'en-US', 'zh-CN')
      runInContext(share, context)
      expect(context.shareLabel).toBe('共享')
    }
  })
})

// 仅在已准备固定上游快照时执行，不下载资源，也不写入真实资源。
const bundleParent = resolve(import.meta.dir, '../../../resources/design-bundle')
const revisions = await readdir(bundleParent).catch((): string[] => [])
const bundleRoot = revisions.find((name) => !name.startsWith('.'))
interface NativeExports { formatMessage(message: DesignSourceMessage, values?: Record<string, string | number>): unknown; createMessageFormatter?: unknown; [name: string]: unknown }
function nativeModule(source: string): string {
  const anchor = source.indexOf('"formatMessage",()=>')
  const start = [...source.slice(0, anchor).matchAll(/function \w+\(e\)\{/g)].at(-1)?.index
  const end = source.indexOf('}}function ', anchor)
  if (start === undefined || end < 0) throw new Error('固定上游快照语言模块结构变化')
  return source.slice(start, end + 2)
}
const nativeSources = new Map<string, string>()
if (bundleRoot) {
  for (const skill of DESIGN_LOCALE_SKILLS) {
    const editor = join(bundleParent, bundleRoot, 'skills', skill, 'scripts', 'editor')
    const assetFiles = await readdir(join(editor, 'assets')).catch((): string[] => [])
    const index = assetFiles.find((name) => /^index-.*\.js$/.test(name))
    const path = index ? join(editor, 'assets', index) : join(editor, 'artifact-type/app.js')
    nativeSources.set(skill, await readFile(path, 'utf8'))
  }
}

describe.skipIf(!bundleRoot)('Given 仓库实际固定快照的六类编辑器', () => {
  test('When 对六类真实主脚本与共享面板执行构建 Then 可离线幂等生成消息包并尊重 OS 语言', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-native-locale-')); temporary.push(root)
    for (const skill of DESIGN_LOCALE_SKILLS) {
      const sourceRoot = join(bundleParent, bundleRoot!, 'skills', skill, 'scripts', 'editor')
      const target = join(root, 'skills', skill, 'scripts', 'editor')
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'index.html'), await readFile(join(sourceRoot, 'index.html'), 'utf8'))
      await writeFile(join(target, 'share-ui.js'), await readFile(join(sourceRoot, 'share-ui.js'), 'utf8'))
      await writeFile(join(target, 'app.js'), nativeSources.get(skill)!)
    }
    const coverage = await prepareDesignLocaleBundle(root)
    expect(await prepareDesignLocaleBundle(root)).toEqual(coverage)
    for (const entry of coverage) {
      expect(entry.translated).toBeGreaterThan(500)
      const target = join(root, 'skills', entry.skill, 'scripts', 'editor')
      const html = await readFile(join(target, 'index.html'), 'utf8')
      const script = /<script data-gamma-design-locale>([\s\S]*?)<\/script>/.exec(html)?.[1]
      expect(script).toBeDefined()
      const { context } = boot([], 'en-US', 'zh-CN')
      runInContext(script!, context)
      expect((context.__appifact_i18n as { lang: string }).lang).toBe('zh-CN')
      const share = await readFile(join(target, 'share-ui.js'), 'utf8')
      expect(share).toContain('/^zh\\b/i.test(globalThis.__gammaDesignLocale||navigator.language)')
    }
  })
  for (const skill of DESIGN_LOCALE_SKILLS) {
    test(`When ${skill} 使用真实原生格式化模块 Then 显示中文并保持用户参数不变，英文系统仍为英文`, () => {
      const source = nativeSources.get(skill)!
      const actualMessages = extractDesignSourceMessages(source)
      expect(actualMessages.length).toBeGreaterThan(500)
      const remove = actualMessages.find((message) => message.defaultMessage === 'Remove {item}')!
      const close = actualMessages.find((message) => message.defaultMessage === 'Close')!
      expect(remove).toBeDefined(); expect(close).toBeDefined()
      for (const language of ['zh-CN', 'en-US']) {
        const { context } = boot(actualMessages, language)
        const register = (target: object, name: string, getter: () => unknown, setter?: (value: unknown) => void): void => { Object.defineProperty(target, name, { get: getter, set: setter, configurable: true }) }
        const dependencies: Record<string, unknown> = {
          toModuleNamespace: (value: unknown) => value,
          loadReact: () => ({}), loadReactNamespace: () => ({}),
          initializeOnce: (initialize: () => void) => { let initialized = false; return () => { if (!initialized) { initialized = true; initialize() } } },
          initializeI18nMessageFormat: () => {}, initializeI18nLocaleFallbacks: () => {},
          resolveSupportedIntlLocale: (_kind: string, locale: string) => locale,
        }
        Object.assign(context, { a: register, t: register, pj: {}, dependencies })
        // design 的格式化器拆在独立模块中，此处复用真实 slides ICU 格式化器，其他五类直接执行各自原生模块。
        if (skill === 'claude-design') {
          const slides: Record<string, unknown> = {}
          Object.assign(context, { slides })
          runInContext(`(${nativeModule(nativeSources.get('claude-slides')!)})(slides)()`, context)
          dependencies.createIntl = slides.createMessageFormatter
          const factory = slides.createMessageFormatter as (options: { locale: string; messages: Record<string, string> }) => unknown
          dependencies.defaultIntl = factory({ locale: 'en-US', messages: {} })
        }
        const native = runInContext(`(${nativeModule(source)})(dependencies)(); dependencies`, context) as NativeExports
        // 白板在 ReactI18n 的单独初始化模块调用 readPageLanguage。
        if (skill === 'claude-whiteboard') (native.readPageLanguage as () => void)()
        expect(native.formatMessage(close)).toBe(language === 'zh-CN' ? '关闭' : 'Close')
        expect(native.formatMessage(remove, { item: 'Export' })).toBe(language === 'zh-CN' ? '移除 Export' : 'Remove Export')
        for (const message of actualMessages) {
          if (message.defaultMessage.includes('{') || message.defaultMessage.includes('<')) continue
          const translated = DESIGN_ZH_MESSAGES[message.defaultMessage]
          if (translated !== undefined) expect(native.formatMessage(message), `${skill}: ${message.defaultMessage}`).toBe(language === 'zh-CN' ? translated : message.defaultMessage)
        }
        if (skill === 'claude-slides') {
          const parse = native.parseIcuMessage as (message: string) => unknown
          // 使用真实 AST，正则会把 plural 的 `=0 {Remove}` 误识别为名为 Remove 的参数。
          const names = (ast: unknown): string[] => {
            const found = new Set<string>()
            const visit = (node: unknown): void => {
              if (Array.isArray(node)) { node.forEach(visit); return }
              if (!node || typeof node !== 'object') return
              const value = node as Record<string, unknown>
              if (typeof value.type === 'number' && typeof value.value === 'string') {
                if (value.type >= 1 && value.type <= 6) found.add(`argument:${value.value}`)
                if (value.type === 8) found.add(`tag:${value.value}`)
              }
              Object.values(value).forEach(visit)
            }
            visit(ast)
            return [...found].sort()
          }
          for (const [original, translated] of Object.entries(DESIGN_ZH_MESSAGES)) {
            expect(() => parse(translated), translated).not.toThrow()
            expect(names(parse(translated)), original).toEqual(names(parse(original)))
          }
        }
      }
    })
  }
})
