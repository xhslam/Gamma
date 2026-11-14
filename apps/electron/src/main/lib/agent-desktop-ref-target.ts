import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ComputerRefTarget } from './computer-target-guard'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * 固定源码 893a414 的 RefStore 私有布局：sessions/<id>/snapshots/<snapshot>/refmap.json。
 * 仅供 Host 在自己创建的 0700 根目录内读取身份；不导出控件文字，不接受任意路径或裸引用。
 * 布局或身份缺失时拒绝，不退回模型自报的 app；上游执行仍负责重新核验进程实例。
 */
export function readAgentDesktopRefTarget(root: string, sessionId: string, ref: string): ComputerRefTarget {
  const match = /^@([A-Za-z0-9_-]{3,64}):e([1-9][0-9]{0,9})$/.exec(ref)
  if (!match || Number(match[2]) > 4_294_967_295 || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
    throw new Error('无效限定引用；请使用本轮原生快照返回的 ref')
  }
  let path = root
  for (const part of ['state', 'sessions', sessionId, 'snapshots', match[1]!]) {
    path = join(path, part)
    const metadata = lstatSync(path)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('原生引用存储目录不可信')
  }
  const file = join(path, 'refmap.json')
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('原生引用文件不可信')
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const metadata = fstatSync(fd)
    if (!metadata.isFile() || metadata.size > 1_048_576) throw new Error('原生引用存储超出有界契约')
    const store: unknown = JSON.parse(readFileSync(fd, 'utf8'))
    const entry = record(store) && record(store.inner) ? store.inner[`@e${match[2]}`] : undefined
    if (!record(entry) || typeof entry.source_app !== 'string' || !entry.source_app.trim()
      || !Number.isSafeInteger(entry.pid) || typeof entry.pid !== 'number' || entry.pid <= 0
      || typeof entry.process_instance !== 'string' || !entry.process_instance) {
      throw new Error('引用归属缺失或已失效；请重新观察')
    }
    return { appName: entry.source_app, pid: entry.pid, processInstance: entry.process_instance }
  } finally { closeSync(fd) }
}
