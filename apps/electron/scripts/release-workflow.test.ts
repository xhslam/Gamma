import { describe, expect, test } from 'bun:test'
import { YAML } from 'bun'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESIGN_BUNDLE_REVISION } from '../../../packages/shared/src/types/design'
import { GITHUB_RELEASE_REPO } from '../src/main/lib/github-release-client'
import { digest } from './release-artifacts'

interface Step { id?: string; if?: string; 'continue-on-error'?: boolean; run?: string; uses?: string; 'working-directory'?: string; with?: Record<string, string> }
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
  test('When 上游设计资源准备失败 Then 构建前恢复已发布的固定快照', () => {
    const steps = workflow.jobs.build!.steps
    const prepare = steps.findIndex(step => step.run === 'bun run prepare:design')
    const restore = steps.findIndex(step => step.run?.endsWith('/restore-release-design-bundle.sh'))
    const build = steps.findIndex(step => step.run === 'bun run electron:build')
    expect(prepare).toBeGreaterThanOrEqual(0)
    expect(steps[prepare]).toMatchObject({ id: 'design', 'continue-on-error': true })
    expect(restore).toBeGreaterThan(prepare)
    expect(steps[restore]!.if).toBe("steps.design.outcome == 'failure'")
    expect(build).toBeGreaterThan(restore)
  })
  test.skipIf(process.platform === 'win32')('When 恢复旧 Gamma 归档 Then 校验摘要和标记后转换为 Carpus 标记', async () => {
    const root = mkdtempSync(join(tmpdir(), 'carpus-legacy-design-'))
    try {
      const scripts = join(root, 'apps/electron/scripts')
      mkdirSync(scripts, { recursive: true })
      for (const relative of ['packages', 'apps/electron/src', 'apps/electron/scripts/release-artifacts.ts']) {
        symlinkSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), join(root, relative))
      }
      const zip = join(root, 'fixture.zip')
      const legacy = `Gamma.app/Contents/Resources/design-bundle/${DESIGN_BUNDLE_REVISION}/.gamma-design-revision`
      mkdirSync(dirname(join(root, legacy)), { recursive: true })
      const bin = join(root, 'bin')
      mkdirSync(bin)
      writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
set -eu
[[ "$#" == 9 && "$*" == "release download v0.19.272 --repo xhslam/Carpus --pattern Gamma-0.19.272-mac-arm64.zip --output $9" ]]
cp "$TEST_DESIGN_ARCHIVE" "$9"
`, { mode: 0o755 })
      const source = readFileSync(new URL('./restore-release-design-bundle.sh', import.meta.url), 'utf8')
      const script = join(scripts, 'restore-release-design-bundle.sh')
      const restored = join(root, 'apps/electron/resources/design-bundle', DESIGN_BUNDLE_REVISION)
      for (const mode of ['digest-mismatch', 'marker-mismatch', 'valid']) {
        writeFileSync(join(root, legacy), mode === 'marker-mismatch' ? 'wrong-revision\n' : `${DESIGN_BUNDLE_REVISION}\n`)
        rmSync(zip, { force: true })
        expect(Bun.spawnSync(['zip', '-q', zip, legacy], { cwd: root }).exitCode).toBe(0)
        // 只为测试夹具替换真实发行包的固定摘要，仍由脚本实际计算和校验。
        const fixtureDigest = mode === 'digest-mismatch' ? '0'.repeat(64) : await digest(zip, 'sha256')
        writeFileSync(script, source.replace(/^seed_sha256=[a-f0-9]{64}$/m, `seed_sha256=${fixtureDigest}`))
        const result = Bun.spawnSync(['bash', script], {
          cwd: root, env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`, RUNNER_OS: 'Linux', TEST_DESIGN_ARCHIVE: zip },
        })
        if (mode !== 'valid') {
          expect(result.exitCode).toBe(1)
          expect(result.stderr.toString()).toContain(mode === 'digest-mismatch' ? 'SHA-256 不匹配' : '快照标记不匹配')
          expect(existsSync(restored)).toBe(false)
        } else {
          expect(result.stderr.toString()).toBe('')
          expect(result.exitCode).toBe(0)
          expect(readFileSync(join(restored, '.carpus-design-revision'), 'utf8').trim()).toBe(DESIGN_BUNDLE_REVISION)
          expect(existsSync(join(restored, '.gamma-design-revision'))).toBe(false)
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
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
  test('When 构建 App 与加载更新日志 Then 指向同一 Carpus 仓库', () => {
    const config = YAML.parse(readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')) as { publish: { owner: string; repo: string } }
    expect(config.publish).toMatchObject({ owner: 'xhslam', repo: 'Carpus' })
    expect(config.publish).toMatchObject(GITHUB_RELEASE_REPO)
    const about = readFileSync(new URL('../src/renderer/components/settings/AboutSettings.tsx', import.meta.url), 'utf8')
    expect(about).toContain(`https://github.com/${GITHUB_RELEASE_REPO.owner}/${GITHUB_RELEASE_REPO.repo}/releases`)
  })
})
