import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

let cachedPath: string | undefined

/**
 * 稳健解析真实 Electron 可执行文件路径。
 * 直接基于 electron 包的 package.json 与 path.txt 读取物理路径，
 * 避免单元测试中的 mock.module('electron') 将 require('electron') 污染为非字符串对象。
 */
export function getElectronExecutablePath(): string {
  if (cachedPath) return cachedPath
  try {
    const req = createRequire(import.meta.url)
    const pkg = req.resolve('electron/package.json')
    const dir = dirname(pkg)
    const rel = readFileSync(join(dir, 'path.txt'), 'utf8').trim()
    const binary = join(dir, 'dist', rel)
    if (existsSync(binary)) {
      cachedPath = binary
      return binary
    }
  } catch {
    // 忽略解析失败，尝试回退
  }
  const req = createRequire(import.meta.url)
  const raw = req('electron')
  if (typeof raw === 'string') {
    cachedPath = raw
    return raw
  }
  throw new Error('无法解析有效的 Electron 可执行文件路径')
}
