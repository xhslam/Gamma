/**
 * 模型上下文窗口推断 — 单一 source of truth。
 *
 * 1M 上下文已随各家模型转正为默认能力（Anthropic 于 2026-03 对 Opus 4.6 /
 * Sonnet 4.6 起 GA，无需 context-1m beta header；Sonnet 5 / Opus 4.7+ 延续），
 * 故不再下发任何 beta。Gamma 统一按模型能力推断窗口，前端展示、后端用量统计和运行时注册
 * 必须共用同一份判定，避免出现"UI 显示 1M 但实际只 200K"的不一致。
 */

import { getGeminiModelCapability } from './gemini-model-capabilities'
import { isGpt6AstraFamily, isGpt6LunaFamily, isGpt6SolFamily, isGpt61SolModel, isGpt61TerraModel } from './model-family'

/** 默认上下文窗口（无法识别模型时使用） */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** 1M 上下文窗口 */
export const ONE_MILLION_CONTEXT_WINDOW = 1_000_000

/** ChatGPT Codex 已验证的 GPT-5.x 上下文窗口；第三方同名模型沿用此展示基线。 */
export const CODEX_GPT_54_55_CONTEXT_WINDOW = 272_000
export const CODEX_GPT_54_MINI_CONTEXT_WINDOW = 400_000
export const CODEX_GPT_56_CONTEXT_WINDOW = 372_000
/** ChatGPT Codex 订阅中的 GPT-6 Astra、Sol 与 Luna 上下文窗口。 */
export const CODEX_GPT_6_CONTEXT_WINDOW = 372_000
/** GPT-6.1 Terra 保守兼容回退上下文窗口（参考 SDK 已验证的 Terra 272k 基线，避免冒称权威或冒进扩展 500k）。 */
export const CODEX_GPT_61_TERRA_FALLBACK_CONTEXT_WINDOW = 272_000

/**
 * 为 ChatGPT Codex 中的 GPT-5.x / GPT-6 模型返回统一上下文窗口。
 *
 * 仅覆盖 Codex 已明确标记的模型；Pro/Nano 等未出现在 Codex 目录的变体继续交由
 * provider catalog 决定，避免把不同 SKU 误写成同一窗口。
 */
export function inferCodexAlignedGPT5ContextWindow(modelId: string | undefined): number | undefined {
  // 与当前 Pi SDK Codex 目录中的 GPT-6.1 Sol 元数据保持一致。
  if (isGpt61SolModel(modelId)) return 500_000

  // GPT-6.1 Terra 官方规格未定，保守回退采用已核实的 SDK Terra 基线 (272,000)，不盲目套用 Sol 的 500k。
  // 若运行时实测或目录提供新值，真实值优先。
  if (isGpt61TerraModel(modelId)) return CODEX_GPT_61_TERRA_FALLBACK_CONTEXT_WINDOW

  if (isGpt6AstraFamily(modelId) || isGpt6SolFamily(modelId) || isGpt6LunaFamily(modelId)) {
    return CODEX_GPT_6_CONTEXT_WINDOW
  }

  const model = modelId?.toLowerCase().replace(/\[1m\]$/i, '')
  switch (model) {
    case 'gpt-5.4-mini': return CODEX_GPT_54_MINI_CONTEXT_WINDOW
    case 'gpt-5.4':
    case 'gpt-5.5': return CODEX_GPT_54_55_CONTEXT_WINDOW
    case 'gpt-5.6':
    case 'gpt-5.6-sol':
    case 'gpt-5.6-terra':
    case 'gpt-5.6-luna': return CODEX_GPT_56_CONTEXT_WINDOW
    default: return undefined
  }
}

/** 已确认支持 1M 上下文的模型。 */
const ONE_MILLION_CONTEXT_RULES = {
  // Claude 系列
  claude: [
    'claude-sonnet-4-6',
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
  ],
  // DeepSeek
  deepseek: ['deepseek-v4', 'deepseek-flash'],
  // 智谱 GLM
  glm: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2'],
  // 小米 MiMo：官方精确 ID（见 EXACT_CONTEXT_RULES，避免子串误伤未来 ID）；
  // mimo-v2.5 系列将于 2026-10-21 下线，保留以兼容历史会话的用量统计分母。
  mimo: ['mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'],
  // MiniMax
  minimax: ['minimax-m3'],
  // Kimi
  kimi: ['k3'],
  // 通义千问
  qwen: [
    'qwen3.8',
    'qwen3.7',
    'qwen3.6-plus',
    'qwen3.6-flash',
    'qwen3.5-plus',
    'qwen3.5-flash',
    'qwen3-coder-plus',
  ],
} as const

const ONE_MILLION_CONTEXT_DISPLAY_RULES = Object.values(ONE_MILLION_CONTEXT_RULES).flat()
const EXACT_CONTEXT_RULES = new Set([
  'k3',
  'kimi-k3',
  // MiMo 全系列用精确匹配，避免子串误伤未来 ID（如 mimo-v2.50 / mimo-v2.60）。
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'mimo-v2.6-pro',
  'mimo-v2.6-flash',
  'mimo-v2.6-pro-ultraspeed',
])

/** MiMo-V2.6 系列的官方精确模型 ID（2026-09-22 模型列表），供 Pi runtime 等跨包复用。 */
export const MIMO_V26_MODEL_IDS = ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'] as const

