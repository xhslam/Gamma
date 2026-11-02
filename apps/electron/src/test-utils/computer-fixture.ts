import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ComputerBinding, ComputerRiskPolicy } from '@gamma/shared'
import { ComputerController, type ComputerHost } from '../main/lib/computer-controller'
import { ComputerAuthorizationManager } from '../main/lib/computer-authorization-manager'
import type { InstalledComputerApp } from '../main/lib/computer-installed-app'
import { parseAgentDesktopEnvelope } from '../main/lib/agent-desktop-protocol'

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
  installedApp?: InstalledComputerApp
  call?: (method: string, params: Record<string, unknown>) => Promise<unknown>
} = {}) {
  const calls: ComputerFixtureCall[] = []
  const actions: Record<string, unknown>[] = []
  const auth = new ComputerAuthorizationManager(join(tmpdir(), `gamma-computer-${randomUUID()}.json`))
  auth.updatePreferences({ riskPolicy: options.policy ?? 'relaxed', headedAllowed: options.headed ?? true })
  if (options.consent !== false) auth.updatePreferences({ shareObservations: true })
  if (options.trustedApps !== false) {
    for (const [name, bundle] of [['Notes', 'com.apple.Notes'], ['Safari', 'com.apple.Safari']] as const) {
      auth.recordAppDecision(name, 'always', bundle)
      auth.recordAppDecision(name, 'always')
    }
  }
  let now = Date.now()
  const host: ComputerHost = {
    async execute(namespace, args) {
      const method = args[0] === '--headed' ? (args[1] ?? 'version') : (args[0] ?? 'version')
      calls.push({ method, params: { namespace, args } })
      if (!['screenshot', 'snapshot', 'status', 'permissions', 'version', 'list-apps', 'list-windows'].includes(method)) actions.push({ kind: method, args })
      const override = await options.call?.(method, { namespace, args })
      if (override && typeof override === 'object' && 'version' in override) return parseAgentDesktopEnvelope(JSON.stringify(override))
      let data: unknown = override
      if (method === 'status' || method === 'permissions') {
        const raw = override && typeof override === 'object' && 'permissions' in override ? override.permissions : undefined
        const permissions = raw && typeof raw === 'object' ? raw : {}
        data = { permissions: {
          accessibility: { state: 'accessibility' in permissions && permissions.accessibility === false ? 'denied' : 'granted' },
          screen_recording: { state: 'screen' in permissions && permissions.screen === true ? 'granted' : 'denied' },
        } }
      }
      if (data === undefined && method === 'list-apps') data = { apps: [
        { name: 'Notes', pid: 34, bundle_id: 'com.apple.Notes', process_instance: 'fixture-notes' },
        { name: 'Safari', pid: 35, bundle_id: 'com.apple.Safari', process_instance: 'fixture-safari' },
      ].filter(app => !args.some(arg => arg.startsWith('--app=')) || args.some(arg => arg === `--app=${app.name}` || arg === `--app=${app.bundle_id}`)) }
      if (data === undefined && method === 'list-windows') data = [{ id: '12', app_name: 'Notes', pid: 34, process_instance: 'fixture-notes', title: 'Fixture' }]
      if (data === undefined && method === 'screenshot') data = tinyComputerImage
      return { version: '2.5', ok: true, command: method, data: data ?? {} }
    },
    async resolveInstalledApp() { return options.installedApp },
    async resolveRefTarget(namespace, ref) {
      calls.push({ method: 'resolveRefTarget', params: { namespace, ref } })
      if (ref === '@snapshot:e2') return { appName: 'Safari', pid: 35, processInstance: 'fixture-safari' }
      if (ref !== '@snapshot:e1') throw new Error('引用不属于本轮私有快照')
      return { appName: 'Notes', pid: 34, processInstance: 'fixture-notes' }
    },
    async call(method, params = {}) {
      calls.push({ method, params })
      return options.call?.(method, params)
    },
    async terminate(namespace) { calls.push({ method: 'terminate', params: { namespace } }); await options.call?.('terminate', { namespace }) },
  }
  const controller = new ComputerController(host, { supported: true, now: () => now, authManager: auth })
  controller.beginRun(computerTestBinding, options.source ?? 'user', options.vision ?? true)
  return { controller, auth, calls, actions, binding: computerTestBinding, advance: (ms: number) => { now += ms } }
}
