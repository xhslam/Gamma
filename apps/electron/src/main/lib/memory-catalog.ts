import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isSensitiveMemoryTopic, parseMemoryDocument, sensitiveMemoryDescription } from './memory-metadata'

export type MemoryScope = 'global' | 'workspace'
export interface MemoryRoot { scope: MemoryScope; root: string }
export interface MemoryVirtualFile { path: string; content: string; updatedAt: number; title?: string; alwaysInject?: 'profile' | 'preferences' }
export interface MemoryCatalogFile {
  path: string; name: string; description: string; aliases: string[]; updatedAt: number
  version: string; size: number; content: string; sensitive: boolean; readOnly: boolean; title?: string; alwaysInject?: 'profile' | 'preferences'
}
export interface MemoryCatalogOptions { roots: MemoryRoot[]; virtualFiles?: () => Promise<MemoryVirtualFile[]> }
export interface MemoryReadOptions { offset?: number; limit?: number }
export interface MemoryReadFile {
  path: string; content: string; size: number; version: string; offset: number
  truncated: boolean; nextOffset?: number; readOnly: boolean; title?: string
}
export interface MemoryReadResult { files: MemoryReadFile[] }
export interface MemorySearchMatch { path: string; snippet: string; score: number }
export const MEMORY_READ_MAX_CHARS = 12000
export const memoryVersion = (content: string): string => createHash('sha1').update(content).digest('hex').slice(0, 12)
const cleanLine = (value: string): string => value.replace(/[\r\n\t<>]/g, ' ').trim()
export const normalizeMemoryText = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
export function memoryTerms(query: string): string[] {
  const text = normalizeMemoryText(query.slice(0, 4000))
  const terms = new Set(text.match(/[a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu) ?? [])
  for (const segment of text.match(/[\p{Script=Han}]+/gu) ?? []) for (let i = 0; i + 1 < segment.length && terms.size < 200; i++) terms.add(segment.slice(i, i + 2))
  return [...terms]
}
export function estimateMemoryTokens(text: string): number {
  const han = text.match(/[\p{Script=Han}]/gu)?.length ?? 0
  return Math.ceil(han + (text.length - han) / 3)
}
export function formatMemoryListing(files: MemoryCatalogFile[], budgetTokens = 3000): string {
  if (!files.length) return '(empty)'
  const sorted = [...files].sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path))
  const lines: string[] = []; const omitted = new Map<string, number>()
  const suffix = '目录已折叠；可调用 memory_list(path_prefix) 或 memory_search(query) 查找。'
  for (const file of sorted) {
    const line = `${file.path} [aliases: ${file.aliases.map(cleanLine).join(', ')}] [updated: ${new Date(file.updatedAt).toISOString().slice(0, 10)}] — ${cleanLine(file.description).slice(0, 150)}`
    if (estimateMemoryTokens([...lines, line, suffix].join('\n')) <= Math.max(0, budgetTokens - 70)) lines.push(line)
    else { const directory = file.path.replace(/\/[^/]+$/, '/') || file.path; omitted.set(directory, (omitted.get(directory) ?? 0) + 1) }
  }
  if (omitted.size) {
    for (const [directory, count] of omitted) {
      const line = `${directory} — 折叠 ${count} 个文件`
      if (estimateMemoryTokens([...lines, line, suffix].join('\n')) <= budgetTokens) lines.push(line)
    }
    lines.push(suffix)
  }
  return lines.join('\n')
}
function metadataFile(file: MemoryVirtualFile, readOnly: boolean): MemoryCatalogFile {
  const { metadata } = parseMemoryDocument(file.content)
  const sensitive = isSensitiveMemoryTopic(file.path, metadata.description, file.content)
  return { ...file, name: metadata.name || path.posix.basename(file.path), aliases: metadata.aliases.slice(0, 8),
    description: sensitive ? sensitiveMemoryDescription(file.path, metadata.description, file.content) : metadata.description || `${path.posix.basename(file.path, '.md')} 主题，涉及该主题时读取`,
    version: memoryVersion(file.content), size: Buffer.byteLength(file.content), sensitive, readOnly }
}

