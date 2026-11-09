import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'

/** 只适配官方 embed 的宿主接口，不装载 DSH 插件运行时。 */
export function genuiPlugin(): Plugin {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('@changfenhuang/dsh-genui/package.json'))
  const client = resolve(root, 'src/client')
  const adapters = resolve(import.meta.dirname, '../src/renderer/components/intelligent-ui')
  const files = ['mermaid.js', 'three.js', 'echarts-core.js', 'echarts-full.js', 'icons.js', 'maplibre.js']
  const resources = new Map(files.map(name => [name, readFileSync(resolve(root, 'lib/assets', name))]))
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) resources.set(name, readFileSync(resolve(root, name)))
  return {
    name: 'gamma-genui-embed',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === '@gamma/genui-embed') return resolve(client, 'embed.ts')
      if (!importer?.startsWith(client)) return
      if (id.endsWith('/primitive-adapter.ts')) return resolve(adapters, 'genui-primitives.tsx')
      if (id.endsWith('/achievement-store.ts')) return resolve(adapters, 'genui-achievements.ts')
      if (id.endsWith('/file-link-context.tsx')) return resolve(adapters, 'genui-file-link.tsx')
    },
    buildStart() {
      for (const [name, source] of resources) this.emitFile({ type: 'asset', fileName: `genui-assets/${name}`, source })
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        if (!path?.startsWith('/genui-assets/')) return next()
        const name = path.slice('/genui-assets/'.length)
        const source = resources.get(name)
        if (!source) { response.statusCode = 404; response.end(); return }
        response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8')
        response.end(source)
      })
    },
  }
}
