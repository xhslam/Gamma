import { describe, expect, test } from 'bun:test'
import { installElectron } from './install-electron'
import { YAML } from 'bun'
import { readFileSync } from 'node:fs'

interface Step {
  uses?: string
  run?: string
  id?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, string>
}
interface Workflow {
  jobs: Record<string, { steps: Step[] }>
}

describe('Given 浏览器回归前显式安装 Electron', () => {
  for (const statuses of [[0], [1, 0], [1, 1, 0], [1, 1, 1]]) {
    test(`When 安装退出码为 ${statuses.join('/')} Then 成功即停止，最多尝试三次且最终失败不放行`, async () => {
      let calls = 0
      const delays: number[] = []
      const warnings: string[] = []
      const result = installElectron({
        run: () => statuses[calls++]!,
        sleep: async milliseconds => { delays.push(milliseconds) },
        warn: message => { warnings.push(message) },
      })
      if (statuses.at(-1) === 0) await result
      else await expect(result).rejects.toThrow('连续失败 3 次')
      expect(calls).toBe(statuses.length)
      expect(delays).toEqual([10_000, 20_000].slice(0, statuses.length - 1))
      expect(warnings).toHaveLength(statuses.length - 1)
    })
  }
})

describe('Given Release 下载门禁', () => {
  test('When 首次或再次安装 Bun 失败 Then 只重试失败步骤且最后一次失败阻断 job', () => {
    const action = YAML.parse(readFileSync(new URL('../../../.github/actions/setup-bun/action.yml', import.meta.url), 'utf8')) as { runs: { steps: Step[] } }
    const [first, second, last] = action.runs.steps
    expect(action.runs.steps).toHaveLength(3)
    expect(first?.['continue-on-error']).toBe(true)
    expect(second?.if).toBe(`steps.${first?.id}.outcome == 'failure'`)
    expect(second?.['continue-on-error']).toBe(true)
    expect(last?.if).toBe(`steps.${second?.id}.outcome == 'failure'`)
    expect(last?.['continue-on-error']).toBeUndefined()
    expect(action.runs.steps.every(step => step.with?.['bun-version'] === '1.3.14')).toBe(true)
  })

  test('When Release 安装依赖或执行 Electron Then 固定 Bun 且在构建前完成可重试下载', () => {
    const workflow = YAML.parse(readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')) as Workflow
    for (const job of Object.values(workflow.jobs)) {
      expect(job.steps.some(step => step.uses === './.github/actions/setup-bun')).toBe(true)
      expect(job.steps.some(step => step.uses === 'oven-sh/setup-bun@v2')).toBe(false)
      const consumer = job.steps.findIndex(step => step.run?.includes('bun run electron:build'))
      if (consumer < 0) continue
      const preparation = job.steps.findIndex(step => step.run?.includes('install-electron.ts'))
      const cache = job.steps.findIndex(step => step.uses === 'actions/cache@v4')
      expect(cache).toBeGreaterThan(-1)
      expect(preparation).toBeGreaterThan(cache)
      expect(preparation).toBeLessThan(consumer)
    }
  })
})
