import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import { combineGammaInstructionFiles, createGammaManagedResourceLoaderOptions, createGammaProjectInstructionFilesOverride } from './pi-resource-loader-overrides'

describe('全局、工作区、项目规则叠加', () => {
  test('Given 三层冲突规则 When 拼接 Then 全部保留并按来源和优先级排序', () => {
    const global = { path: '/global/AGENTS.md', content: '回答英文' }
    const workspace = { path: '/workspace/AGENTS.md', content: '回答中文' }
    const project = { path: '/project/AGENTS.md', content: '回答法文' }
    const files = combineGammaInstructionFiles(workspace, [project], global)
    expect(files.map((file) => file.path)).toEqual([global.path, workspace.path, project.path])
    expect(files[0]?.content).toContain('来源：全局')
    expect(files[1]?.content).toContain('来源：工作区')
    expect(files[2]?.content).toContain('来源：项目')
    expect(files[0]?.content).toContain('全局 < 工作区 < 项目')
    expect(files[2]?.content).toContain('冲突时以靠后的规则为准')
    expect(files.map((file) => file.content).join('\n')).toContain('回答英文')
    expect(global.content).toBe('回答英文')
  })

  test('Given 无工作区或项目 When 拼接 Then 仍然加载全局规则', () => {
    expect(combineGammaInstructionFiles(undefined, [], { path: '/global/AGENTS.md', content: 'GLOBAL_ONLY' })[0]?.content).toContain('GLOBAL_ONLY')
    expect(combineGammaInstructionFiles(undefined, [])).toEqual([])
  })

  test('Given 全局和工作区别名指向同一文件 When 拼接 Then 只保留一次且位于后层', () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-rule-dedup-'))
    try {
      const original = join(root, 'AGENTS.md')
      const alias = join(root, 'workspace.md')
      writeFileSync(original, 'SAME_RULE')
      symlinkSync(original, alias)
      const files = combineGammaInstructionFiles({ path: alias, content: 'SAME_RULE' }, [], { path: original, content: 'SAME_RULE' })
      expect(files).toHaveLength(1)
      expect(files[0]?.content).toContain('来源：工作区')
      expect(files[0]?.path).toBe(alias)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('Given 显式三层规则 When Pi loader reload Then 最终上下文保留顺序和来源', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-rule-loader-'))
    try {
      const files = combineGammaInstructionFiles(
        { path: join(root, 'workspace.md'), content: 'WORKSPACE' },
        [{ path: join(root, 'project.md'), content: 'PROJECT' }],
        { path: join(root, 'global.md'), content: 'GLOBAL' },
      )
      const loader = new DefaultResourceLoader({
        cwd: root, agentDir: root, settingsManager: SettingsManager.inMemory(),
        ...createGammaManagedResourceLoaderOptions(),
        agentsFilesOverride: createGammaProjectInstructionFilesOverride(files),
      })
      await loader.reload()
      expect(loader.getAgentsFiles().agentsFiles).toEqual(files)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
