import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

interface InstallDependencies {
  run: () => number
  sleep: (milliseconds: number) => Promise<void>
  warn: (message: string) => void
}

/** 在浏览器回归前准备 Electron，避免首次 require 时隐式下载且无法重试。 */
export async function installElectron(dependencies: InstallDependencies): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const status = dependencies.run()
    if (status === 0) return
    if (attempt === 3) throw new Error(`Electron 安装连续失败 3 次，退出码 ${status}`)
    dependencies.warn(`Electron 下载或安装失败，${attempt * 10} 秒后重试（${attempt}/3）`)
    await dependencies.sleep(attempt * 10_000)
  }
}

if (import.meta.main) {
  const require = createRequire(import.meta.url)
  const installer = require.resolve('electron/install.js')
  await installElectron({
    run: () => spawnSync('node', [installer], { stdio: 'inherit', env: process.env }).status ?? 1,
    sleep: milliseconds => Bun.sleep(milliseconds),
    warn: message => console.warn(message),
  })
}
