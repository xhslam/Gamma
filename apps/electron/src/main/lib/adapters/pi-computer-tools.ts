import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ComputerBinding, ComputerState } from '@gamma/shared'
import { computerController } from '../computer-service'
import type { ComputerController } from '../computer-controller'
import type { AgentDesktopEnvelope, AgentDesktopInput } from '../agent-desktop-protocol'
import { getComputerPauseReason } from '../computer-pause'

export interface ComputerToolDetails {
  message?: string
  state?: ComputerState
  interrupted?: boolean
  reason?: string
  envelope?: AgentDesktopEnvelope
  [key: string]: unknown
}

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

const ComputerToolSchema = Type.Object({
  command: Type.Union([
    Type.Literal('snapshot'),
    Type.Literal('find'),
    Type.Literal('screenshot'),
    Type.Literal('get'),
    Type.Literal('is'),
    Type.Literal('click'),
    Type.Literal('double-click'),
    Type.Literal('triple-click'),
    Type.Literal('right-click'),
    Type.Literal('type'),
    Type.Literal('set-value'),
    Type.Literal('clear'),
    Type.Literal('focus'),
    Type.Literal('select'),
    Type.Literal('toggle'),
    Type.Literal('check'),
    Type.Literal('uncheck'),
    Type.Literal('expand'),
    Type.Literal('collapse'),
    Type.Literal('scroll'),
    Type.Literal('scroll-to'),
    Type.Literal('press'),
    Type.Literal('hover'),
    Type.Literal('drag'),
    Type.Literal('mouse-move'),
    Type.Literal('mouse-click'),
    Type.Literal('mouse-wheel'),
    Type.Literal('launch'),
    Type.Literal('close-app'),
    Type.Literal('list-windows'),
    Type.Literal('list-displays'),
    Type.Literal('list-apps'),
    Type.Literal('focus-window'),
    Type.Literal('resize-window'),
    Type.Literal('move-window'),
    Type.Literal('minimize'),
    Type.Literal('maximize'),
    Type.Literal('restore'),
    Type.Literal('list-surfaces'),
    Type.Literal('open-system-surface'),
    Type.Literal('list-notifications'),
    Type.Literal('dismiss-notification'),
    Type.Literal('dismiss-all-notifications'),
    Type.Literal('notification-action'),
    Type.Literal('clipboard-get'),
    Type.Literal('clipboard-set'),
    Type.Literal('clipboard-clear'),
    Type.Literal('wait'),
    Type.Literal('status'),
    Type.Literal('permissions'),
    Type.Literal('version'),
    Type.Literal('skills'),
    Type.Literal('session'),
    Type.Literal('cursor-overlay'),
    Type.Literal('trace'),
    // 明确拒绝的 held-input 命令
    Type.Literal('key-down'),
    Type.Literal('key-up'),
    Type.Literal('mouse-down'),
    Type.Literal('mouse-up'),
  ], {
    description: 'agent-desktop 命令。观察优先用 snapshot / find，动作使用 click / set-value / type / press 等。',
  }),
  headed: Type.Optional(Type.Boolean({ description: '物理输入许可（默认 false 为 headless 语义执行；仅在用户已授权 headed 时可用）' })),
  ref: Type.Optional(Type.String({ description: '限定引用 @snapshot:eN，用于 click、set-value、focus、type 等' })),
  app: Type.Optional(Type.String({ description: '目标应用名称或 Bundle ID' })),
  windowId: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: '窗口 ID' })),
  surface: Type.Optional(Type.String({ description: 'Surface 类型，如 window, focused, menu, menubar, sheet, popover, alert' })),
  root: Type.Optional(Type.String({ description: '局部树根 ref，用于 snapshot 或 find' })),
  maxDepth: Type.Optional(Type.Number({ description: '最大快照树深度（默认 10）' })),
  includeBounds: Type.Optional(Type.Boolean({ description: '是否包含元素坐标范围 bounds' })),
  interactiveOnly: Type.Optional(Type.Boolean({ description: '仅包含可交互元素' })),
  compact: Type.Optional(Type.Boolean({ description: '折叠单子节点以减少深度' })),
  skeleton: Type.Optional(Type.Boolean({ description: '浅层结构概览，包含子元素计数' })),
  forceElectronA11y: Type.Optional(Type.Boolean({ description: '强制开启 Chromium/Electron 无障碍' })),
  role: Type.Optional(Type.String({ description: '按无障碍角色查找' })),
  name: Type.Optional(Type.String({ description: '按名称/标签查找' })),
  value: Type.Optional(Type.String({ description: '按元素当前值查找或 set-value 写入值' })),
  text: Type.Optional(Type.String({ description: '按文字查找或 type 键入文字' })),
  description: Type.Optional(Type.String({ description: '按描述查找' })),
  nativeId: Type.Optional(Type.String({ description: '按原生自动化 ID (AXIdentifier) 查找' })),
  exact: Type.Optional(Type.Boolean({ description: '是否要求严格精确匹配' })),
  states: Type.Optional(Type.Array(Type.String(), { description: '无障碍状态过滤，如 enabled=true' })),
  count: Type.Optional(Type.Boolean({ description: '仅返回匹配数量' })),
  first: Type.Optional(Type.Boolean({ description: '仅返回第一个匹配项' })),
  last: Type.Optional(Type.Boolean({ description: '仅返回最后一个匹配项' })),
  nth: Type.Optional(Type.Number({ description: '返回第 N 个匹配项 (0-indexed)' })),
  limit: Type.Optional(Type.Number({ description: '最多返回匹配数量' })),
  screen: Type.Optional(Type.Number({ description: '屏幕索引' })),
  property: Type.Optional(Type.String({ description: 'get/is 属性名' })),
  timeoutMs: Type.Optional(Type.Number({ description: '超时时间（毫秒）' })),
  direction: Type.Optional(Type.String({ description: '滚动方向: up, down, left, right' })),
  amount: Type.Optional(Type.Number({ description: '滚动单位数' })),
  combo: Type.Optional(Type.String({ description: '快捷键组合，如 return, escape, cmd+c, shift+tab' })),
  force: Type.Optional(Type.Boolean({ description: '强制执行危险快捷键或退出' })),
  duration: Type.Optional(Type.Number({ description: '持续时间' })),
  xy: Type.Optional(Type.String({ description: '绝对屏幕坐标 "x,y"' })),
  from: Type.Optional(Type.String({ description: '拖拽起始 ref' })),
  to: Type.Optional(Type.String({ description: '拖拽目标 ref' })),
  fromXy: Type.Optional(Type.String({ description: '拖拽起始坐标' })),
  toXy: Type.Optional(Type.String({ description: '拖拽目标坐标' })),
  dropDelay: Type.Optional(Type.Number({ description: '释放延迟' })),
  waitForScope: Type.Optional(Type.String({ description: '拖拽等待作用域' })),
  button: Type.Optional(Type.String({ description: '鼠标按键: left, right, middle' })),
  modifiers: Type.Optional(Type.Array(Type.String(), { description: '鼠标修饰键列表' })),
  x: Type.Optional(Type.Number({ description: 'X 坐标' })),
  y: Type.Optional(Type.Number({ description: 'Y 坐标' })),
  dx: Type.Optional(Type.Number({ description: '水平滚轮增量' })),
  dy: Type.Optional(Type.Number({ description: '垂直滚轮增量' })),
  activate: Type.Optional(Type.Boolean({ description: 'launch 后等待并激活窗口' })),
  noAttach: Type.Optional(Type.Boolean({ description: 'launch 后不尝试附加' })),
  title: Type.Optional(Type.String({ description: '窗口标题' })),
  width: Type.Optional(Type.Number({ description: '窗口宽度' })),
  height: Type.Optional(Type.Number({ description: '窗口高度' })),
  index: Type.Optional(Type.Number({ description: '通知序号' })),
  action: Type.Optional(Type.String({ description: '通知按钮动作名称' })),
  expectedApp: Type.Optional(Type.String({ description: '期望的通知所属应用' })),
  expectedTitle: Type.Optional(Type.String({ description: '期望的通知标题' })),
  format: Type.Optional(Type.String({ description: '剪贴板格式' })),
  ms: Type.Optional(Type.Number({ description: '等待毫秒数' })),
  element: Type.Optional(Type.String({ description: '等待元素出现' })),
  window: Type.Optional(Type.String({ description: '等待窗口出现' })),
  event: Type.Optional(Type.String({ description: '等待系统事件' })),
  predicate: Type.Optional(Type.String({ description: '等待断言' })),
  waitAction: Type.Optional(Type.String({ description: '等待动作' })),
  request: Type.Optional(Type.Boolean({ description: '请求权限' })),
  guide: Type.Optional(Type.Boolean({ description: '打开权限引导' })),
  subcommand: Type.Optional(Type.String({ description: '子命令: list, get, end, status, show' })),
  skill: Type.Optional(Type.String({ description: 'Skill 名称' })),
  waitFor: Type.Optional(Type.String({ description: '动作后轮询等待选择器匹配出现' })),
  waitForGone: Type.Optional(Type.String({ description: '动作后轮询等待选择器匹配消失' })),
  waitTimeout: Type.Optional(Type.Number({ description: '动作后等待超时时间' })),
})

