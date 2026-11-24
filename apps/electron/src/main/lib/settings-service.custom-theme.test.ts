import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeJsonFileAtomic } from './safe-file'
import { DEFAULT_CUSTOM_THEME } from '../../types'

async function scenario(path: string, source: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn([process.execPath, '--eval', `
    import { mock } from 'bun:test';
    import { readFileSync } from 'node:fs';
    const path=${JSON.stringify(path)};
    mock.module(${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))},()=>({getSettingsPath:()=>path}));
    const {getSettings,updateSettings}=await import(${JSON.stringify(join(import.meta.dir, 'settings-service.ts'))});
    ${source}
  `], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(stderr)
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
}

describe('自定义主题设置持久化', () => {
  test('Given 旧配置和非法颜色 When 保存并重载 Then 保留自定义模式、规范颜色及其他设置', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'carpus-custom-theme-'))
    const path = join(directory, 'settings.json')
    try {
      expect(await scenario(path, 'console.log(JSON.stringify({mode:getSettings().themeMode,colors:getSettings().customTheme}))'))
        .toEqual({ mode: 'dark', colors: DEFAULT_CUSTOM_THEME })

      writeJsonFileAtomic(path, { themeMode: 'light', sendWithCmdEnter: true })
      const saved = await scenario(path, `
        updateSettings({themeMode:'custom',customTheme:{accent:'#a1b2c3',background:'bad',foreground:'#EBDBB2'}});
        const settings=getSettings(),disk=JSON.parse(readFileSync(path,'utf8'));
        console.log(JSON.stringify({mode:settings.themeMode,colors:settings.customTheme,disk:disk.customTheme,cmd:settings.sendWithCmdEnter}));
      `)
      expect(saved).toEqual({
        mode: 'custom',
        colors: { accent: '#A1B2C3', background: DEFAULT_CUSTOM_THEME.background, foreground: '#EBDBB2' },
        disk: { accent: '#A1B2C3', background: DEFAULT_CUSTOM_THEME.background, foreground: '#EBDBB2' },
        cmd: true,
      })

      expect(await scenario(path, 'console.log(JSON.stringify({mode:getSettings().themeMode,colors:getSettings().customTheme}))'))
        .toEqual({ mode: 'custom', colors: saved.colors })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
