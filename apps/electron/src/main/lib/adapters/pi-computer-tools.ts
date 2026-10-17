import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ComputerAction, ComputerBinding } from '@gamma/shared'
import { computerController } from '../computer-service'
import type { ComputerExecuteParams } from '../computer-controller'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
const result = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }], details: payload })

const ComputerToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('screenshot'),
    Type.Literal('click'),
    Type.Literal('left_click'),
    Type.Literal('double_click'),
    Type.Literal('triple_click'),
    Type.Literal('right_click'),
    Type.Literal('middle_click'),
    Type.Literal('mouse_move'),
    Type.Literal('move'),
    Type.Literal('type'),
    Type.Literal('key'),
    Type.Literal('open_app'),
    Type.Literal('wait'),
    Type.Literal('scroll'),
    Type.Literal('drag'),
    Type.Literal('left_click_drag'),
  ]),
  coordinate: Type.Optional(Type.Array(Type.Number(), { description: '(x, y): 像素坐标 [x, y]，基于最新截图' })),
  x: Type.Optional(Type.Number({ description: 'X 坐标（基于最新截图像素）' })),
  y: Type.Optional(Type.Number({ description: 'Y 坐标（基于最新截图像素）' })),
  text: Type.Optional(Type.String({ description: '输入文本或按键（用于 type 或 key）' })),
  key: Type.Optional(Type.String({ description: '按键或组合快捷键（如 Return, cmd+n, ctrl+c, Escape, Tab 等）' })),
  app: Type.Optional(Type.String({ description: '要打开的应用名称（如 Notes、备忘录、Safari 等）' })),
  appName: Type.Optional(Type.String({ description: '应用名称别名' })),
  app_name: Type.Optional(Type.String({ description: '应用名称别名' })),
  duration: Type.Optional(Type.Number({ description: '等待秒数（用于 wait 动作）' })),
  delta_y: Type.Optional(Type.Number({ description: '滚动垂直距离（负数向下，正数向上）' })),
  deltaY: Type.Optional(Type.Number({ description: '滚动垂直距离别名' })),
  scroll_amount: Type.Optional(Type.Number({ description: '滚动垂直距离别名' })),
  start_coordinate: Type.Optional(Type.Array(Type.Number(), { description: '拖拽起始坐标 [x, y]' })),
  startX: Type.Optional(Type.Number({ description: '拖拽起始 X 坐标' })),
  startY: Type.Optional(Type.Number({ description: '拖拽起始 Y 坐标' })),
})

/** 注册统一的 computer 工具与辅助兼容工具 */
export function buildPiComputerTools(sdk: PiSdk, binding: ComputerBinding, source: string): ToolDefinition[] {
  if (source !== 'user') return []
  return [
    sdk.defineTool({
      name: 'computer',
      label: '电脑桌面操作 (Computer)',
      description: `使用鼠标和键盘与系统交互、截图或打开应用。每个动作执行后都会自动返回执行后的最新屏幕截图。
动作包括：
- screenshot: 截取当前屏幕
- open_app: 打开指定应用（如 app: "Notes"、"备忘录"、"Safari"）
- click / double_click / right_click: 点击坐标 [x, y]
- type: 输入文本（支持中文与输入法）
- key: 按键或组合快捷键（如 "cmd+n", "Return", "ctrl+c", "Escape"）
- scroll: 垂直滚动（delta_y < 0 向下滚动，> 0 向上滚动）
- drag: 拖拽（start_coordinate -> coordinate）
- wait: 等待指定秒数（duration: 2）`,
      parameters: ComputerToolSchema,
      async execute(_id, input, signal) {
        const res = await computerController.executeAutonomousAction(input as ComputerExecuteParams, signal)
        return {
          content: [
            { type: 'text' as const, text: res.message },
            { type: 'image' as const, data: res.image.data, mimeType: res.image.mimeType },
          ],
          details: { message: res.message },
        }
      },
    }),
    sdk.defineTool({
      name: 'ComputerStatus', label: '桌面控制状态',
      description: '检查原生单窗口桌面模式状态。',
      parameters: Type.Object({}),
      async execute() { const state = computerController.getState(); return result({ supported: state.supported, phase: state.phase, authorizedForThisRun: computerController.isDesktopRun(binding) }) },
    }),
    sdk.defineTool({
      name: 'ComputerObserve', label: '观察所选窗口',
      description: '在已获本地单次运行与外发同意的桌面模式中观察唯一原生窗口。',
      parameters: Type.Object({}),
      async execute(_id, _input, signal) { return result(await computerController.observe(binding, signal)) },
    }),
    sdk.defineTool({
      name: 'ComputerAct', label: '执行单次桌面动作',
      description: '提交一个受监督的原生动作。',
      parameters: Type.Object({
        kind: Type.Union(['click', 'type', 'key', 'scroll', 'axPress', 'axSetValue'].map(value => Type.Literal(value))),
        observationId: Type.String(), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()),
        text: Type.Optional(Type.String({ maxLength: 256 })), deltaY: Type.Optional(Type.Integer({ minimum: -600, maximum: 600 })),
        elementRef: Type.Optional(Type.String()),
        key: Type.Optional(Type.Union(['Enter', 'Escape', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(value => Type.Literal(value)))),
      }, { additionalProperties: false }),
      async execute(_id, input, signal) {
        computerController.assertTool(binding, 'ComputerAct')
        return result(await computerController.act(binding, input as ComputerAction, signal))
      },
    }),
    sdk.defineTool({
      name: 'ComputerStop', label: '停止桌面控制',
      description: '撤销当前运行的原生桌面租约并等待旧helper退出。',
      parameters: Type.Object({}),
      async execute() { computerController.assertTool(binding, 'ComputerStop'); await computerController.stopForSession(binding.sessionId, 'Agent 请求停止桌面控制'); return result({ stopped: true }) },
    }),
  ] as ToolDefinition[]
}
