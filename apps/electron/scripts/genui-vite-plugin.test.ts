import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { resolveGenuiHostAdapter } from './genui-vite-plugin'

const adapters = resolve('src/renderer/components/intelligent-ui')
const cases = [
  ['../primitive-adapter.ts', 'genui-primitives.tsx'],
  ['../achievement-store.ts', 'genui-achievements.ts'],
  ['../file-link-context.tsx', 'genui-file-link.tsx'],
] as const

describe('Given 仅使用 GenUI embed、不装载 DSH 插件运行时的宿主适配', () => {
  test('When Windows Node 路径与 Vite importer 的斜杠不同 Then 三个宿主模块都命中 Gamma 实现', () => {
    const client = 'D:\\a\\Gamma\\Gamma\\node_modules\\@changfenhuang\\dsh-genui\\src\\client'
    const importer = 'D:/a/Gamma/Gamma/node_modules/@changfenhuang/dsh-genui/src/client/embed.ts'
    for (const [id, target] of cases) expect(resolveGenuiHostAdapter(id, importer, client, adapters)).toBe(resolve(adapters, target))
  })
  test('When macOS/Linux 解析同一适配 Then 保持 POSIX 路径行为', () => {
    const client = '/repo/node_modules/@changfenhuang/dsh-genui/src/client'
    for (const [id, target] of cases) expect(resolveGenuiHostAdapter(id, `${client}/components/card.tsx`, client, adapters)).toBe(resolve(adapters, target))
  })
  test('When Windows 大小写、查询后缀或模块分隔符不同 Then 仍命中同一宿主实现', () => {
    const client = 'D:\\repo\\src\\client\\'
    expect(resolveGenuiHostAdapter('..\\primitive-adapter.ts?import', 'd:/REPO/src/client/embed.ts?v=1', client, adapters)).toBe(resolve(adapters, 'genui-primitives.tsx'))
  })
  test('When 其他包、相似前缀目录或未知模块请求适配 Then 不错误劫持解析', () => {
    const client = '/repo/src/client'
    for (const importer of [undefined, '/repo/src/client-other/embed.ts', '/repo/src/another/embed.ts']) {
      expect(resolveGenuiHostAdapter('../primitive-adapter.ts', importer, client, adapters)).toBeUndefined()
    }
    expect(resolveGenuiHostAdapter('../other.ts', `${client}/embed.ts`, client, adapters)).toBeUndefined()
  })
})
