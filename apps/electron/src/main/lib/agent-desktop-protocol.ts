/**
 * agent-desktop 协议定义、命令规范与安全参数构造器。
 *
 * 固定上游 release v1.0.2（envelope 2.5）。
 * 覆盖全部 60 个上游命令（56 个 operational + 4 个明确拒绝的 held-input 命令）。
 * 严格基于白名单构建 typed 参数数组，绝不接受任意 argv，绝不做 argv 透传，绝不经 shell。
 */

export const AGENT_DESKTOP_VERSION = '1.0.2'
export const AGENT_DESKTOP_ENVELOPE_VERSION = '2.5'

export interface AgentDesktopDisposition {
  delivery: string
  retry: string
  [key: string]: unknown
}

export interface AgentDesktopError {
  code: string
  message: string
  disposition: AgentDesktopDisposition
  suggestion?: string
  details?: unknown
  [key: string]: unknown
}

export interface AgentDesktopEnvelope<T = unknown> {
  version: '2.5'
  ok: boolean
  command: string
  data?: T
  error?: AgentDesktopError
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * 严格校验并解析 agent-desktop 响应 envelope。
 * - 必须为 JSON
 * - version 必须为 '2.5'
 * - 错误响应缺 disposition 时，绝不假定 safe，降级为 unknown / unsafe
 */
export function parseAgentDesktopEnvelope(text: string): AgentDesktopEnvelope {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('agent-desktop 返回非 JSON；投递状态未知，不得重试')
  }

  if (
    !isRecord(value) ||
    value.version !== '2.5' ||
    typeof value.ok !== 'boolean' ||
    typeof value.command !== 'string'
  ) {
    throw new Error('agent-desktop envelope 不兼容；投递状态未知')
  }

  if (!value.ok) {
    if (
      !isRecord(value.error) ||
      typeof value.error.code !== 'string' ||
      typeof value.error.message !== 'string'
    ) {
      throw new Error('agent-desktop 错误 envelope 无效；投递状态未知')
    }
    // 老旧或不完整响应绝不推导为 safe。保留 partial data / details，不重建 AX 树。
    if (
      !isRecord(value.error.disposition) ||
      typeof value.error.disposition.delivery !== 'string' ||
      typeof value.error.disposition.retry !== 'string'
    ) {
      value.error.disposition = { delivery: 'unknown', retry: 'unsafe' }
    }
  }

  return value as unknown as AgentDesktopEnvelope
}

export type OptionKind = 'string' | 'number' | 'boolean' | 'strings'

export interface CommandSpec {
  positional: readonly string[]
  options: readonly string[]
  readOnly?: boolean
  disabled?: string
}

const scope = ['app', 'windowId']
const timeout = ['timeoutMs']
const refOptions = [...timeout]
const spec = (
  positional: readonly string[] = [],
  options: readonly string[] = [],
  readOnly = false,
  disabled?: string,
): CommandSpec => ({ positional, options, readOnly, disabled })

