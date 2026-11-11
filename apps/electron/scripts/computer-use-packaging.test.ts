import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const config = readFileSync(join(import.meta.dir, '../electron-builder.yml'), 'utf8')
const app = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8')) as { scripts: Record<string, string> }
const section = (name: string): string => config.split(`\n${name}:\n`)[1]?.split(/\n[A-Za-z][A-Za-z-]*:/)[0] ?? ''

describe('Given gammaComputerUse 与 Gamma 独立更新', () => {
  test('When 打包 macOS Gamma Then 不复制或重新签名桌面权限组件', () => {
    expect(section('extraResources')).not.toContain('agent-desktop')
    expect(section('mac')).not.toContain('agent-desktop')
    expect(config).not.toContain('from: /Applications/gammaComputerUse.app')
    expect(section('mac')).not.toContain('gammaComputerUse.app')
  })
  test('When 打包 Windows 或 Linux Then 仍包含对应平台桌面引擎', () => {
    expect(section('win')).toContain('from: resources/agent-desktop')
    expect(section('linux')).toContain('from: resources/agent-desktop')
  })
  test('When 常规构建 Gamma Then 不安装或自动更新独立组件', () => {
    for (const name of ['build', 'dev:electron', 'dist:mac']) {
      expect(app.scripts[name]).not.toContain('install:computer-use')
      expect(app.scripts[name]).not.toContain('build:computer-use')
    }
    expect(app.scripts['build:computer-use']).toBe('bun run scripts/build-gamma-computer-use.ts')
    expect(app.scripts['install:computer-use']).toBe('bun run scripts/build-gamma-computer-use.ts --install')
  })
})
