import type { MemoryCatalogFile } from './memory-catalog'
import { memoryTerms, normalizeMemoryText } from './memory-catalog'
import { RULES } from './memory'

const PERSONAL = /我的|我们的|上次|之前|继续|还记得|你有没有|我(?:喜欢|偏爱|正在|的)|帮我(?:排|安排|规划|选)|给(?:我|同事)|下周.*复习|截止日期/
const GENERAL = /^(?:请)?(?:翻译|帮我翻译|解释|介绍|推荐个|推荐一个)|(?:python|javascript|typescript|java|c\+\+).*(?:怎么|如何|是什么|语法|反转)/i
const STOP = new Set(['我的', '我们', '们的', '上次', '之前', '继续', '还记', '记得', '帮我', '什么', '怎么', '这个', '那个', '一下', '用户', '内容', '项目', '任务', '读取', '主题', '文件', '相关', '信息', '时读', '安排', '计划'])
export function isAlwaysInjectedMemory(file: MemoryCatalogFile): boolean {
  return /:\/(?:profile|preferences)\.md$/.test(file.path) || file.alwaysInject === 'profile' || file.alwaysInject === 'preferences'
}
/** 只在个人意图或明确别名下推荐读取，不把正文相似度当作预读授权。 */
export function selectMemoryCandidates(query: string, files: MemoryCatalogFile[], injectedPaths?: ReadonlySet<string>): MemoryCatalogFile[] {
  const text = normalizeMemoryText(query)
  const personal = PERSONAL.test(text)
  if (GENERAL.test(text) && !personal) return []
  const terms = memoryTerms(text).filter(term => !STOP.has(term))
  const ranked: Array<{ file: MemoryCatalogFile; score: number }> = []
  for (const file of files) {
    if (injectedPaths ? injectedPaths.has(file.path) : isAlwaysInjectedMemory(file)) continue
    const names = [...file.aliases, file.name.replace(/\.md$/, '')].map(normalizeMemoryText).filter(name => name.length > 1)
    const aliasMatch = names.some(name => text.includes(name))
    if (!personal && !aliasMatch) continue
    if (file.sensitive && !personal) continue
    const metadata = normalizeMemoryText(`${file.name} ${file.description} ${file.aliases.join(' ')}`)
    const hits = terms.filter(term => metadata.includes(term))
    const score = (aliasMatch ? 20 : 0) + hits.length
    // 两个字的偶然交集不足以要求读取；别名命中或两个不同词证据才进入兜底。
    if (aliasMatch || hits.length >= 2) ranked.push({ file, score })
  }
  return ranked.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path)).slice(0, 20).map(item => item.file)
}

export function buildMemoryRetrievalRules(): string {
  return RULES
}
