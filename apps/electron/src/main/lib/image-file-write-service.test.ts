import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeRasterImageDataUrl, writeRasterImageFile } from './image-file-write-service'

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`

let directory: string

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'gamma-image-write-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('Given 已授权的真实图片路径', () => {
  test('When 写入编辑器导出的 PNG Then 原子替换字节且不留临时文件', () => {
    const filePath = join(directory, 'image.png')
    writeFileSync(filePath, 'old-content')
    if (process.platform !== 'win32') chmodSync(filePath, 0o640)

    writeRasterImageFile(filePath, PNG_DATA_URL)

    expect(readFileSync(filePath).toString('base64')).toBe(PNG_1X1)
    expect(readdirSync(directory)).toEqual(['image.png'])
    if (process.platform !== 'win32') expect(statSync(filePath).mode & 0o777).toBe(0o640)
  })

  test('When 文件扩展名或图片签名不匹配 Then 拒绝写入并保留原文件', () => {
    const filePath = join(directory, 'image.png')
    writeFileSync(filePath, 'original')

    expect(() => writeRasterImageFile(filePath, 'data:image/png;base64,bm90LWEtcG5n')).toThrow('图片编码与声明格式不一致')
    expect(readFileSync(filePath, 'utf8')).toBe('original')

    const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`
    expect(() => writeRasterImageFile(filePath, jpegDataUrl)).toThrow('原图格式与导出格式不一致')
    expect(readFileSync(filePath, 'utf8')).toBe('original')
  })
})

describe('Given 编辑器导出的 Data URL', () => {
  test('When 输入为空、伪造或非 base64 内容 Then 在打开写盘前拒绝', () => {
    for (const value of ['', 'data:image/png;base64,', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,%%%']) {
      expect(() => decodeRasterImageDataUrl(value)).toThrow()
    }
    expect(decodeRasterImageDataUrl(PNG_DATA_URL).mimeType).toBe('image/png')
  })
})
