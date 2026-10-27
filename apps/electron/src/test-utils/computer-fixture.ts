import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ComputerAXContext, ComputerBinding, ComputerRiskPolicy } from '@gamma/shared'
import { ComputerController, type ComputerHost } from '../main/lib/computer-controller'
import { ComputerAuthorizationManager } from '../main/lib/computer-authorization-manager'

export const computerTestBinding: ComputerBinding = { sessionId: 'computer-test', runId: 'run-1', channelId: 'test-channel', modelId: 'vision', routeIdentity: 'local-fixture' }
export const tinyComputerImage = { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0m0AAAAASUVORK5CYII=', mimeType: 'image/png', width: 1, height: 1 }
export interface ComputerFixtureCall { method: string; params: Record<string, unknown> }
export function createComputerFixture(options: {
  trustedApps?: boolean
  consent?: boolean
  source?: string
  vision?: boolean
  policy?: ComputerRiskPolicy
  call?: (method: string, params: Record<string, unknown>) => Promise<unknown>
} = {}) {
  const calls: ComputerFixtureCall[] = []
  const actions: Record<string, unknown>[] = []
  const auth = new ComputerAuthorizationManager(join(tmpdir(), `gamma-computer-${randomUUID()}.json`))
  // 旧测试显式验证标准策略；默认产品策略与宽松路径另行覆盖。
  auth.updatePreferences({ riskPolicy: options.policy ?? 'standard' })
  if (options.consent !== false) auth.updatePreferences({ shareObservations: true })
  if (options.trustedApps !== false) for (const [name, bundle] of [['Notes', 'com.apple.Notes'], ['Safari', 'com.apple.Safari']]) auth.recordAppDecision(name!, 'always', bundle!)
  let now = Date.now()
  let frontApp = { appName: 'Notes', bundleId: 'com.apple.Notes' }
  let context: ComputerAXContext | undefined
  const target = { windowId: 12, pid: 34, processIdentity: 'fixture-process', bundleId: 'com.apple.Notes', title: 'Fixture', bounds: { x: 0, y: 0, width: 800, height: 600 } }
  const host: ComputerHost = {
    async call(method, params = {}) {
      calls.push({ method, params })
      const override = await options.call?.(method, params)
      if (override !== undefined) return override
      if (method === 'status' || method === 'requestPermission') return { supported: true, permissions: { accessibility: true, screen: true, listen: true, post: true } }
      if (method === 'resolveApp') {
        const safari = String(params.appName).toLowerCase().includes('safari')
        return safari ? { appName: 'Safari', bundleId: 'com.apple.Safari' } : { appName: 'Notes', bundleId: 'com.apple.Notes' }
      }
      if (method === 'select') return { scope: 'main-display' }
      if (method === 'observe') return { observationId: `native-${calls.length}`, epoch: params.epoch, image: tinyComputerImage, ax: 'FIXTURE_AX', targetApp: { name: frontApp.appName, bundleId: frontApp.bundleId } }
      if (method === 'listWindows') return { windows: [target] }
      if (method === 'prepare') {
        const action = params.action as Record<string, unknown>
        const opened = action.bundleId ?? action.appName
        const targetApp = action.kind === 'open_app' ? opened === 'com.apple.Safari' ? { appName: 'Safari', bundleId: 'com.apple.Safari' } : { appName: 'Notes', bundleId: 'com.apple.Notes' } : frontApp
        return { preparationId: String(params.actionId), ...targetApp, context: context ?? { role: frontApp.appName === 'Safari' ? 'AXTextField' : 'AXTextArea', description: frontApp.appName === 'Safari' ? 'Address and search bar' : 'Note body', isTrustedSearch: frontApp.appName === 'Safari' } }
      }
      if (method === 'confirmation') return { waiting: params.waiting }
      if (method === 'perform') {
        const action = params.action as Record<string, unknown>
        actions.push(action)
        if (action.kind === 'open_app') frontApp = (action.bundleId ?? action.appName) === 'com.apple.Safari' ? { appName: 'Safari', bundleId: 'com.apple.Safari' } : { appName: 'Notes', bundleId: 'com.apple.Notes' }
        return { actionId: params.actionId, outcome: 'dispatched-unverified', message: '合成宿主只证明投递' }
      }
      throw new Error(`未知 fixture 方法：${method}`)
    },
    async terminate() { calls.push({ method: 'terminate', params: {} }) },
  }
  const controller = new ComputerController(host, { supported: true, now: () => now, authManager: auth })
  controller.beginRun(computerTestBinding, options.source ?? 'user', options.vision ?? true)
  return { controller, auth, calls, actions, binding: computerTestBinding, setContext: (value: ComputerAXContext) => { context = value }, advance: (ms: number) => { now += ms } }
}