/** 覆盖全部 60 个上游命令 */
export const AGENT_DESKTOP_COMMANDS: Record<string, CommandSpec> = {
  // 观察与检索类 (readOnly)
  snapshot: spec(
    [],
    [
      ...scope,
      ...timeout,
      'surface',
      'root',
      'maxDepth',
      'includeBounds',
      'interactiveOnly',
      'compact',
      'skeleton',
      'forceElectronA11y',
    ],
    true,
  ),
  find: spec(
    [],
    [
      ...scope,
      ...timeout,
      'surface',
      'root',
      'role',
      'name',
      'value',
      'text',
      'description',
      'nativeId',
      'exact',
      'states',
      'count',
      'first',
      'last',
      'nth',
      'limit',
    ],
    true,
  ),
  screenshot: spec([], [...scope, 'screen'], true),
  get: spec(['ref'], ['property'], true),
  is: spec(['ref'], ['property'], true),

  // 基础语义操作
  click: spec(['ref'], refOptions),
  'double-click': spec(['ref'], refOptions),
  'triple-click': spec(['ref'], refOptions),
  'right-click': spec(['ref'], refOptions),
  clear: spec(['ref'], refOptions),
  focus: spec(['ref'], refOptions),
  toggle: spec(['ref'], refOptions),
  check: spec(['ref'], refOptions),
  uncheck: spec(['ref'], refOptions),
  expand: spec(['ref'], refOptions),
  collapse: spec(['ref'], refOptions),
  'scroll-to': spec(['ref'], refOptions),

  // 文本与值输入
  type: spec(['ref', 'text'], timeout),
  'set-value': spec(['ref', 'value'], timeout),
  select: spec(['ref', 'value'], timeout),
  scroll: spec(['ref'], [...timeout, 'direction', 'amount']),
  press: spec(['combo'], [...scope, 'force']),

  // 物理与坐标操作 (通常需要 --headed)
  hover: spec(['ref'], ['xy', 'duration', ...timeout]),
  drag: spec(
    [],
    [
      'from',
      'to',
      'fromXy',
      'toXy',
      'duration',
      'dropDelay',
      ...timeout,
      'waitForScope',
    ],
  ),
  'mouse-move': spec([], ['xy']),
  'mouse-click': spec([], ['xy', 'button', 'count', 'modifiers']),
  'mouse-wheel': spec([], ['x', 'y', 'dx', 'dy', 'modifiers']),

  // 进程与窗口管理
  launch: spec(['app'], ['timeout', 'activate', 'noAttach']),
  'close-app': spec(['app'], ['force']),
  'list-windows': spec([], ['app', ...timeout], true),
  'list-apps': spec([], ['app', ...timeout], true),
  'list-displays': spec([], [], true),
  'focus-window': spec([], [...scope, 'title']),
  'resize-window': spec([], [...scope, 'width', 'height']),
  'move-window': spec([], [...scope, 'x', 'y']),
  minimize: spec([], scope),
  maximize: spec([], scope),
  restore: spec([], scope),

  // Surfaces 与通知
  'list-surfaces': spec([], ['app'], true),
  'open-system-surface': spec([], ['surface']),
  'list-notifications': spec([], ['app', 'text', 'limit'], true),
  'dismiss-notification': spec(
    ['index'],
    ['app', 'expectedApp', 'expectedTitle'],
  ),
  'dismiss-all-notifications': spec([], ['app']),
  'notification-action': spec(
    ['index', 'action'],
    ['expectedApp', 'expectedTitle'],
  ),

  // 剪贴板管理 (敏感操作需确认)
  'clipboard-get': spec([], ['format']),
  'clipboard-set': spec(['text'], []),
  'clipboard-clear': spec([], []),

  // 等待、状态、权限与版本
  wait: spec(
    ['ms'],
    [
      'element',
      'window',
      'text',
      'menu',
      'menuClosed',
      'notification',
      'event',
      'windowId',
      'predicate',
      'value',
      'waitAction',
      'count',
      'timeout',
      'app',
    ],
    true,
  ),
  status: spec([], [], true),
  permissions: spec([], ['request', 'guide'], true),
  version: spec([], [], true),

  // 批量执行：必须由 Gamma 逐项执行并分别授权
  batch: spec([], [], false, 'batch 必须由 Gamma 逐项执行并分别授权'),

  // 辅助与会话管理
  skills: spec(['subcommand'], ['skill'], true),
  session: spec(['subcommand'], [], true),
  trace: spec(['subcommand'], ['limit', 'event'], true),
  'cursor-overlay': spec(['subcommand'], []),

  // 明确拒绝的 4 个 held-input 命令
  'key-down': spec(
    [],
    [],
    false,
    'stateless held-input 被明确禁用；请使用 press / mouse-click / drag',
  ),
  'key-up': spec(
    [],
    [],
    false,
    'stateless held-input 被明确禁用；请使用 press / mouse-click / drag',
  ),
  'mouse-down': spec(
    [],
    [],
    false,
    'stateless held-input 被明确禁用；请使用 press / mouse-click / drag',
  ),
  'mouse-up': spec(
    [],
    [],
    false,
    'stateless held-input 被明确禁用；请使用 press / mouse-click / drag',
  ),
}

export type AgentDesktopCommand = keyof typeof AGENT_DESKTOP_COMMANDS

export const OPTION_KINDS: Record<string, OptionKind> = Object.fromEntries([
  ...[
    'ref',
    'app',
    'windowId',
    'surface',
    'root',
    'role',
    'name',
    'value',
    'text',
    'description',
    'nativeId',
    'property',
    'direction',
    'combo',
    'xy',
    'button',
    'from',
    'to',
    'fromXy',
    'toXy',
    'title',
    'expectedApp',
    'expectedTitle',
    'action',
    'notificationAction',
    'format',
    'element',
    'window',
    'event',
    'predicate',
    'waitAction',
    'subcommand',
    'skill',
    'waitFor',
    'waitForGone',
    'waitForScope',
  ].map((key) => [key, 'string']),
  ...[
    'timeoutMs',
    'maxDepth',
    'nth',
    'limit',
    'screen',
    'amount',
    'duration',
    'dropDelay',
    'x',
    'y',
    'dx',
    'dy',
    'count',
    'timeout',
    'width',
    'height',
    'index',
    'ms',
    'waitTimeout',
  ].map((key) => [key, 'number']),
  ...[
    'includeBounds',
    'interactiveOnly',
    'compact',
    'skeleton',
    'forceElectronA11y',
    'exact',
    'first',
    'last',
    'force',
    'activate',
    'noAttach',
    'menu',
    'menuClosed',
    'notification',
    'request',
    'guide',
    'headed',
  ].map((key) => [key, 'boolean']),
  ['states', 'strings'],
  ['modifiers', 'strings'],
]) as Record<string, OptionKind>

