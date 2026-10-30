import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryCatalog, formatMemoryListing, estimateMemoryTokens } from './memory-catalog'
import { parseMemoryDocument, patchMemoryMetadata } from './memory-metadata'

const roots: string[] = []
function fixture(): { global: string; workspace: string; catalog: MemoryCatalog } {
  const root = mkdtempSync(join(tmpdir(), 'gamma-memory-catalog-')); roots.push(root)
  const global = join(root, 'global'); const workspace = join(root, 'workspace')
  mkdirSync(global); mkdirSync(workspace)
  return { global, workspace, catalog: new MemoryCatalog({ roots: [{ scope: 'global', root: global }, { scope: 'workspace', root: workspace }] }) }
}
function document(name: string, description: string, body: string, aliases: string[] = []): string {
  return `---\nname: ${name}\ndescription: ${description}\nsources: []\naliases: ${JSON.stringify(aliases)}\n---\n${body}`
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('目录驱动的双作用域提取', () => {
  it('Given 两个根有同名文件 When 批量读 Then 分别返回正文、大小、版本且不串写', async () => {
    const { global, workspace, catalog } = fixture()
    writeFileSync(join(global, 'profile.md'), document('profile.md', '称呼，在确认名字时读', '- [stated] 叫小林\n'))
    writeFileSync(join(workspace, 'profile.md'), document('profile.md', '当前项目角色，项目沟通时读', '- [stated] 负责设计\n'))
    const result = await catalog.read(['global:/profile.md', 'workspace:/profile.md'])
    expect(result.files).toHaveLength(2)
    expect(result.files[0]?.content).toContain('叫小林')
    expect(result.files[1]?.content).toContain('负责设计')
    expect(result.files[0]?.version).not.toBe(result.files[1]?.version)
    expect(result.files[0]?.size).toBeGreaterThan(0)
  })
  it('Given 别名和中文目录 When search Then 返回 top5 路径与片段而非全量正文', async () => {
    const { workspace, catalog } = fixture(); mkdirSync(join(workspace, 'areas'))
    writeFileSync(join(workspace, 'areas/exam.md'), document('exam.md', '数学考试计划与科目，安排复习时读', '- [stated] 截止日期是11月15日\n', ['秋考']))
    const matches = await catalog.search('帮我安排秋考复习')
    expect(matches).toHaveLength(1); expect(matches[0]?.path).toBe('workspace:/areas/exam.md')
    expect(matches[0]?.snippet.length).toBeLessThanOrEqual(240)
    expect((await catalog.search('无关电影'))).toHaveLength(0)
  })
  it('Given 长文件 When 限额读取和分页 Then 明确截断并能继续读，不修改源文件', async () => {
    const { global, catalog } = fixture(); const text = document('long.md', '长篇学习主题，深入学习时读', '正文'.repeat(500))
    writeFileSync(join(global, 'long.md'), text)
    const first = await catalog.read('global:/long.md', { limit: 80 })
    expect(first.files[0]?.truncated).toBe(true); expect(first.files[0]?.nextOffset).toBe(80)
    const next = await catalog.read('global:/long.md', { offset: 80, limit: 80 })
    expect(next.files[0]?.content).toBe(text.slice(80, 160)); expect(readFileSync(join(global, 'long.md'), 'utf8')).toBe(text)
    await expect(catalog.read(Array.from({ length: 21 }, (_, i) => `global:/${i}.md`))).rejects.toThrow('20')
  })
  it('Given 路径穿越、symlink与未授权scope When 读取 Then 拒绝且目录不泄漏', async () => {
    const { global, workspace, catalog } = fixture(); writeFileSync(join(workspace, 'secret.md'), '不该从全局看到')
    symlinkSync(join(workspace, 'secret.md'), join(global, 'linked.md'))
    symlinkSync(workspace, join(global, 'outside'))
    expect((await catalog.scan()).filter(file => file.path.startsWith('global:'))).toHaveLength(0)
    await expect(catalog.read('global:/linked.md')).rejects.toThrow()
    await expect(catalog.read('global:/../workspace/secret.md')).rejects.toThrow()
    await expect(catalog.read('other:/secret.md')).rejects.toThrow()
    await expect(catalog.read('workspace:/.automatic-memory.json')).rejects.toThrow()
  })
  it('Given 超预算目录 When 注入 Then 保留最近条目、折叠目录计数并提示展开工具', async () => {
    const { workspace, catalog } = fixture(); mkdirSync(join(workspace, 'areas'))
    for (let i = 0; i < 15; i++) { const file = join(workspace, `areas/topic-${i}.md`); writeFileSync(file, document(`topic-${i}.md`, `具体项目${i}的复习计划与里程碑，在安排项目${i}时读`, '正文')); utimesSync(file, 100000 + i, 100000 + i) }
    const listing = formatMemoryListing(await catalog.scan(), 250)
    expect(listing).toContain('topic-14.md'); expect(listing).toContain('折叠'); expect(listing).toContain('memory_list'); expect(estimateMemoryTokens(listing)).toBeLessThanOrEqual(250)
  })
  it('Given 敏感文件 When 列目录 Then 不泄漏description里的敏感事实', async () => {
    const { global, catalog } = fixture(); mkdirSync(join(global, 'topics'))
    writeFileSync(join(global, 'topics/health.md'), document('health.md', '小林的病史为某某疾病', '- [stated] 病史内容\n', ['健康']))
    const listing = formatMemoryListing(await catalog.scan())
    expect(listing).not.toContain('某某疾病'); expect(listing).toContain('健康笔记')
  })
})

describe('大文件仍可按需分页', () => {
  it('Given 超过2MB的正文 When 列目录并读取 Then 不静默漏掉且仍受正文预算限制', async () => {
    const { global, catalog } = fixture()
    writeFileSync(join(global, 'large.md'), document('large.md', '长篇项目资料，涉及项目资料细节时读取', 'a'.repeat(2_100_000)))
    expect(formatMemoryListing(await catalog.scan())).toContain('global:/large.md')
    const result = await catalog.read('global:/large.md', { limit: 120 })
    expect(result.files[0]?.content.length).toBe(120)
    expect(result.files[0]?.truncated).toBe(true)
    expect(result.files[0]?.nextOffset).toBe(120)
  })
})

describe('元数据兼容与无损更新', () => {
  it('Given CRLF和未知frontmatter When patch Then 正文逐字节保留且保留未知字段', () => {
    const raw = '---\r\nname: old\r\ncustom: keep\r\naliases:\r\n  - 秋考\r\n---\r\n\r\n- [stated] 事实  \r\n'
    const before = parseMemoryDocument(raw)
    expect(before.metadata.aliases).toEqual(['秋考'])
    const patched = patchMemoryMetadata(raw, { name: 'exam.md', description: '秋考复习，安排考试时读', sources: [] })
    expect(parseMemoryDocument(patched).body).toBe(before.body)
    expect(patched).toContain('custom: keep\r\n')
    expect(parseMemoryDocument(patched).metadata.name).toBe('exam.md')
  })
})
