import type { InstalledComputerApp } from './computer-installed-app'
import type { ComputerAuthorizationManager } from './computer-authorization-manager'
import type { AgentDesktopEnvelope, AgentDesktopInput } from './agent-desktop-protocol'

/** 来自私有 ref store 的原生身份，不接受模型提供的归属声明。 */
export interface ComputerRefTarget {
  appName: string
  pid: number
  processInstance: string
}
interface NativeApp {
  name: string
  pid: number
  bundleId?: string
  processInstance?: string
}
interface TargetHost {
  execute(namespace: string, args: string[], signal?: AbortSignal): Promise<AgentDesktopEnvelope>
  resolveInstalledApp?(identifier: string): Promise<InstalledComputerApp | undefined>
  resolveRefTarget?(namespace: string, ref: string): Promise<ComputerRefTarget>
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const key = (value: string): string => value.trim().toLowerCase()
const inventoryCommands = new Set(['list-apps', 'list-windows'])
const systemCommands = new Set(['status', 'permissions', 'version', 'skills', 'session', 'cursor-overlay', 'list-displays'])
const unresolved = (): Error => new Error('无法可靠确认实际目标应用；当前应用授权策略不允许未限定的桌面访问。请指定应用或重新观察并使用本轮限定引用。')

/**
 * 上游没有策略注入 API：以原生库存和私有 ref 身份核对目标，并把可限定的应用参数固定为规范身份。
 * 有拒绝规则/逐应用授权时，对全屏、物理输入和无法确定归属的全局操作失败关闭。
 * 原生仍负责在实际执行时校验 ref 的进程实例和窗口身份；这里不从 AX 标签推测归属。
 */
export async function authorizeComputerTarget(
  host: TargetHost,
  auth: ComputerAuthorizationManager,
  namespace: string,
  input: AgentDesktopInput,
  assertCurrent: () => void,
  signal?: AbortSignal,
): Promise<{ input: AgentDesktopInput; validate: () => void }> {
  const revisionAtStart = auth.getRevision()
  const unchanged = (): void => {
    assertCurrent()
    if (auth.getRevision() !== revisionAtStart) throw new Error('应用授权在核验期间已变更；本次动作未投递。')
  }
  const preferences = auth.getPreferences()
  const hasDeniedApps = Object.values(preferences.allowedApps).includes('denied')
  const restricted = preferences.riskPolicy !== 'relaxed' || hasDeniedApps
  const requestedApp = typeof input.app === 'string' ? input.app.trim() : undefined
  // 先按用户原文执行拒绝规则，不为已拒绝的显式请求启动原生查询。
  if (requestedApp && auth.checkAppAuthorization(requestedApp, undefined, namespace) === 'denied') {
    throw new Error(`用户已明确拒绝操作应用: ${requestedApp}`)
  }
  if ((systemCommands.has(input.command) && !input.waitFor && !input.waitForGone)
    || (input.command === 'wait' && typeof input.ms === 'number' && Object.keys(input).every(field => ['command', 'ms'].includes(field)))) {
    return { input, validate: unchanged }
  }
  // 未设应用限制的宽松策略无需增加库存查询与延迟；有拒绝规则时不能跳过规范身份校验。
  if (!restricted) return { input, validate: unchanged }
  // 系统级能力仍由独立的本地风险确认授权；没有应用拒绝规则时不强行猜测其所属应用。
  if (!hasDeniedApps && ['clipboard-get', 'clipboard-set', 'clipboard-clear', 'dismiss-all-notifications'].includes(input.command)) {
    return { input, validate: unchanged }
  }
  if ((input.headed && hasDeniedApps) || (input.surface && input.surface !== 'window')) throw unresolved()

  const refs = [input.ref, input.root, input.from, input.to, input.element].filter((value): value is string => typeof value === 'string')
  const inventory = await host.execute(namespace, ['list-apps', ...(requestedApp && !refs.length && input.windowId === undefined ? [`--app=${requestedApp}`] : [])], signal)
  unchanged()
  if (!inventory.ok || !record(inventory.data) || !Array.isArray(inventory.data.apps) || inventory.data.complete === false) throw unresolved()
  const apps: NativeApp[] = inventory.data.apps.filter(record).flatMap(app =>
    typeof app.name === 'string' && typeof app.pid === 'number'
      ? [{ name: app.name, pid: app.pid, bundleId: typeof app.bundle_id === 'string' ? app.bundle_id : undefined,
        processInstance: typeof app.process_instance === 'string' ? app.process_instance : undefined }]
      : [])
  const authorize = async (effectiveInput: AgentDesktopInput, identities: Array<Pick<NativeApp, 'name' | 'bundleId'>>): Promise<{ input: AgentDesktopInput; validate: () => void }> => {
    for (const app of identities) {
      await auth.ensureAppAuthorized(app.name, app.bundleId, namespace)
      assertCurrent()
    }
    const revision = auth.getRevision()
    return {
      input: effectiveInput,
      validate: () => {
        assertCurrent()
        if (auth.getRevision() !== revision || identities.some(app => auth.checkAppAuthorization(app.name, app.bundleId, namespace) !== 'allowed')) {
          throw new Error('应用授权在等待期间已变更；本次动作未投递，请重新规划。')
        }
      },
    }
  }
  if (input.command === 'launch' && requestedApp && apps.length === 0) {
    const installed = await host.resolveInstalledApp?.(requestedApp)
    unchanged()
    if (!installed) throw unresolved()
    return authorize({ ...input, app: installed.bundleId }, [{ name: installed.appName, bundleId: installed.bundleId }])
  }
  const targets: NativeApp[] = []
  let effective = input
  for (const ref of refs) {
    if (!host.resolveRefTarget) throw unresolved()
    const source = await host.resolveRefTarget(namespace, ref)
    unchanged()
    const matches = apps.filter(app => app.pid === source.pid && app.processInstance === source.processInstance && key(app.name) === key(source.appName))
    if (matches.length !== 1) throw unresolved()
    targets.push(matches[0]!)
  }
  if (input.windowId !== undefined) {
    const windows = await host.execute(namespace, ['list-windows'], signal)
    unchanged()
    if (!windows.ok || !Array.isArray(windows.data)) throw unresolved()
    const matches = windows.data.filter(record).filter(window => String(window.id) === String(input.windowId))
    if (matches.length !== 1) throw unresolved()
    const window = matches[0]!
    const owners = apps.filter(app => app.pid === window.pid && !!app.processInstance && app.processInstance === window.process_instance && app.name === window.app_name)
    if (owners.length !== 1) throw unresolved()
    targets.push(owners[0]!)
  }
  if (requestedApp) {
    const matches = apps.filter(app => key(app.name) === key(requestedApp) || (app.bundleId && key(app.bundleId) === key(requestedApp)))
    // 上游 list-apps --app 支持系统别名；只有原生唯一解析且不与 ref/window 身份冲突时才采用。
    const resolved = matches.length === 1 ? matches[0] : !refs.length && input.windowId === undefined && apps.length === 1 ? apps[0] : undefined
    if (!resolved || targets.some(target => target.pid !== resolved.pid)) throw unresolved()
    targets.push(resolved)
    effective = { ...input, app: resolved.bundleId ?? resolved.name }
  }
  // 库存只列出元数据，不授予操作权限；有拒绝规则时不返回未限定的窗口标题。
  if (!targets.length && inventoryCommands.has(input.command)) {
    if (input.command === 'list-windows' && Object.values(preferences.allowedApps).includes('denied')) throw unresolved()
    return { input, validate: unchanged }
  }
  if (!targets.length) throw unresolved()
  const unique = [...new Map(targets.map(app => [app.pid, app])).values()]
  return authorize(effective, unique)
}