/** 两个可信根分别解析；不发现祖先目录、不跨作用域回退、不跟随 symlink。 */
export class MemoryCatalog {
  readonly roots: MemoryRoot[]
  constructor(private readonly options: MemoryCatalogOptions) {
    this.roots = options.roots.map(root => ({ scope: root.scope, root: path.resolve(root.root) }))
    if (new Set(this.roots.map(root => root.scope)).size !== this.roots.length) throw new Error('记忆作用域重复')
  }
  canonicalPath(input: string): string {
    const match = input.match(/^(global|workspace):\/?(.*)$/)
    if (input.includes(':') && !match) throw new Error('未知记忆作用域')
    const scope = match?.[1] ?? this.roots[0]?.scope ?? 'global'
    const rel = (match?.[2] ?? input).replace(/^\/+/, '')
    if (!rel || rel.includes('\\') || rel.includes('\0') || rel.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || !rel.endsWith('.md')) throw new Error('path must be a .md file inside the memory directory')
    if (!this.roots.some(root => root.scope === scope)) throw new Error('记忆作用域未授权')
    return `${scope}:/${rel}`
  }
  async resolveFile(input: string): Promise<{ canonical: string; absolute: string; root: string }> {
    const canonical = this.canonicalPath(input); const separator = canonical.indexOf(':/')
    const scope = canonical.slice(0, separator); const rel = canonical.slice(separator + 2)
    const root = this.roots.find(item => item.scope === scope)!.root
    let probe = root
    for (const part of ['', ...rel.split('/')]) {
      if (part) probe = path.join(probe, part)
      try { const stat = await fs.lstat(probe); if (stat.isSymbolicLink() || (probe !== path.join(root, rel) && !stat.isDirectory())) throw new Error('记忆路径不能包含 symlink 或非目录祖先') }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    }
    return { canonical, absolute: path.join(root, rel), root }
  }
  async scan(): Promise<MemoryCatalogFile[]> {
    const files: MemoryCatalogFile[] = []
    for (const root of this.roots) {
      const visit = async (directory: string): Promise<void> => {
        let stat
        try { stat = await fs.lstat(directory) } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error }
        if (stat.isSymbolicLink() || !stat.isDirectory()) return
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
          const absolute = path.join(directory, entry.name)
          if (entry.isDirectory()) await visit(absolute)
          else if (entry.isFile() && entry.name.endsWith('.md')) {
            const safe = await this.resolveFile(`${root.scope}:/${path.relative(root.root, absolute).split(path.sep).join('/')}`)
            const fileStat = await fs.lstat(safe.absolute)
            // 目录不按正文大小丢弃文件；发给模型的正文另由读取预算和分页限制。
            const content = await fs.readFile(safe.absolute, 'utf8')
            files.push(metadataFile({ path: safe.canonical, content, updatedAt: fileStat.mtimeMs }, false))
          }
        }
      }
      await visit(root.root)
    }
    const occupied = new Set(files.map(file => file.path))
    for (const virtual of await this.options.virtualFiles?.() ?? []) {
      const canonical = this.canonicalPath(virtual.path)
      if (occupied.has(canonical)) throw new Error('自动记忆虚拟文件与 Markdown 路径冲突')
      occupied.add(canonical); files.push(metadataFile({ ...virtual, path: canonical }, true))
    }
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }
  async read(input: string | string[], options: MemoryReadOptions = {}): Promise<MemoryReadResult> {
    const paths = Array.isArray(input) ? input : [input]
    if (!paths.length || paths.length > 20) throw new Error('memory_read 一次需要 1–20 个路径')
    const offset = options.offset ?? 0; const limit = Math.min(options.limit ?? MEMORY_READ_MAX_CHARS, MEMORY_READ_MAX_CHARS)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('offset/limit 必须为有效字符位置与正整数')
    const scanned = await this.scan(); const files: MemoryReadFile[] = []; let budget = MEMORY_READ_MAX_CHARS
    for (const inputPath of [...new Set(paths)]) {
      const canonical = this.canonicalPath(inputPath)
      await this.resolveFile(canonical)
      const file = scanned.find(item => item.path === canonical)
      if (!file) throw new Error(`${canonical} not found`)
      const available = Math.max(0, Math.min(limit, budget)); const content = file.content.slice(offset, offset + available)
      const nextOffset = offset + content.length; const truncated = nextOffset < file.content.length
      files.push({ path: canonical, content, size: file.size, version: file.version, offset, truncated, ...(truncated ? { nextOffset } : {}), readOnly: file.readOnly, ...(file.title ? { title: file.title } : {}) })
      budget -= content.length
    }
    return { files }
  }
  async search(query: string): Promise<MemorySearchMatch[]> {
    const terms = memoryTerms(query); if (!terms.length) return []
    return (await this.scan()).map(file => {
      const title = normalizeMemoryText(`${file.name} ${file.description} ${file.aliases.join(' ')}`); const body = normalizeMemoryText(file.content)
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 5 : body.includes(term) ? 1 : 0), 0)
      const term = terms.find(item => body.includes(item)); const at = term ? body.indexOf(term) : 0
      return { path: file.path, score, snippet: file.content.slice(Math.max(0, at - 50), Math.max(0, at - 50) + 240) }
    }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 5)
  }
}
