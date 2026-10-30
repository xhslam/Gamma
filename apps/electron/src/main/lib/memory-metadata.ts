/** 只解释目录需要的 frontmatter；未知字段与正文始终原样保留。 */
export interface MemoryMetadata {
  name: string
  description: string
  sources: string[]
  aliases: string[]
}
export interface ParsedMemoryDocument { metadata: MemoryMetadata; body: string }

interface FrontmatterParts { header: string; body: string; newline: string; bom: string; present: boolean }
function splitDocument(text: string): FrontmatterParts {
  const match = text.match(/^(\uFEFF?)---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m)
  if (!match || match.index !== 0) return { header: '', body: text, newline: text.includes('\r\n') ? '\r\n' : '\n', bom: '', present: false }
  return { header: match[2] ?? '', body: text.slice(match[0].length), newline: match[0].includes('\r\n') ? '\r\n' : '\n', bom: match[1] ?? '', present: true }
}
function fields(header: string): Map<string, string> {
  const result = new Map<string, string>(); let key = ''
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^([\w-]+):\s*(.*)$/)
    if (match) { key = match[1] ?? ''; result.set(key, match[2] ?? '') }
    else if (key) result.set(key, `${result.get(key) ?? ''}\n${line}`)
  }
  return result
}
function scalar(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value.startsWith('"')) { try { const parsed: unknown = JSON.parse(value); return typeof parsed === 'string' ? parsed : '' } catch { /* 兼容 YAML 双引号之外的旧格式。 */ } }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  if (/^[>|][-+]?\n/.test(value)) return value.replace(/^[>|][-+]?\n/, '').split('\n').map(line => line.trim()).filter(Boolean).join(' ')
  return value.replace(/\s+#.*$/, '').trim()
}
function list(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  const value = raw.trim()
  if (value.startsWith('[')) {
    try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string') } catch { /* YAML inline 字符串数组。 */ }
    return value.slice(1, value.lastIndexOf(']')).split(',').map(item => scalar(item)).filter(Boolean)
  }
  return value.split('\n').map(line => line.match(/^\s*-\s+(.+)$/)?.[1]).filter((item): item is string => item !== undefined).map(item => scalar(item)).filter(Boolean)
}
export function parseMemoryDocument(text: string): ParsedMemoryDocument {
  const parts = splitDocument(text); const values = fields(parts.header)
  return { metadata: { name: scalar(values.get('name')), description: scalar(values.get('description')), sources: list(values.get('sources')), aliases: list(values.get('aliases')) }, body: parts.body }
}
export function patchMemoryMetadata(text: string, patch: Partial<MemoryMetadata> & { aliases_overflow?: string[] }): string {
  const parts = splitDocument(text)
  const lines = parts.header.replace(/\r?\n$/, '').split(/\r?\n/).filter((line, index, all) => !(all.length === 1 && index === 0 && line === ''))
  for (const key of ['name', 'description', 'sources', 'aliases', 'aliases_overflow'] as const) {
    const value = patch[key]; if (value === undefined) continue
    const replacement = `${key}: ${JSON.stringify(value)}`
    const start = lines.findIndex(line => line.startsWith(`${key}:`))
    if (start < 0) { lines.push(replacement); continue }
    let end = start + 1
    while (end < lines.length && !/^[\w-]+:/.test(lines[end] ?? '')) end += 1
    // 只替换该字段的值区间；未知顶层字段和文件正文不经过序列化。
    const comments = lines.slice(start + 1, end).filter(line => /^\s*(?:#|$)/.test(line))
    lines.splice(start, end - start, replacement, ...comments)
  }
  return `${parts.bom}---${parts.newline}${lines.join(parts.newline)}${parts.newline}---${parts.newline}${parts.body}`
}
export function isGenericMemoryDescription(description: string): boolean {
  const value = description.trim()
  return !value || value.length > 150 || /[\r\n]/.test(value) || /^(?:用户的?)?(?:个人信息|身份与背景信息|背景信息|用户画像|用户档案|个人档案|用户资料|用户偏好|回答偏好|相关信息|长期记忆|记忆文件|记忆|信息|笔记|资料|其他|profile|preferences|notes|memory)[。.!！]?$/i.test(value)
}
export function isSensitiveMemoryTopic(path: string, description: string, content = ''): boolean {
  return /(?:health|medical|finance|identity|健康|病史|疾病|诊断|医疗|过敏|财务|薪资|工资|收入|身份证|证件|身份信息|住址|手机号|宗教|性取向|情绪低谷)/i.test(`${path}\n${description}\n${content}`)
}
export function sensitiveMemoryDescription(path: string, description: string, content = ''): string {
  const topic = `${path}\n${description}\n${content}`
  if (/health|medical|健康|病史|疾病|诊断|医疗|过敏/i.test(topic)) return '健康笔记；用户明确涉及健康主题时读取'
  if (/finance|财务|薪资|工资|收入/i.test(topic)) return '财务笔记；用户明确涉及财务主题时读取'
  if (/情绪低谷|抑郁/i.test(topic)) return '情绪笔记；用户明确涉及该主题时读取'
  return '个人敏感主题；用户明确涉及该主题时读取'
}
