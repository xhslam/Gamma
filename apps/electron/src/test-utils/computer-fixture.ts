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
  headed?: boolean
  call?: (method: string, params: Record<string, unknown>) => Promise<unknown>
} = {}) {
  const calls: ComputerFixtureCall[] = []
  const actions: Record<string, unknown>[] = []
  const auth = new ComputerAuthorizationManager(join(tmpdir(), `gamma-computer-${randomUUID()}.json`))
  // 旧测试显式验证标准策略；默认产品策略与宽松路径另行覆盖。
  auth.updatePreferences({ riskPolicy: options.policy ?? 'standard', headedAllowed: options.headed ?? true })
  if (options.consent !== false) auth.updatePreferences({ shareObservations: true })
  if (options.trustedApps !== false) {
    for (const [name, bundle] of [['Notes', 'com.apple.Notes'], ['Safari', 'com.apple.Safari']]) {
      auth.recordAppDecision(name!, 'always', bundle!)
      auth.recordAppDecision(name!, 'always')
    }
  }
  let now = Date.now()
  let accessibility = true
  let frontApp = { appName: 'Notes', bundleId: 'com.apple.Notes' }
  let context: ComputerAXContext | undefined
  const target = { windowId: 12, pid: 34, processIdentity: 'fixture-process', bundleId: 'com.apple.Notes', title: 'Fixture', bounds: { x: 0, y: 0, width: 800, height: 600 } }
  const host: ComputerHost = {
    async execute(namespace, args, signal, timeoutMs) {
      const method = args[0] === '--headed' ? (args[1] || 'version') : (args[0] || 'version')
      calls.push({ method, params: { namespace, args } })
      if (method !== 'screenshot' && method !== 'status' && method !== 'permissions' && method !== 'version') {
        const kind = method === 'press' ? 'key' : method === 'focus-window' ? 'focus_window' : method
        const bundleId = method === 'launch'
          ? (args.includes('Notes') ? 'com.apple.Notes' : args.includes('Safari') ? 'com.apple.Safari' : undefined)
          : undefined
        const text = method === 'type' ? (args[2] ?? args[1]) : undefined
        actions.push({ kind, args, bundleId, text })
      }
      if (options.call) {
        const override = await options.call(method, { namespace, args })
        if (override !== undefined) {
          if (override && typeof override === 'object' && 'version' in override) {
            return override as any
          }
          const obj = override as Record<string, unknown>
          if (obj.permissions) {
            const p = obj.permissions as Record<string, boolean>
            return {
              version: '2.5',
              ok: true,
              command: method,
              data: {
                permissions: {
                  accessibility: { state: (p.accessibility ?? accessibility) ? 'granted' : 'denied' },
                  screen_recording: { state: p.screen ? 'granted' : 'denied' },
                },
              },
            } as any
          }
          return {
            version: '2.5',
            ok: true,
            command: method,
            data: override,
          } as any
        }
      }
      if (method === 'status' || method === 'permissions') {
        return {
          version: '2.5',
          ok: true,
          command: method,
          data: {
            permissions: {
              accessibility: { state: accessibility ? 'granted' : 'denied' },
              screen_recording: { state: 'denied' },
            },
          },
        } as any
      }
      return {
        version: '2.5',
        ok: true,
        command: method,
        data: {},
      } as any
    },
    async call(method: string, params: Record<string, any> = {}) {
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