/** 判断是否为 MiMo-V2.6 系列模型（精确匹配，含首尾空白与大小写归一）。 */
export function isMimoV26Model(modelId: string | undefined): boolean {
  if (!modelId) return false
  return (MIMO_V26_MODEL_IDS as readonly string[]).includes(modelId.trim().toLowerCase())
}

function matchesContextRule(model: string, pattern: string): boolean {
  if (EXACT_CONTEXT_RULES.has(pattern)) {
    return model === pattern || model.startsWith(`${pattern}[`)
  }
  return model.includes(pattern)
}

/**
 * 上下文窗口配置表。仅影响显示推断的模型加在 rules；已确认 1M
 * 能力的模型加在上方 ONE_MILLION_CONTEXT_RULES，并自动复用于 rules。
 *
 * 匹配规则：modelId.toLowerCase() 包含 pattern 即命中（substring match）。
 * exclude 列表优先级最高：命中 exclude 的模型始终返回 DEFAULT_CONTEXT_WINDOW。
 *
 * 参考：https://docs.anthropic.com/en/docs/build-with-claude/context-windows
 */
const CONTEXT_WINDOW_CONFIG = {
  /** 始终使用默认窗口的模型特征（优先级高于 rules） */
  exclude: ['haiku'],

  /** 1M 上下文模型匹配规则 */
  rules: [
    ...ONE_MILLION_CONTEXT_DISPLAY_RULES,
    // 保留真实模型 ID 的历史上下文窗口推断。
    'kimi-k3',
    // 已废弃的 MiMo V2 Pro 仅保留历史显示推断
    'mimo-v2-pro',
  ] as const,
} as const

/**
 * 判断模型是否支持 1M context window（现为各模型默认能力，无需 beta header）。
 */
export function supports1MContext(modelId: string): boolean {
  if (!modelId) return false
  const m = modelId.toLowerCase()
  if (CONTEXT_WINDOW_CONFIG.exclude.some((p) => m.includes(p))) return false
  return CONTEXT_WINDOW_CONFIG.rules.some((p) => matchesContextRule(m, p))
}

/**
 * 按模型名推断 contextWindow（token 数）。
 *
 * SDK 流式过程中不返回此字段，只有 result 消息的 modelUsage 才带（且部分渠道不返回）。
 * 本函数提供一个按模型家族的 fallback，保证进度环永远有分母可用。
 */
export function inferContextWindow(model?: string): number | undefined {
  if (!model) return undefined
  const codexAlignedWindow = inferCodexAlignedGPT5ContextWindow(model)
  if (codexAlignedWindow !== undefined) return codexAlignedWindow
  const geminiCapability = getGeminiModelCapability(model)
  if (geminiCapability) return geminiCapability.contextWindow
  if (supports1MContext(model)) return ONE_MILLION_CONTEXT_WINDOW
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * 保守上下文窗口（未知模型时的预算兜底）。
 *
 * 用于计算会话引用预算等对安全性要求较高的场景：
 * - 已知模型：采用共享模型能力规则中的明确窗口。
 * - 运行时实测值（contextWindow from result/usage）：优先级最高，由调用方传入。
 * - 未命中明确能力规则的模型：保守兜底 128,000 tokens，
 *   不使用 DEFAULT_CONTEXT_WINDOW（200k），避免引用预算过度乐观。
 *
 * UI 与主进程应使用同一函数，禁止各自内联不同的 fallback 值。
 */
export const CONSERVATIVE_FALLBACK_CONTEXT_WINDOW = 128_000

/**
 * 判断模型是否命中权威 registry（Codex / Gemini / 1M 列表），即是否有已知窗口。
 * 未知模型返回 undefined，区别于 inferContextWindow 的 DEFAULT_CONTEXT_WINDOW 兜底。
 */
function inferKnownContextWindow(model?: string): number | undefined {
  if (!model) return undefined
  const codexAlignedWindow = inferCodexAlignedGPT5ContextWindow(model)
  if (codexAlignedWindow !== undefined) return codexAlignedWindow
  const geminiCapability = getGeminiModelCapability(model)
  if (geminiCapability) return geminiCapability.contextWindow
  if (supports1MContext(model)) return ONE_MILLION_CONTEXT_WINDOW
  // 未知模型返回 undefined，由调用方决定保守兜底
  return undefined
}

/**
 * 为会话引用预算推断保守上下文窗口。
 *
 * @param modelId   模型 ID（可为 undefined）
 * @param measured  运行时实测窗口（来自 result.modelUsage.contextWindow）
 * @returns 保守上下文窗口 token 数，未知模型时为 128,000
 */
export function inferBudgetContextWindow(
  modelId: string | undefined,
  measured?: number,
): number {
  // 运行时实测值优先级最高（来自权威 result 消息）
  if (measured !== undefined && Number.isSafeInteger(measured) && measured > 0) return measured
  // 权威 registry 已知值
  const knownWindow = inferKnownContextWindow(modelId)
  if (knownWindow !== undefined) return knownWindow
  // 未知模型保守兜底（不使用 DEFAULT_CONTEXT_WINDOW 200k）
  return CONSERVATIVE_FALLBACK_CONTEXT_WINDOW
}