export interface AgentDesktopInput {
  command: string
  headed?: boolean
  ref?: string
  app?: string
  windowId?: string | number
  text?: string
  value?: string
  combo?: string
  action?: string
  notificationAction?: string
  waitFor?: string
  waitForGone?: string
  waitTimeout?: number
  [key: string]: unknown
}

const flagName = (key: string): string =>
  ({
    states: 'state',
    waitAction: 'action',
    forceElectronA11y: 'force-electron-a11y',
    windowId: 'window-id',
    timeoutMs: 'timeout-ms',
    maxDepth: 'max-depth',
    includeBounds: 'include-bounds',
    interactiveOnly: 'interactive-only',
    nativeId: 'native-id',
    expectedApp: 'expected-app',
    expectedTitle: 'expected-title',
    noAttach: 'no-attach',
    dropDelay: 'drop-delay',
    waitForScope: 'wait-for-scope',
    fromXy: 'from-xy',
    toXy: 'to-xy',
    waitFor: 'wait-for',
    waitForGone: 'wait-for-gone',
    waitTimeout: 'wait-timeout',
  })[key] ?? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/**
 * 构造 agent-desktop CLI 命令参数数组。
 * 严格校验白名单，阻断未审阅参数、shell 注入与未知选项。
 */
export function buildAgentDesktopArgs(input: AgentDesktopInput): string[] {
  const command = AGENT_DESKTOP_COMMANDS[input.command]
  if (!command) throw new Error(`未知 agent-desktop command: ${input.command}`)
  if (command.disabled) throw new Error(command.disabled)

  if (input.command === 'batch') {
    throw new Error('batch 必须由 Gamma 逐项执行并分别授权')
  }

  const globals = ['headed', 'waitFor', 'waitForGone', 'waitTimeout']
  const schemaContext = ['app', 'windowId', 'surface', 'ref']
  const allowed = new Set([
    'command',
    ...command.positional,
    ...command.options,
    ...globals,
    ...schemaContext,
    // 兼容别名
    ...(input.command === 'notification-action' ? ['notificationAction'] : []),
  ])

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(
        `command 包含未审阅选项: ${key}；不接受任意 argv、路径或 CDP`,
      )
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (key === 'command' || value === undefined) continue
    const kind = OPTION_KINDS[key]
    if (kind === 'string') {
      const strVal = String(value)
      if (strVal.length > 32_000 || strVal.includes('\0')) {
        throw new Error(`无效字符串选项: ${key}`)
      }
    } else if (kind === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > 120_000
      ) {
        throw new Error(`无效数值选项: ${key}`)
      }
    } else if (kind === 'boolean') {
      if (typeof value !== 'boolean' && !(key === 'count' && input.command === 'find')) {
        throw new Error(`无效布尔选项: ${key}`)
      }
    } else if (kind === 'strings') {
      if (
        !Array.isArray(value) ||
        value.length > 32 ||
        value.some((item) => typeof item !== 'string' || item.length > 256)
      ) {
        throw new Error(`无效字符串数组选项: ${key}`)
      }
    }
  }

  if (
    input.command === 'session' &&
    !['list', 'end', 'start'].includes(String(input.subcommand))
  ) {
    throw new Error('session 仅允许 list/start/end；禁止 trace start/gc')
  }
  if (input.command === 'trace' && input.subcommand !== 'show') {
    throw new Error('trace 仅允许 show，不能导出桌面记录')
  }
  if (
    input.command === 'cursor-overlay' &&
    !['status', 'disable'].includes(String(input.subcommand))
  ) {
    throw new Error('cursor-overlay 仅允许 status/disable；不启用额外宿主')
  }
  if (
    input.command === 'skills' &&
    !['list', 'get', 'path'].includes(String(input.subcommand))
  ) {
    throw new Error('skills 仅允许 list/get/path')
  }

  const args: string[] = []
  if (input.headed) {
    args.push('--headed')
  }
  args.push(input.command)

  // 处理位置参数
  const optionalPositionals = new Set(['hover:ref', 'wait:ms', 'clipboard-set:text'])
  for (const key of command.positional) {
    const rawVal =
      key === 'action' && input.action === undefined
        ? input.notificationAction
        : input[key]
    const optKey = `${input.command}:${key}`

    if (rawVal === undefined || rawVal === null) {
      if (optionalPositionals.has(optKey)) continue
      throw new Error(`缺少参数: ${key}`)
    }

    const strVal = String(rawVal)
    if (strVal.startsWith('-') && !['text', 'value'].includes(key)) {
      throw new Error('位置参数不能是命令选项')
    }
    args.push(strVal)
  }

  // 处理命名选项
  const optionsList = [
    ...command.options,
    ...globals.filter((k) => k !== 'headed'),
  ]
  for (const key of optionsList) {
    const value = input[key]
    if (value === undefined || value === null || value === false) continue

    if (key === 'windowId') {
      args.push(`--window-id=${value}`)
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        args.push(`--${flagName(key)}=${item}`)
      }
    } else {
      args.push(
        value === true ? `--${flagName(key)}` : `--${flagName(key)}=${value}`,
      )
    }
  }

  return args
}
