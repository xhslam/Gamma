/**
 * GPT-6 model-family recognition shared by channel, runtime, and UI code.
 *
 * Astra can carry hyphenated SKU suffixes returned by Codex. Sol and Luna are
 * exact IDs so nearby names are never routed as an official model by mistake.
 */
const GPT_6_ASTRA_FAMILY_PATTERN = /^gpt-6-astra(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/
const GPT_6_SOL_MODEL_ID = 'gpt-6-sol'
const GPT_6_1_SOL_MODEL_ID = 'gpt-6.1-sol'
const GPT_6_LUNA_MODEL_ID = 'gpt-6-luna'
const GPT_6_1_TERRA_MODEL_ID = 'gpt-6.1-terra'

function normalizeModelId(modelId: string | undefined): string | undefined {
  return modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
}

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_ASTRA_FAMILY_PATTERN.test(normalized)
}

export function isGpt61SolModel(modelId: string | undefined): boolean {
  return normalizeModelId(modelId) === GPT_6_1_SOL_MODEL_ID
}

export function isGpt6SolFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized === GPT_6_SOL_MODEL_ID || normalized === GPT_6_1_SOL_MODEL_ID
}

export function isGpt6LunaFamily(modelId: string | undefined): boolean {
  return normalizeModelId(modelId) === GPT_6_LUNA_MODEL_ID
}

export function isGpt61TerraModel(modelId: string | undefined): boolean {
  return normalizeModelId(modelId) === GPT_6_1_TERRA_MODEL_ID
}
