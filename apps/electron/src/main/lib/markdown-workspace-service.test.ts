import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { MarkdownWorkspaceService } from './markdown-workspace-service'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gamma-markdown-test-')); directories.push(root)
  const file = join(root, 'test.md'); writeFileSync(file, '\uFEFF# 标题\r\n正文\r\n'); chmodSync(file, 0o640)
  const service = new MarkdownWorkspaceService()
  const source = service.grant('owner', root, 'directory')
  return { root, file, service, source }
}
describe('Given Markdown 原子文件服务', () => {
  test('When revision 一致 Then 保存并保持 BOM、CRLF 与权限', () => {
    const { file, service, source } = fixture()
    const result = service.read('owner', source.id, 'test.md')
    if (result.status !== 'document') throw new Error('读取失败')
    const saved = service.save('owner', result.document.id, '# 改动\n正文\n', result.document.revision)
    expect(saved.status).toBe('saved')
    expect(readFileSync(file, 'utf8')).toBe('\uFEFF# 改动\r\n正文\r\n')
    expect(statSync(file).mode & 0o777).toBe(0o640)
  })
  test('When 外部进程先修改 Then 返回冲突而不覆盖', () => {
    const { file, service, source } = fixture(); const read = service.read('owner', source.id, 'test.md')
    if (read.status !== 'document') throw new Error('读取失败')
    writeFileSync(file, '外部改动')
    expect(service.save('owner', read.document.id, '草稿', read.document.revision)).toMatchObject({ status: 'error', code: 'conflict' })
    expect(readFileSync(file, 'utf8')).toBe('外部改动')
  })
  test('When 跨身份、伪造来源或路径上溯 Then 拒绝', () => {
    const { service, source } = fixture()
    for (const [owner, id, path] of [['other', source.id, 'test.md'], ['owner', 'fake', 'test.md'], ['owner', source.id, '../test.md']]) {
      expect(service.read(owner!, id!, path!)).toMatchObject({ status: 'error', code: 'denied' })
    }
  })
  test('When 单文件 grant 请求同目录其他文件 Then 拒绝', () => {
    const { file, service } = fixture(); const source = service.grant('owner', file, 'file')
    expect(service.read('owner', source.id, 'sibling.md')).toMatchObject({ status: 'error', code: 'denied' })
    expect(service.read('owner', source.id, '').status).toBe('document')
  })
  test('When 目录 symlink 越出来源 Then 不可读取且不列出', () => {
    const { root, service, source } = fixture(); const outside = mkdtempSync(join(tmpdir(), 'gamma-md-out-')); directories.push(outside)
    writeFileSync(join(outside, 'outside.md'), '秘密'); symlinkSync(join(outside, 'outside.md'), join(root, 'escape.md'))
    expect(service.read('owner', source.id, 'escape.md')).toMatchObject({ status: 'error', code: 'denied' })
    const list = service.list('owner', source.id, '')
    if (list.status !== 'entries') throw new Error('列目录失败')
    expect(list.entries.map(entry => entry.name)).not.toContain('escape.md')
  })
  test('When 只读文件或撤销 grant Then 不可保存', () => {
    const { file, service, source } = fixture(); chmodSync(file, 0o444)
    const read = service.read('owner', source.id, 'test.md'); if (read.status !== 'document') throw new Error('读取失败')
    expect(read.document.writable).toBe(false)
    expect(service.save('owner', read.document.id, '草稿', read.document.revision)).toMatchObject({ status: 'error', code: 'denied' })
    service.release('owner', source.id)
    expect(service.read('owner', source.id, 'test.md')).toMatchObject({ status: 'error', code: 'denied' })
  })
  test('When 原子写入失败 Then 保持原文件与 revision', () => {
    const { file, source, service } = fixture(); const failed = new MarkdownWorkspaceService(() => { throw new Error('disk') })
    const grant = failed.grant('owner', file, 'file'); const read = failed.read('owner', grant.id, '')
    if (read.status !== 'document') throw new Error('读取失败')
    expect(failed.save('owner', read.document.id, '草稿', read.document.revision)).toMatchObject({ status: 'error', code: 'io' })
    expect(service.read('owner', source.id, 'test.md')).toMatchObject({ document: { content: '# 标题\n正文\n' } })
  })
  test('When 目录根被替换为另一目录 Then 原 grant 失效', () => {
    const { root, service, source } = fixture()
    renameSync(root, root + '-old'); directories.push(root + '-old'); mkdirSync(root)
    writeFileSync(join(root, 'test.md'), '新目录中的文档')
    expect(service.read('owner', source.id, 'test.md')).toMatchObject({ code: 'denied' })
  })
  test('When 编辑混合 LF/CRLF 的文本 Then 保持已有换行序列', () => {
    const { file, service, source } = fixture()
    writeFileSync(file, '# 标题\r\n第一段\n第二段\r\n')
    const read = service.read('owner', source.id, 'test.md'); if (read.status !== 'document') throw new Error('读取失败')
    expect(service.save('owner', read.document.id, '# 新标题\n第一段\n第二段\n', read.document.revision).status).toBe('saved')
    expect(readFileSync(file, 'utf8')).toBe('# 新标题\r\n第一段\n第二段\r\n')
  })
  test('When 同 revision 的两个应用内保存依次执行 Then 第二次拒绝过期 revision', () => {
    const { service, source } = fixture()
    const read = service.read('owner', source.id, 'test.md'); if (read.status !== 'document') throw new Error('读取失败')
    expect(service.save('owner', read.document.id, '第一次', read.document.revision).status).toBe('saved')
    expect(service.save('owner', read.document.id, '第二次', read.document.revision)).toMatchObject({ code: 'conflict' })
  })
  test('When 原生 dialog 另存新文件 Then 原文件不变并返回单文件来源', () => {
    const { root, file, service, source } = fixture()
    const read = service.read('owner', source.id, 'test.md'); if (read.status !== 'document') throw new Error('读取失败')
    const saved = service.saveAs('owner', read.document.id, '# 副本', join(root, 'copy.md'))
    expect(saved).toMatchObject({ status: 'saved', source: { kind: 'file' } })
    expect(readFileSync(file, 'utf8')).toBe('\uFEFF# 标题\r\n正文\r\n')
    expect(readFileSync(join(root, 'copy.md'), 'utf8')).toBe('# 副本')
  })
  test('When 项目根重绑定 Then 撤销旧项目来源而不撤销用户选择来源', () => {
    const { root, service } = fixture()
    const project = service.grant('owner', root, 'directory', 'project')
    const manual = service.grant('owner', root, 'directory')
    service.synchronizeProject('owner', undefined)
    expect(service.read('owner', project.id, 'test.md')).toMatchObject({ code: 'denied' })
    expect(service.read('owner', manual.id, 'test.md').status).toBe('document')
  })
  test('When 文件过大、无效 UTF8 或非法扩展 Then 明确拒绝', () => {
    const { root, service, source } = fixture()
    writeFileSync(join(root, 'big.md'), Buffer.alloc(5 * 1024 * 1024 + 1))
    writeFileSync(join(root, 'bad.md'), Buffer.from([0xff])); writeFileSync(join(root, 'data.txt'), 'text')
    expect(service.read('owner', source.id, 'big.md')).toMatchObject({ code: 'too-large' })
    expect(service.read('owner', source.id, 'bad.md')).toMatchObject({ code: 'invalid' })
    expect(service.read('owner', source.id, 'data.txt')).toMatchObject({ code: 'denied' })
  })
  test('When 授予目录来源 Then 持久化配置且新服务实例可通过 restore 恢复目录来源', () => {
    const { root } = fixture()
    const configPath = join(root, 'config', 'markdown-workspaces.json')
    const service1 = new MarkdownWorkspaceService(undefined, () => configPath)
    const source1 = service1.grant('owner', root, 'directory', 'dialog', 'my-scope')
    expect(source1.kind).toBe('directory')

    // 新服务实例（模拟重启后）
    const service2 = new MarkdownWorkspaceService(undefined, () => configPath)
    const restored = service2.restore('owner', 'my-scope')
    expect(restored).toMatchObject({ status: 'sources' })
    if (restored.status === 'sources') {
      expect(restored.sources.length).toBe(1)
      expect(restored.sources[0]?.name).toBe(basename(root))
      // 恢复后可正常列出和读取
      const listed = service2.list('owner', restored.sources[0]!.id, '')
      expect(listed.status).toBe('entries')
    }
  })
  test('When 释放持久化目录来源 Then 从配置文件中移除', () => {
    const { root } = fixture()
    const configPath = join(root, 'config', 'markdown-workspaces.json')
    const service = new MarkdownWorkspaceService(undefined, () => configPath)
    const source = service.grant('owner', root, 'directory', 'dialog', 'my-scope')
    expect(service.restore('owner', 'my-scope')).toMatchObject({ status: 'sources' })
    service.release('owner', source.id, 'my-scope')

    const serviceAfter = new MarkdownWorkspaceService(undefined, () => configPath)
    const restored = serviceAfter.restore('owner', 'my-scope')
    expect(restored).toMatchObject({ status: 'sources', sources: [] })
  })
  test('When 在目录来源内创建新文件 Then 文件写入磁盘并返回有效草稿', () => {
    const { root } = fixture()
    const service = new MarkdownWorkspaceService()
    const source = service.grant('owner', root, 'directory')
    const created = service.createFile('owner', source.id, '', '新笔记.md')
    expect(created.status).toBe('document')
    if (created.status === 'document') {
      expect(created.document.name).toBe('新笔记.md')
      expect(created.document.content).toContain('# 新笔记')
      expect(existsSync(join(root, '新笔记.md'))).toBe(true)
    }
  })
})
