import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

/** 在独立上下文替换运行时依赖，避免 mock.module 污染同一 Bun 进程的其他测试。 */
export function loadIsolatedModule<T>(
  path: string,
  dependencies: Record<string, unknown>,
  globals: Record<string, unknown> = {},
): T {
  const module = { exports: {} }
  const { code } = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' })
  runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    __dirname: '/test/dist',
    process,
    require: (name: string): unknown => {
      if (!(name in dependencies)) throw new Error(`未配置隔离测试依赖：${name}`)
      return dependencies[name]
    },
    ...globals,
  }, { filename: path })
  return module.exports as T
}
