import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DESIGN_ZH_MESSAGES } from './design-locale-zh'
import { DESIGN_LOCALE_STORAGE_KEY } from './design-locale-policy'
export const DESIGN_LOCALE_SKILLS = ['claude-slides', 'claude-design', 'claude-design-system', 'claude-dashboard', 'claude-motion', 'claude-whiteboard'] as const
const SCRIPT_NAME = 'gamma-design-locale.js'
const SCRIPT_BLOCK = /<script data-gamma-design-locale>[\s\S]*?<\/script>\s*/g

export interface DesignSourceMessage { id: string; defaultMessage: string }
export interface DesignLocaleCoverage { skill: string; total: number; translated: number; untranslated: string[] }

/** 固定上游快照的编译输出使用 JSON 字符串消息。只读取 descriptor，绝不执行上游脚本。 */
export function extractDesignSourceMessages(source: string): DesignSourceMessage[] {
  const messages = new Map<string, DesignSourceMessage>()
  for (const match of source.matchAll(/defaultMessage:("(?:[^"\\]|\\.)*"),id:("(?:[^"\\]|\\.)*")/g)) {
    const defaultMessage: unknown = JSON.parse(match[1]!)
    const id: unknown = JSON.parse(match[2]!)
    if (typeof id !== 'string' || typeof defaultMessage !== 'string') continue
    // 同一快照包含嵌入运行时的旧文案，少数 ID 对应多个默认消息；保留候选，由构建器排除歧义。
    messages.set(`${id}\u0000${defaultMessage}`, { id, defaultMessage })
  }
  return [...messages.values()]
}

/** 生成同步首屏脚本，在任何上游 module 执行前安装原生消息包。没有 DOM 文字替换，也不读取子 frame。 */
export function buildDesignChineseMessages(messages: readonly DesignSourceMessage[]): Record<string, string> {
  const candidates = new Map<string, Set<string | undefined>>()
  for (const message of messages) {
    const values = candidates.get(message.id) ?? new Set<string | undefined>()
    values.add(Object.hasOwn(DESIGN_ZH_MESSAGES, message.defaultMessage) ? DESIGN_ZH_MESSAGES[message.defaultMessage] : undefined)
    candidates.set(message.id, values)
  }
  return Object.fromEntries([...candidates].flatMap(([id, values]) => {
    const translated = [...values][0]
    return values.size === 1 && translated !== undefined ? [[id, translated]] : []
  }))
}

export function buildDesignLocaleBootstrap(messages: readonly DesignSourceMessage[]): string {
  // 原生入口拒绝空词典。哨兵只用于激活语言；英文和未覆盖项始终用各自 descriptor 的 defaultMessage。
  const english = { '__gamma_locale_active__': '1' }
  const chinese = buildDesignChineseMessages(messages)
  const serialize = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  return `/* Gamma: only explicit upstream UI messages, never artwork text. */
(()=>{
  const english=${serialize(english)},chinese=${serialize(chinese)};
  let stored;try{stored=sessionStorage.getItem(${serialize(DESIGN_LOCALE_STORAGE_KEY)})}catch{}
  const requested=stored==='zh-CN'||stored==='en-US'?stored:(navigator.languages?.[0]||navigator.language||'en-US');
  const lang=/^zh(?:-|_|$)/i.test(requested)?'zh-CN':'en-US';
  globalThis.__gammaDesignLocale=lang;
  globalThis.__appifact_i18n={lang,settled:lang==='zh-CN'?{...english,...chinese}:english};
  document.documentElement.lang=lang;
})();\n`
}

async function collectEditorMessages(root: string): Promise<DesignSourceMessage[]> {
  const sources: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('design 语言构建不允许符号链接')
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== SCRIPT_NAME) sources.push(await readFile(path, 'utf8'))
    }
  }
  await visit(root)
  return extractDesignSourceMessages(sources.join('\n'))
}

/** 只对仓库构建产物调用，不调用用户缓存或 workspace 私有资源。重跑会刷新词典，无需重新下载上游。 */
export async function prepareDesignLocaleBundle(bundleRoot: string): Promise<DesignLocaleCoverage[]> {
  const coverage: DesignLocaleCoverage[] = []
  for (const skill of DESIGN_LOCALE_SKILLS) {
    const editor = join(bundleRoot, 'skills', skill, 'scripts', 'editor')
    const messages = await collectEditorMessages(editor)
    const chinese = buildDesignChineseMessages(messages)
    const untranslated = messages.filter((message) => !Object.hasOwn(chinese, message.id)).map((message) => message.defaultMessage)
    const indexPath = join(editor, 'index.html')
    let html = await readFile(indexPath, 'utf8')
    if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error(`design 编辑器缺少 head：${skill}`)
    // 上游服务器只白名单开放 assets/ 或 artifact-type/，不假定新增根目录 JS 可被访问。
    // 六类原版 HTML 均已有内联启动脚本；沿用该路径，同步安装消息包并允许重复构建刷新词典。
    html = html.replace(SCRIPT_BLOCK, '').replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n<script data-gamma-design-locale>${buildDesignLocaleBootstrap(messages)}</script>\n`)
    // 均为非 JSON 的构建期文件；不改 artifact 数据、主程序 JS 或许可文本。
    // 上游共享/历史面板自带中英词典，但它只看 Chromium 默认语言；统一改用主进程选定的语言。
    const sharePath = join(editor, 'share-ui.js')
    let share: string | undefined
    try { share = await readFile(sharePath, 'utf8') } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    if (share !== undefined) {
      const detector = '/^zh\\b/i.test(navigator.language)'
      const localizedDetector = '/^zh\\b/i.test(globalThis.__gammaDesignLocale||navigator.language)'
      if (!share.includes(detector) && !share.includes(localizedDetector)) throw new Error(`design 共享面板语言入口已变化：${skill}`)
      await writeFile(sharePath, share.replace(detector, localizedDetector))
    }
    await writeFile(indexPath, html)
    coverage.push({ skill, total: messages.length, translated: messages.length - untranslated.length, untranslated })
  }
  return coverage
}
