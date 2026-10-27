import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { createRequire } from 'node:module'
import pkg from './package.json' with { type: 'json' }

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: [
      // xterm 6 的 ESM 模式枚举经 tree-shaking 后产生未声明变量，DECRQM 会中断解析。
      // 使用同版本官方 CJS 构建；精确匹配保留 @xterm/xterm/css/xterm.css 子路径。
      { find: /^@xterm\/xterm$/, replacement: require.resolve('@xterm/xterm') },
      { find: '@/types', replacement: resolve(__dirname, 'src/types') },
      { find: '@', replacement: resolve(__dirname, 'src/renderer') },
    ],
  },
  server: {
    // Chromium can resolve localhost to IPv4 while Vite binds only ::1 on macOS.
    // Use the same explicit IPv4 loopback address as Electron's dev windows.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true, // 确保使用指定端口，如被占用则报错
    open: false,
  },
})
