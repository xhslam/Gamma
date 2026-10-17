import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  decodeXmlEntities,
  parseMacFilenamesPboard,
  pruneOldTerminalImages,
  saveTerminalPastedImage,
  getTerminalClipboardContent,
  setClipboardForTest,
  setTerminalImagesDirForTest,
} from './terminal-clipboard-service'

let fakeClipboardImage = {
  isEmpty: () => true,
  toPNG: () => Buffer.from('fake-png'),
}
let fakeClipboardText = ''
let fakeClipboardPlist = ''

describe('终端剪贴板服务 terminal-clipboard-service', () => {
  const testDir = join(tmpdir(), `gamma-term-clip-test-${Date.now()}`)

  beforeEach(() => {
    fakeClipboardImage = {
      isEmpty: () => true,
      toPNG: () => Buffer.from('fake-png'),
    }
    fakeClipboardText = ''
    fakeClipboardPlist = ''
    setClipboardForTest({
      readImage: () => fakeClipboardImage,
      readText: () => fakeClipboardText,
      read: (format: string) => (format === 'NSFilenamesPboardType' ? fakeClipboardPlist : ''),
    })
    setTerminalImagesDirForTest(join(testDir, 'terminal-images'))
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    setClipboardForTest(null)
    setTerminalImagesDirForTest(null)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
  })

  test('Given 包含 XML 转义字符的 plist When decodeXmlEntities Then 正确还原特殊符号', () => {
    expect(decodeXmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'')
    expect(decodeXmlEntities('/Users/test/Rock &amp; Roll/file.png')).toBe('/Users/test/Rock & Roll/file.png')
  })

  test('Given macOS Finder 剪贴板 plist XML When parseMacFilenamesPboard Then 解析出所有文件绝对路径', () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
\t<string>/Users/apple/Desktop/image1.png</string>
\t<string>/Users/apple/Desktop/Rock &amp; Roll/doc.pdf</string>
</array>
</plist>`

    const paths = parseMacFilenamesPboard(plist)
    expect(paths).toEqual([
      '/Users/apple/Desktop/image1.png',
      '/Users/apple/Desktop/Rock & Roll/doc.pdf',
    ])
  })

  test('Given 非法或空的 plist 输入 When parseMacFilenamesPboard Then 返回空数组而不抛错', () => {
    expect(parseMacFilenamesPboard('')).toEqual([])
    expect(parseMacFilenamesPboard('not xml')).toEqual([])
  })

  test('Given base64 编码的 PNG 数据 When saveTerminalPastedImage Then 保存为本地临时 PNG 并返回路径', async () => {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const result = await saveTerminalPastedImage({
      data: `data:image/png;base64,${pngBase64}`,
      mimeType: 'image/png',
    })

    expect(result.filePath).toBeDefined()
    expect(result.filePath.endsWith('.png')).toBe(true)
    expect(existsSync(result.filePath)).toBe(true)

    const savedBuffer = readFileSync(result.filePath)
    expect(savedBuffer.length).toBeGreaterThan(0)
  })

  test('Given 剪贴板中有原生图片 When saveTerminalPastedImage Then 自动读取并保存', async () => {
    fakeClipboardImage = {
      isEmpty: () => false,
      toPNG: () => Buffer.from('fake-png-data'),
    }

    const result = await saveTerminalPastedImage()
    expect(result.filePath).toBeDefined()
    expect(existsSync(result.filePath)).toBe(true)
  })

  test('Given 传入空 base64 数据且剪贴板无图片 When saveTerminalPastedImage Then 抛出明确异常', async () => {
    await expect(saveTerminalPastedImage({ data: '' })).rejects.toThrow()
  })

  test('Given 剪贴板中有原生图片 When getTerminalClipboardContent Then 优先返回图片结果', async () => {
    fakeClipboardImage = {
      isEmpty: () => false,
      toPNG: () => Buffer.from('fake-png-image'),
    }
    fakeClipboardText = 'hello world'

    const content = await getTerminalClipboardContent()
    expect(content.type).toBe('image')
    expect(content.filePath).toBeDefined()
  })

  test('Given 剪贴板中仅有文本 When getTerminalClipboardContent Then 返回文本结果', async () => {
    fakeClipboardText = 'git status'

    const content = await getTerminalClipboardContent()
    expect(content.type).toBe('text')
    expect(content.text).toBe('git status')
  })

  test('Given 剪贴板为空 When getTerminalClipboardContent Then 返回 empty 结果', async () => {
    const content = await getTerminalClipboardContent()
    expect(content.type).toBe('empty')
  })

  test('Given 历史图片数量超出限制且已过期 When pruneOldTerminalImages Then 清理超出限制的旧文件', async () => {
    for (let i = 1; i <= 5; i++) {
      const p = join(testDir, `paste-test-${i}.png`)
      writeFileSync(p, `data-${i}`)
    }

    await pruneOldTerminalImages(testDir, 1000, 2)

    const remaining = existsSync(testDir) ? [1, 2, 3, 4, 5].filter((i) => existsSync(join(testDir, `paste-test-${i}.png`))) : []
    expect(remaining.length).toBeLessThanOrEqual(2)
  })
})
