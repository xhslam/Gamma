import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgyTaskStartInput } from '@gamma/shared'
import type { PiBuiltinToolsContext } from './pi-builtin-tools'
import { agyTaskService } from '../agy-task-controller'
import { serializePiToolResultPayload } from './pi-tool-result-json'

function result(value: unknown) {
  const serialized = serializePiToolResultPayload(value)
  return { content: [{ type: 'text' as const, text: serialized.text }], details: serialized.details }
}

/** 外部执行仅提供给前台主会话；与 collaboration 的模型和权限语义保持分离。 */
export function buildPiAgyTools(ctx: PiBuiltinToolsContext): ToolDefinition[] {
  if (!ctx.workspaceId || (ctx.triggeredBy && ctx.triggeredBy !== 'user')) return []
  return [
    {
      name: 'AgyStart', label: '启动外部 Agent · agy',
      description: '启动真实 agy CLI 外部任务并自动展示实时活动面板。仅用于用户认可的外派任务；提示词会发给外部服务，不含敏感数据。遵循 agy 自有权限配置，不是沙箱，不自动跳过权限。返回只表示已启动，交付前必须 AgyWait 收敛，失败不自动重试放宽权限。不要再用 Bash 调 agy，后者没有原生面板。',
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, maxLength: 200000 }),
        title: Type.Optional(Type.String({ maxLength: 120 })),
        model: Type.Optional(Type.String({ maxLength: 120 })),
        cwd: Type.Optional(Type.String({ description: '起始工作目录；默认私有会话工作台。不是文件访问沙箱。' })),
        timeoutSeconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 3600 })),
        schema: Type.Optional(Type.String({ maxLength: 32000, description: 'JSON Schema 对象字符串，不是文件路径。' })),
      }, { additionalProperties: false }),
      async execute(id, params, signal) {
        const task = agyTaskService.start(ctx.sessionId, params as AgyTaskStartInput, id, signal, ctx.allowedRoots ?? [])
        return result({ task, note: '已启动，不代表完成；调用 AgyWait 收敛。活动记录只覆盖 CLI 上报事件，不是完整系统审计。' })
      },
    },
    {
      name: 'AgyList', label: '列出 agy 任务', description: '列出当前父会话的 agy 外部任务，不能访问其他会话。',
      parameters: Type.Object({}),
      async execute() { return result({ tasks: agyTaskService.list(ctx.sessionId) }) },
    },
    {
      name: 'AgyRead', label: '读取 agy 活动', description: '分页读取当前父会话外部任务的脱敏活动记录和最新状态。nextSequence 存在时可继续读下一页。',
      parameters: Type.Object({ taskId: Type.String(), afterSequence: Type.Optional(Type.Integer({ minimum: 0 })) }),
      async execute(_id, params) {
        const input = params as { taskId: string; afterSequence?: number }
        return result(agyTaskService.read(ctx.sessionId, input.taskId, input.afterSequence))
      },
    },
    {
      name: 'AgyWait', label: '等待 agy 任务', description: '等待当前会话的外部任务完成并返回最终状态/结果。超时仍为 running/stopping 时不能当作完成，继续等待或如实报告。',
      parameters: Type.Object({ taskId: Type.String(), timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })) }),
      async execute(_id, params, signal) {
        const input = params as { taskId: string; timeoutSeconds?: number }
        return result({ task: await agyTaskService.wait(ctx.sessionId, input.taskId, input.timeoutSeconds, signal) })
      },
    },
    {
      name: 'AgyStop', label: '停止 agy 任务', description: '停止当前父会话的受管 agy 进程组并等待退出。不能保证已终止 CLI 独立服务或服务端工作。',
      parameters: Type.Object({ taskId: Type.String() }),
      async execute(_id, params) { return result({ task: await agyTaskService.stop(ctx.sessionId, (params as { taskId: string }).taskId) }) },
    },
  ]
}
