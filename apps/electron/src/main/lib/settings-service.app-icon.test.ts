import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'

interface SettingsScenarioResult {
  initialVariant: string
  updatedVariant?: string
  restoredVariant?: string
  savedVariant?: string
  backupVariant?: string
  themeMode?: string
  sendWithCmdEnter?: boolean
  didThrow?: boolean
  unchanged?: boolean
}

/** 用独立 Bun 进程隔离 config-paths mock，避免读写真实配置或污染其他测试。 */
async function runSettingsScenario(settingsPath: string, scenario: string): Promise<SettingsScenarioResult> {
  const source = `
    import { mock } from 'bun:test'
    import { readFileSync } from 'node:fs'
    const settingsPath = ${JSON.stringify(settingsPath)}
    mock.module(${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))}, () => ({ getSettingsPath: () => settingsPath }))
    const { getSettings, updateSettings } = await import(${JSON.stringify(join(import.meta.dir, 'settings-service.ts'))})
    ${scenario}
  `
  const child = Bun.spawn([process.execPath, '--eval', source], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`设置测试进程失败: ${stderr}`)
  const resultLine = stdout.trim().split('\n').at(-1)
  if (!resultLine) throw new Error('设置测试进程没有输出结果')
  return JSON.parse(resultLine) as SettingsScenarioResult
}

describe('应用图标偏好的读取与原子保存', () => {
  test('Given 旧图标偏好与其他设置 When 切换并重新读取 Then 回退默认、保存新款且保留其他字段与备份', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gamma-app-icon-settings-'))
    const settingsPath = join(tempDir, 'settings.json')
    try {
      writeJsonFileAtomic(settingsPath, { appIconVariant: 'black', themeMode: 'dark', sendWithCmdEnter: true })
      const result = await runSettingsScenario(settingsPath, `
        const initial = getSettings()
        const updated = updateSettings({ appIconVariant: 'emerald-gold' })
        const restored = getSettings()
        const saved = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        const backup = JSON.parse(readFileSync(settingsPath + '.bak', 'utf-8'))
        console.log(JSON.stringify({
          initialVariant: initial.appIconVariant,
          updatedVariant: updated.appIconVariant,
          restoredVariant: restored.appIconVariant,
          savedVariant: saved.appIconVariant,
          backupVariant: backup.appIconVariant,
          themeMode: restored.themeMode,
          sendWithCmdEnter: restored.sendWithCmdEnter,
        }))
      `)
      expect(result).toEqual({
        initialVariant: 'default', updatedVariant: 'emerald-gold', restoredVariant: 'emerald-gold',
        savedVariant: 'emerald-gold', backupVariant: 'black', themeMode: 'dark', sendWithCmdEnter: true,
      })
      expect(existsSync(settingsPath + '.tmp')).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('Given 缺失或损坏的配置 When 读取图标偏好 Then 返回默认白底黑银', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gamma-app-icon-settings-'))
    const settingsPath = join(tempDir, 'settings.json')
    const scenario = `console.log(JSON.stringify({ initialVariant: getSettings().appIconVariant }))`
    try {
      expect((await runSettingsScenario(settingsPath, scenario)).initialVariant).toBe('default')
      writeTextFileAtomic(settingsPath, '{无效 JSON')
      expect((await runSettingsScenario(settingsPath, scenario)).initialVariant).toBe('default')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('Given 原子写入临时文件不可写 When 保存新图标 Then 抛出错误且磁盘中的旧偏好完整保留', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gamma-app-icon-settings-'))
    const settingsPath = join(tempDir, 'settings.json')
    try {
      writeJsonFileAtomic(settingsPath, { appIconVariant: 'default', themeMode: 'dark' })
      mkdirSync(settingsPath + '.tmp')
      const result = await runSettingsScenario(settingsPath, `
        const before = readFileSync(settingsPath, 'utf-8')
        let didThrow = false
        try { updateSettings({ appIconVariant: 'emerald-gold' }) } catch { didThrow = true }
        console.log(JSON.stringify({ initialVariant: getSettings().appIconVariant, didThrow, unchanged: before === readFileSync(settingsPath, 'utf-8') }))
      `)
      expect(result).toEqual({ initialVariant: 'default', didThrow: true, unchanged: true })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
