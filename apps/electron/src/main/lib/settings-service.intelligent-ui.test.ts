import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'

async function scenario(path: string, code: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn([process.execPath, '--eval', `
    import { mock } from 'bun:test'; import { readFileSync } from 'node:fs';
    mock.module(${JSON.stringify(join(import.meta.dir, 'config-paths.ts'))}, () => ({getSettingsPath:()=>${JSON.stringify(path)}}));
    const {getSettings,updateSettings}=await import(${JSON.stringify(join(import.meta.dir, 'settings-service.ts'))});
    ${code}
  `], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exit) throw new Error(stderr)
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>
}

describe('Intelligent UI 设置持久化', () => {
  test('Given 缺失、旧配置、损坏或非法类型 When 读取 Then 默认关闭且只有 boolean true 启用', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamma-genui-settings-')), path = join(dir, 'settings.json')
    const read = () => scenario(path, 'console.log(JSON.stringify({enabled:getSettings().intelligentUiEnabled}))')
    try {
      expect((await read()).enabled).toBe(false)
      for (const value of [undefined, null, 'true', 1, false, true]) {
        writeJsonFileAtomic(path, { themeMode: 'dark', intelligentUiEnabled: value })
        expect((await read()).enabled).toBe(value === true)
      }
      writeTextFileAtomic(path, '{bad')
      expect((await read()).enabled).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('Given 配置 When 开关保存及写入失败 Then 原子更新、保留其他字段且失败不改变原文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamma-genui-settings-')), path = join(dir, 'settings.json')
    try {
      writeJsonFileAtomic(path, { themeMode: 'dark', intelligentUiEnabled: false })
      expect(await scenario(path, 'updateSettings({intelligentUiEnabled:true});console.log(JSON.stringify({enabled:getSettings().intelligentUiEnabled,theme:getSettings().themeMode}))')).toEqual({ enabled: true, theme: 'dark' })
      mkdirSync(path + '.tmp')
      expect(await scenario(path, `const before=readFileSync(${JSON.stringify(path)},'utf8');let threw=false;try{updateSettings({intelligentUiEnabled:false})}catch{threw=true};console.log(JSON.stringify({threw,unchanged:before===readFileSync(${JSON.stringify(path)},'utf8')}))`)).toEqual({ threw: true, unchanged: true })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
