import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'
import { normalizeWorkbenchDensity } from '../../types/settings'

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

function temporarySettings(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'gamma-density-'))
  return { directory, path: join(directory, 'settings.json') }
}

describe('工作台密度设置', () => {
  test('Given 缺失、旧版、损坏或非法配置 When 加载 Then 默认紧凑', async () => {
    const { directory, path } = temporarySettings()
    try {
      const read = () => scenario(path, 'console.log(JSON.stringify({density:getSettings().workbenchDensity}))')
      expect(await read()).toEqual({ density: 'compact' })
      writeJsonFileAtomic(path, { themeMode: 'light' })
      expect(await read()).toEqual({ density: 'compact' })
      writeTextFileAtomic(path, '{错误')
      expect(await read()).toEqual({ density: 'compact' })
      for (const value of [null, 'wide', 36, {}, true]) expect(normalizeWorkbenchDensity(value)).toBe('compact')
      writeJsonFileAtomic(path, { workbenchDensity: 'wide' })
      expect(await read()).toEqual({ density: 'compact' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('Given 用户已有特殊主题 When 切换密度并重载 Then 原子保存且不覆盖主题和其他设置', async () => {
    const { directory, path } = temporarySettings()
    try {
      writeJsonFileAtomic(path, { themeMode: 'special', themeStyle: 'ocean-dark', sendWithCmdEnter: true })
      expect(await scenario(path, `
        updateSettings({workbenchDensity:'comfortable'});
        updateSettings({notificationsEnabled:false});
        const settings=getSettings(), saved=JSON.parse(readFileSync(path,'utf8'));
        console.log(JSON.stringify({density:settings.workbenchDensity,saved:saved.workbenchDensity,mode:settings.themeMode,style:settings.themeStyle,cmd:settings.sendWithCmdEnter}));
      `)).toEqual({ density: 'comfortable', saved: 'comfortable', mode: 'special', style: 'ocean-dark', cmd: true })
      expect(await scenario(path, `updateSettings({workbenchDensity:'invalid'});console.log(JSON.stringify({density:getSettings().workbenchDensity}))`)).toEqual({ density: 'compact' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('Given 原子写路径不可写 When 保存 Then 抛错且原设置不变', async () => {
    const { directory, path } = temporarySettings()
    try {
      writeJsonFileAtomic(path, { workbenchDensity: 'comfortable', themeMode: 'light' })
      mkdirSync(path + '.tmp')
      expect(await scenario(path, `
        const before=readFileSync(path,'utf8');let failed=false;
        try{updateSettings({workbenchDensity:'compact'})}catch{failed=true}
        console.log(JSON.stringify({failed,unchanged:before===readFileSync(path,'utf8'),density:getSettings().workbenchDensity}));
      `)).toEqual({ failed: true, unchanged: true, density: 'comfortable' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
