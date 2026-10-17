/**
 * 终端剪贴板与图片粘贴服务
 *
 * 为终端（包括 Agent CLI：Claude Code、Codex CLI 等）提供统一可靠的剪贴板支持：
 * 1. 剪贴板图片自动持久化为本地缓存文件，并返回终端可识别的路径；
 * 2. 剪贴板文件（如 macOS Finder / Windows 资源管理器复制的文件）解析为路径；
 * 3. 剪贴板文本读取与括号化粘贴（Bracketed Paste）兼容处理。
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clipboard } from 'electron'
import type {
  TerminalClipboardContentResult,
  TerminalSavePastedImageInput,
  TerminalSavePastedImageResult,
} from '@gamma/shared'
import { getConfigDir } from './config-paths'

interface ClipboardReader {
  readImage(): Pick<ReturnType<typeof clipboard.readImage>, 'isEmpty' | 'toPNG'>
  readText: typeof clipboard.readText
  read: typeof clipboard.read
}

let testClipboard: ClipboardReader | null = null
let testImagesDir: string | null = null

export function setClipboardForTest(mockClipboard: ClipboardReader | null): void {
  testClipboard = mockClipboard
}

export function setTerminalImagesDirForTest(dir: string | null): void {
  testImagesDir = dir
}

function getClipboard(): ClipboardReader {
  return testClipboard ?? clipboard
}

export function getTerminalImagesDir(): string {
  const dir = testImagesDir ?? join(getConfigDir(), 'terminal-images')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function formatTimestamp(d = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  const ms = pad(d.getMilliseconds(), 3)
  return `${y}${m}${day}-${h}${min}${s}-${ms}`
}

export function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function parseMacFilenamesPboard(plistXml: string): string[] {
  if (!plistXml || typeof plistXml !== 'string') return []
  const matches = plistXml.matchAll(/<string>([\s\S]*?)<\/string>/g)
  const paths: string[] = []
  for (const m of matches) {
    const raw = m[1]?.trim()
    if (raw) {
      paths.push(decodeXmlEntities(raw))
    }
  }
  return paths
}

function getExtensionForMimeType(mimeType?: string): string {
  if (!mimeType) return 'png'
  const lower = mimeType.toLowerCase()
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg'
  if (lower.includes('webp')) return 'webp'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('svg')) return 'svg'
  return 'png'
}

/** 清理超过 7 天且数量超过 100 的历史临时图片，避免磁盘持续占用。 */
export async function pruneOldTerminalImages(dir: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000, maxFiles = 100): Promise<void> {
  try {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir)
    if (entries.length <= maxFiles) return

    const now = Date.now()
    const filesWithStats: { name: string; mtime: number }[] = []

    for (const name of entries) {
      if (!name.startsWith('paste-')) continue
      try {
        const fullPath = join(dir, name)
        const stats = statSync(fullPath)
        filesWithStats.push({ name, mtime: stats.mtimeMs })
      } catch {
        // 忽略单个文件状态读取异常
      }
    }

    filesWithStats.sort((a, b) => b.mtime - a.mtime)

    for (let i = 0; i < filesWithStats.length; i++) {
      const file = filesWithStats[i]
      if (!file) continue
      const isTooOld = now - file.mtime > maxAgeMs
      const isOverLimit = i >= maxFiles
      if (isTooOld || isOverLimit) {
        try {
          unlinkSync(join(dir, file.name))
        } catch {
          // 忽略删除失败
        }
      }
    }
  } catch (error) {
    console.warn('[TerminalClipboard] 清理旧图片失败:', error)
  }
}

export async function saveTerminalImageBuffer(buffer: Buffer, mimeType = 'image/png'): Promise<string> {
  const dir = getTerminalImagesDir()
  const ext = getExtensionForMimeType(mimeType)
  const random = Math.random().toString(36).slice(2, 8)
  const filename = `paste-${formatTimestamp()}-${random}.${ext}`
  const filePath = join(dir, filename)

  await writeFile(filePath, buffer)

  // 异步触发修剪，不阻塞用户粘贴
  queueMicrotask(() => {
    void pruneOldTerminalImages(dir)
  })

  return filePath
}

export async function saveTerminalPastedImage(input?: TerminalSavePastedImageInput): Promise<TerminalSavePastedImageResult> {
  if (input?.data) {
    const cleanBase64 = input.data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
    const buffer = Buffer.from(cleanBase64, 'base64')
    if (buffer.length === 0) {
      throw new Error('传入的图片数据为空')
    }
    const filePath = await saveTerminalImageBuffer(buffer, input.mimeType)
    return { filePath }
  }

  const nativeImage = getClipboard().readImage()
  if (nativeImage.isEmpty()) {
    throw new Error('剪贴板中未找到图片数据')
  }

  const buffer = nativeImage.toPNG()
  const filePath = await saveTerminalImageBuffer(buffer, 'image/png')
  return { filePath }
}

export async function getTerminalClipboardContent(): Promise<TerminalClipboardContentResult> {
  // 1. 优先检测原生图片
  const nativeImage = getClipboard().readImage()
  if (!nativeImage.isEmpty()) {
    const buffer = nativeImage.toPNG()
    const filePath = await saveTerminalImageBuffer(buffer, 'image/png')
    return { type: 'image', filePath }
  }

  // 2. 检测复制的文件（macOS Finder plist）
  if (process.platform === 'darwin') {
    try {
      const plistXml = getClipboard().read('NSFilenamesPboardType')
      if (plistXml) {
        const paths = parseMacFilenamesPboard(plistXml).filter((p) => existsSync(p))
        if (paths.length > 0) {
          return { type: 'files', filePaths: paths }
        }
      }
    } catch {
      // 容错继续检测文本
    }
  }

  // 3. 检测纯文本
  const text = getClipboard().readText()
  if (text && text.length > 0) {
    return { type: 'text', text }
  }

  return { type: 'empty' }
}
