import { describe, expect, test } from 'bun:test'
import { YAML } from 'bun'
import { readFileSync } from 'node:fs'
import { GITHUB_RELEASE_REPO } from '../src/main/lib/github-release-client'

interface Step { run?: string; uses?: string; 'working-directory'?: string; with?: Record<string, string> }
interface Job { needs?: string; if?: string; env?: Record<string, string>; outputs?: Record<string, string>; steps: Step[]; strategy?: { matrix: { include: { target: string }[] } }; permissions?: Record<string, string> }
const workflow = YAML.parse(readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')) as {
  on: { push: { tags: string[] }; workflow_dispatch?: object };  jobs: Record<string, Job>; permissions: Record<string, string>
}
describe('Given 标签发布工作流', () => {
  test('When 推送版本标签 Then 并行构建双架构 Mac、Windows 与 Linux', () => {
    expect(workflow.on.push.tags).toEqual(['v*'])
    expect(workflow.jobs.build!.strategy!.matrix.include.map(item => item.target)).toEqual(['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'])
    expect(workflow.jobs.build!.needs).toBe('check')
  })
  test('When 手动构建 main Then 按应用版本校验产物但不公开 Release', () => {
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(workflow.jobs.check!.outputs?.release_tag).toBe('${{ steps.version.outputs.release_tag }}')
    expect(workflow.jobs.build!.env?.RELEASE_TAG).toBe('${{ needs.check.outputs.release_tag }}')
    expect(workflow.jobs.publish!.if).toBe("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')")
    const validation = workflow.jobs.check!.steps.find(step => step.run?.includes('releaseVersion('))!
    expect(validation.run).toContain('pkg.version')
    expect(validation.run).toContain('GITHUB_OUTPUT')
  })
  test('When 执行打包命令 Then 在 Electron 目录运行且禁止提前发布', () => {
    const step = workflow.jobs.build!.steps.find(step => step.run?.includes('electron-builder'))!
    expect(step['working-directory']).toBe('apps/electron')
    expect(step.run).toContain('bunx --no-install')
    expect(step.run).toContain('--publish never')
    expect(workflow.permissions.contents).toBe('read')
    expect(workflow.jobs.publish!.permissions!.contents).toBe('write')
  })
  test('When 任一构建失败 Then 发布 job 不执行；发布前重新合并校验', () => {
    const job = workflow.jobs.publish!
    expect(job.needs).toBe('build')
    const commands = job.steps.flatMap(step => step.run ? [step.run] : [])
    expect(commands[0]).toContain('release-artifacts.ts assemble')
    expect(commands[1]).toContain('publish-release.ts')
    const script = readFileSync(new URL('./publish-release.ts', import.meta.url), 'utf8')
    expect(script.indexOf("await verifyDownloaded(downloaded, checksums)")).toBeLessThan(script.indexOf("'--draft=false'"))
  })
  test('When 构建 App 与加载更新日志 Then 指向同一 Gamma 仓库', () => {
    const config = YAML.parse(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')) as { publish: { owner: string; repo: string } }
    expect(config.publish).toMatchObject({ owner: 'xhslam', repo: 'Gamma' })
    expect(config.publish).toMatchObject(GITHUB_RELEASE_REPO)
    const about = readFileSync(new URL('../src/renderer/components/settings/AboutSettings.tsx', import.meta.url), 'utf8')
    expect(about).toContain(`https://github.com/${GITHUB_RELEASE_REPO.owner}/${GITHUB_RELEASE_REPO.repo}/releases`)
  })
})
