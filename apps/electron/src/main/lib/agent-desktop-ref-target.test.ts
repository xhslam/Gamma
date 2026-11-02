import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgentDesktopRefTarget } from './agent-desktop-ref-target'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gamma-ref-target-test-'))
  roots.push(root)
  const base = join(root, 'state', 'sessions', 'session-123', 'snapshots', 'snapshot')
  mkdirSync(base, { recursive: true })
  const file = join(base, 'refmap.json')
  writeFileSync(file, JSON.stringify({ inner: { '@e1': { pid: 34, process_instance: 'process-34', source_app: 'Notes' } }, counter: 1 }))
  return { root, file }
}
describe('Given 固定上游版本的私有 ref store', () => {
  test('When 读取本轮限定引用 Then 只返回原生进程归属而非控件私密文字', () => {
    const f = fixture()
    expect(readAgentDesktopRefTarget(f.root, 'session-123', '@snapshot:e1')).toEqual({ appName: 'Notes', pid: 34, processInstance: 'process-34' })
  })
  test('When 裸引用、路径穿越、不存在引用或归属不完整 Then 失败关闭', () => {
    const f = fixture()
    for (const ref of ['@e1', '@../../outside:e1', '@snapshot:e2', '@snapshot:e0']) expect(() => readAgentDesktopRefTarget(f.root, 'session-123', ref)).toThrow()
    writeFileSync(f.file, JSON.stringify({ inner: { '@e1': { pid: 34, source_app: 'Notes' } } }))
    expect(() => readAgentDesktopRefTarget(f.root, 'session-123', '@snapshot:e1')).toThrow()
  })
  test('When refmap 是符号链接或超过上游有界大小 Then 不读取', () => {
    const f = fixture()
    const outside = join(f.root, 'outside.json')
    writeFileSync(outside, '{}')
    rmSync(f.file)
    symlinkSync(outside, f.file)
    expect(() => readAgentDesktopRefTarget(f.root, 'session-123', '@snapshot:e1')).toThrow()
    rmSync(f.file)
    writeFileSync(f.file, ' '.repeat(1_048_577))
    expect(() => readAgentDesktopRefTarget(f.root, 'session-123', '@snapshot:e1')).toThrow()
  })
})
