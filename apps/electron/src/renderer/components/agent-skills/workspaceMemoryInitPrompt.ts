export type MemoryHistoryRange = '1m' | '2m' | '3m' | 'all'

export const MEMORY_HISTORY_RANGE_OPTIONS: Array<{ value: MemoryHistoryRange; label: string; promptLabel: string }> = [
  { value: '1m', label: '近 1 个月', promptLabel: '最近 1 个月内' },
  { value: '2m', label: '近 2 个月', promptLabel: '最近 2 个月内' },
  { value: '3m', label: '近 3 个月', promptLabel: '最近 3 个月内' },
  { value: 'all', label: '全部', promptLabel: '全部可用历史' },
]

export const AGENTS_MD_TEMPLATE = `# <项目名> 规则

## 项目一句话
（一两句话）

## 常用命令
- 开发：
- 测试：
- 构建：

## 必须遵守
1.
2.

## 禁止
-

## 输出与代码风格
-

## 记忆分工（固定段，不要改）
- 本文件写"必须怎么做"；项目是什么、为什么这么定、踩过什么坑，写进 memory/。
- 用户个人信息和偏好不写在这里，写进全局用户记忆。
- Agent 改动本文件前必须先问用户。`

/** This block is project-portable policy, while exact Gamma paths remain in the workspace prompt. */
export const PROJECT_KNOWLEDGE_MAINTENANCE_BLOCK = `<!-- gamma:knowledge-maintenance:start -->
## 记忆分工（固定段，不要改）
- 本文件写"必须怎么做"；项目是什么、为什么这么定、踩过什么坑，写进 memory/。
- 用户个人信息和偏好不写在这里，写进全局用户记忆。
- Agent 改动本文件前必须先问用户。
<!-- gamma:knowledge-maintenance:end -->`

export function getMemoryHistoryRangeLabel(value: MemoryHistoryRange): string {
  return MEMORY_HISTORY_RANGE_OPTIONS.find((option) => option.value === value)?.promptLabel ?? '最近 1 个月内'
}

/** Starts the user-authorized project-map and collaboration-profile bootstrap. */
export function buildWorkspaceKnowledgeBootstrapPrompt(): string {
  return `请开始建立当前项目的规则与协作约定。按以下顺序渐进进行：

## 第一阶段：建立规则 AGENTS.md
用户已授权你基于已核验的项目事实初始化或维护 \`AGENTS.md\`。
1. \`AGENTS.md\` 里只放指令，不放会变的事实，也不放进度。每条规则一句话、能检验，全文控制在 80 行内。若文件缺失，使用以下模板创建：

\`\`\`markdown
${AGENTS_MD_TEMPLATE}
\`\`\`

2. 确保包含固定的“记忆分工”区块。若已有旧协议标记 \`<!-- proma:knowledge-maintenance:start -->\` 或 \`<!-- gamma:knowledge-maintenance:start -->\`，做最小修订并保留原标记。

## 第二阶段：建立项目协作约定
项目规则完成后，不要读取历史会话。只在当前回复末尾提出**一个**与本次项目协作约定有关的简短问题（例如代码改动前是否先出方案、测试验收要求等）。
用户直接回答了项目协作约定时，可最小创建或更新 \`memory/workflow.md\`（只记录在这个项目里的协作约定，不再镜像全局画像），并同步更新 \`MEMORY.md\` 的单行索引（格式为 \`- [workflow.md] 项目协作约定\`）。
写完不要在回复里提“已记住”。只有删除/大段覆盖、冲突、涉及敏感信息时，才先问用户。

## 第三阶段：历史会话只作补证据
本次没有阅读历史会话的授权。等协作约定已有初步记录后，另行邀请用户决定是否授权分批扫描当前工作区的高信号会话。`
}

/** Builds an explicit, bounded historical-session evidence pass after profile bootstrap. */
export function buildWorkspaceSessionEvidencePrompt(historyRange: MemoryHistoryRange): string {
  const rangeLabel = getMemoryHistoryRangeLabel(historyRange)
  const rangeGuidance = historyRange === 'all'
    ? '用户明确选择全部可用历史；仍必须优先近期和高信号会话，并在得到足够证据后停止。'
    : `只处理${rangeLabel}的会话；若证据不足，不得自行扩大范围。`

  return `用户已授权你将当前项目工作区的历史会话作为**补充证据**，不是全量记忆蒸馏。项目规则或记忆文件的既有内容仍是优先上下文。

范围与预算：
- ${rangeGuidance}
- 先只查看会话元信息（时间、标题、完成状态）；选择至多 3 个近期、已完成、与当前项目直接相关的高信号会话作为第一批。
- 对每个入选会话，只读取回答问题所需的摘要或局部片段；不要读取完整原始 JSONL，不要无差别扫描，也不要为了凑数量继续消耗 tokens。
- 每批提炼后判断证据是否已经足够；足够即停止。不足时说明缺口，并由用户决定是否授权下一批。

写入边界：
- 项目规则 \`AGENTS.md\` 只放必须遵守的指令与边界，Agent 改动前必须先问用户。
- 项目记忆写入 \`memory/\`：\`workflow.md\`（协作约定）、\`project.md\`（目标与技术栈）、\`decisions.md\`（决定与理由：\`- [stated] 2026-10-xx 决定：X；理由：Y；状态：有效\`）、\`lessons.md\`（踩坑：\`- [verified] 现象 → 原因 → 解法（依据：…，2026-10-xx）\`）。\`MEMORY.md\` 只做单行索引。
- 最小增量写入，写完不要在回复里提“已记住”。只有删除/大段覆盖、冲突、涉及敏感信息才先问用户。`
}