/** 注册统一的 computer 工具 */
export function buildPiComputerTools(
  sdk: PiSdk,
  binding: ComputerBinding,
  source: string,
  controller: ComputerController = computerController,
): ToolDefinition[] {
  if (source !== 'user') return []
  return [
    sdk.defineTool({
      name: 'computer',
      label: '电脑桌面操作 (Computer)',
      description: `使用内置 agent-desktop 原生自动化引擎操作桌面应用。
- 遵循 observe → act → verify 循环：先 status 查状态，使用 snapshot / find 观察，再执行 click / set-value / type / press，并通过新观察验证结果。
- 元素引用格式为 @snapshot:eN（例如 @s1:e5）。旧引用随 UI 刷新失效；遇到 STALE_REF 重新 snapshot 或 find。
- 密集界面先用 skeleton 概览，再用 root 进行局部精细观察。覆盖层出现时优先指定 surface。
- 默认使用 headless 语义操作（不抢焦点、不改剪贴板）。物理键鼠输入需要用户在本地明确授权 headed；headless 失败不会自动转为 headed。
- ok:true 仅表示命令执行返回，不代表业务成功；必须检查 disposition.delivery 和 retry，并以新快照验证。
- 敏感能力（剪贴板读写、通知批量清除、close-app 等）需要用户单独确认。
- 用户停止后本轮不得自动恢复或重放，等待新消息。`,
      parameters: ComputerToolSchema,
      async execute(_id, input, signal) {
        try {
          const envelope = await controller.execute(
            binding,
            input as AgentDesktopInput,
            signal,
          )

          const textPayload = JSON.stringify(envelope)
          const contentItems: Array<
            | { type: 'text'; text: string }
            | { type: 'image'; data: string; mimeType: 'image/png' }
          > = [{ type: 'text', text: textPayload }]

          // 若命令为截图且包含 base64 图像，同时送入图片上下文
          if (
            envelope.command === 'screenshot' &&
            envelope.ok &&
            envelope.data &&
            typeof envelope.data === 'object' &&
            'data' in envelope.data &&
            typeof (envelope.data as { data: unknown }).data === 'string'
          ) {
            contentItems.push({
              type: 'image',
              data: (envelope.data as { data: string }).data,
              mimeType: 'image/png',
            })
          }

          return {
            content: contentItems,
            details: envelope,
          }
        } catch (error) {
          const pauseReason = getComputerPauseReason(error)
          const isPaused = Boolean(pauseReason)
          const message = error instanceof Error ? error.message : String(error)
          const errorEnvelope: AgentDesktopEnvelope = {
            version: '2.5',
            ok: false,
            command: (input as { command?: string }).command ?? 'unknown',
            error: {
              code: isPaused ? 'COMPUTER_RUN_PAUSED' : 'ERROR',
              message,
              disposition: { delivery: 'uncertain', retry: 'unsafe' },
            },
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(errorEnvelope) }],
            details: Object.assign(errorEnvelope, {
              message,
              interrupted: isPaused,
              reason: pauseReason ?? message,
            }),
          }
        }
      },
    }),
  ]
}
