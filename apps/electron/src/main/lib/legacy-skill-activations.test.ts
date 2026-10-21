import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SkillActivation } from '@gamma/shared'
import { normalizeLegacyBuiltinSkillActivation } from './legacy-skill-activations'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gamma-skill-activation-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
function activation(state = 'skills'): SkillActivation {
  return { slug: 'proma-build-ai-app', name: 'proma-build-ai-app', filePath: join(root, 'demo', state, 'proma-build-ai-app', 'SKILL.md'), workspaceSlug: 'demo', workspaceSkillPath: 'proma-build-ai-app/SKILL.md', sources: ['explicit'] }
}
function current(state = 'skills'): string {
  const target = join(root, 'demo', state, 'gamma-build-ai-app')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), 'name: gamma-build-ai-app')
  return target
}
describe('历史 Skill 会话引用', () => {
  for (const state of ['skills', 'skills-inactive']) test(`Given ${state} 已迁移 When 读取引用 Then 更新受管名称与路径`, () => {
    const target = current(state)
    const original = activation(state)
    const result = normalizeLegacyBuiltinSkillActivation(original, root)
    expect(result).toEqual({ ...original, slug: 'gamma-build-ai-app', name: 'gamma-build-ai-app', filePath: join(target, 'SKILL.md'), workspaceSkillPath: 'gamma-build-ai-app/SKILL.md' })
    expect(original.slug).toBe('proma-build-ai-app')
    expect(normalizeLegacyBuiltinSkillActivation(result, root)).toBe(result)
  })
  test('Given 旧目录仍存在或新目标缺失 When 读取引用 Then 保留旧引用', () => {
    const original = activation()
    expect(normalizeLegacyBuiltinSkillActivation(original, root)).toBe(original)
    current()
    mkdirSync(join(root, 'demo', 'skills', original.slug))
    expect(normalizeLegacyBuiltinSkillActivation(original, root)).toBe(original)
  })
  test('Given 外部、越界或矛盾工作区引用 When 读取 Then 不替换用户引用', () => {
    current()
    for (const original of [
      { ...activation(), filePath: '/project/skills/proma-build-ai-app/SKILL.md' },
      { ...activation(), filePath: join(root, '..', 'outside', 'skills', 'proma-build-ai-app', 'SKILL.md') },
      { ...activation(), workspaceSlug: 'other' },
      { ...activation(), workspaceSkillPath: '../proma-build-ai-app/SKILL.md' },
    ]) expect(normalizeLegacyBuiltinSkillActivation(original, root)).toBe(original)
  })
  test('Given 新 Skill 指向外部符号链接 When 读取 Then 不把该文件视为成功迁移', () => {
    const target = current()
    rmSync(join(target, 'SKILL.md'))
    const external = join(root, 'external.md')
    writeFileSync(external, '用户文件')
    symlinkSync(external, join(target, 'SKILL.md'))
    const original = activation()
    expect(normalizeLegacyBuiltinSkillActivation(original, root)).toBe(original)
  })
})


test('Given JSONL 激活数组含损坏项 When 归一 Then 原样保留且不影响其余引用', () => {
  current()
  for (const value of [null, {}, { slug: 3 }, { ...activation(), filePath: {} }, { ...activation(), workspaceSkillPath: 4 }, { ...activation(), workspaceSlug: [] }]) {
    const corruptedActivation = value as unknown as SkillActivation
    expect(normalizeLegacyBuiltinSkillActivation(corruptedActivation, root)).toBe(corruptedActivation)
  }
  expect(normalizeLegacyBuiltinSkillActivation(activation(), root).slug).toBe('gamma-build-ai-app')
})
