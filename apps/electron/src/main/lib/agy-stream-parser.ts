import type { AgyActivityEvent } from '@gamma/shared'

const MAX_LINE_BYTES = 256 * 1024
const MAX_TEXT_CHARS = 64 * 1024
const MAX_VALUE_NODES = 2048
const MAX_VALUE_DEPTH = 8
const MAX_CONTAINER_ITEMS = 100
const REDACTED = '[REDACTED]'
const TRUNCATED = '[TRUNCATED]'

type ParsedEvent = Omit<AgyActivityEvent, 'sequence' | 'timestamp'>

interface PendingText {
  stepIndex?: number
  state?: string
  text: string
  truncated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCredentialKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase()
  return /^(?:authorization|proxyauthorization|(?:x)?apikey|(?:access|refresh|auth|id|session|bearer)?token|password|passwd|pwd|(?:client|api)?secret|privatekey|credential|credentials)$/.test(normalized)
}

interface RedactionLimits {
  nodes: number
  depth: number
  items: number
  chars: number
  keyChars: number
}

interface RedactionResult {
  value: unknown
  truncated: boolean
}

const ACTIVITY_LIMITS: RedactionLimits = {
  nodes: MAX_VALUE_NODES, depth: MAX_VALUE_DEPTH, items: MAX_CONTAINER_ITEMS,
  chars: MAX_TEXT_CHARS, keyChars: 256,
}
const RESULT_LIMITS: RedactionLimits = {
  nodes: 20_000, depth: 32, items: 5000, chars: 240_000, keyChars: 240_000,
}

/** 常见凭据的尽力脱敏；不是秘密检测器，也不适合独立处理彼此分离的文本 delta。 */
export function redactAgyText(text: string): string {
  return redactText(text, MAX_TEXT_CHARS, () => {})
}

function redactText(text: string, maxChars: number, markTruncated: () => void): string {
  // 先限制扫描量，再脱敏、截断，避免在截断边界保留秘密的明文前缀。
  const scan = text.slice(0, MAX_LINE_BYTES)
  const credential = '(?:authorization|proxy[-_ ]?authorization|(?:x[-_ ]?)?api[-_ ]?key|(?:access[-_ ]?|refresh[-_ ]?|auth[-_ ]?|id[-_ ]?|session[-_ ]?|bearer[-_ ]?)?token|password|passwd|pwd|(?:client[-_ ]?|api[-_ ]?)?secret|private[-_ ]?key)'
  const quotedOrToken = String.raw`(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;}]+)`
  const assignment = new RegExp(`(\\b${credential}["']?\\s*[:=]\\s*)${quotedOrToken}`, 'gi')
  let safe = scan
    .replace(/(\bauthorization["']?\s*[:=]\s*)(?:Bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}]+)/gi, `$1${REDACTED}`)
    .replace(/\bBearer\s+[^\s,;"'<>}]+/gi, `Bearer ${REDACTED}`)
    .replace(assignment, `$1${REDACTED}`)
    .replace(/\b(?:sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{16,}/g, REDACTED)
  if (safe.length > maxChars || text.length > scan.length) {
    markTruncated()
    safe = `${safe.slice(0, maxChars)}${TRUNCATED}`
  }
  return safe
}

/** 有界复制、递归脱敏；不修改调用方对象，循环/超深/超大结构明确截断。 */
export function redactAgyValue(value: unknown): unknown {
  return redactValue(value, ACTIVITY_LIMITS).value
}

function redactValue(value: unknown, limits: RedactionLimits): RedactionResult {
  const seen = new WeakSet<object>()
  let remainingNodes = limits.nodes
  let remainingChars = limits.chars
  let truncated = false
  const markTruncated = (): void => { truncated = true }
  const truncate = (): string => {
    markTruncated()
    return TRUNCATED
  }
  function visit(input: unknown, depth: number): unknown {
    if (--remainingNodes < 0 || depth > limits.depth || remainingChars <= 0) return truncate()
    if (typeof input === 'string') {
      const safe = redactText(input, remainingChars, markTruncated)
      remainingChars -= Math.min(safe.length, remainingChars)
      return safe
    }
    if (input === null || typeof input === 'number' || typeof input === 'boolean' || input === undefined) return input
    if (typeof input !== 'object') return '[UNSUPPORTED]'
    if (seen.has(input)) {
      markTruncated()
      return '[CIRCULAR]'
    }
    seen.add(input)
    if (Array.isArray(input)) {
      const output: unknown[] = []
      for (let index = 0; index < Math.min(input.length, limits.items); index++) {
        if (remainingNodes <= 0 || remainingChars <= 0) break
        output.push(visit(input[index], depth + 1))
      }
      if (output.length < input.length) output.push(truncate())
      return output
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    let count = 0
    // for-in 不为巨型对象额外分配全量 entries；只处理自有字段。
    for (const key in input) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue
      if (count++ >= limits.items || remainingNodes <= 0 || remainingChars <= 0) {
        output.__truncated__ = truncate()
        break
      }
      const safeKey = redactText(key, Math.min(limits.keyChars, remainingChars), markTruncated)
      remainingChars -= Math.min(safeKey.length, remainingChars)
      if (isCredentialKey(key)) {
        // 被隐藏的凭据也占用节点预算，避免靠大量凭据字段绕过结果上限。
        output[safeKey] = --remainingNodes < 0 ? truncate() : REDACTED
      } else {
        output[safeKey] = visit((input as Record<string, unknown>)[key], depth + 1)
      }
    }
    return output
  }
  const safe = visit(value, 0)
  return { value: safe, truncated }
}

/**
 * 有界 NDJSON 解析器。原始 UTF-8 字节仅在整行齐全后解码。
 * 以 CLI 1.4.4 的 event + 嵌套 payload 为主，同时兼容旧 flat type 记录。
 * 同一文本 step 的 delta 按完整文本行合并后脱敏并立即输出，保留未换行尾部。
 * 无换行段落可能等到 step DONE/切换、其他事件或 EOF 才输出，不承诺逐 token 实时。
 * 可防同一逻辑行内的跨 delta 凭据；跨逻辑行/step 的秘密仍不保证完全识别。
 */
export class AgyStreamParser {
  private fragments: Buffer[] = []
  private lineBytes = 0
  private discardingLine = false
  private finished = false
  private pendingText: PendingText | undefined

  constructor(private readonly onEvent: (event: ParsedEvent) => void) {}

  push(chunk: Buffer | string): void {
    if (this.finished) return
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    let start = 0
    while (start < bytes.length) {
      const newline = bytes.indexOf(10, start)
      const end = newline === -1 ? bytes.length : newline
      const length = end - start
      if (!this.discardingLine) {
        if (this.lineBytes + length > MAX_LINE_BYTES) {
          this.fragments = []
          this.lineBytes = 0
          this.discardingLine = true
          this.flushText()
          this.emit({ kind: 'warning', text: 'agy 事件行超过 256 KiB，已丢弃该行。' })
        } else if (length > 0) {
          // 复制片段，避免一个很小的尾片段持有调用方的巨大 chunk。
          this.fragments.push(Buffer.from(bytes.subarray(start, end)))
          this.lineBytes += length
        }
      }
      if (newline === -1) break
      if (!this.discardingLine) this.consumeLine()
      this.fragments = []
      this.lineBytes = 0
      this.discardingLine = false
      start = newline + 1
    }
  }

  finish(): void {
    if (this.finished) return
    this.finished = true
    if (!this.discardingLine && this.lineBytes > 0) this.consumeLine()
    this.fragments = []
    this.lineBytes = 0
    this.flushText()
  }

  private emit(event: ParsedEvent): void {
    if (event.kind === 'result') {
      // 最终结果不是活动摘要；独立扩大上限，并显式报告任何截断。
      // 已脱敏的 details 不能再次经过通用事件脱敏，否则会被静默裁成 100 项。
      const result = redactValue(event.details, RESULT_LIMITS)
      if (result.truncated) {
        this.emit({ kind: 'warning', text: 'agy 最终结果不完整：结果超过有界保留上限，已截断。' })
      }
      this.onEvent({ kind: 'result', details: result.value })
      return
    }
    // 活动摘要沿用默认上限；输出前统一覆盖元数据、工具名、文本及原始对象。
    this.onEvent(redactAgyValue(event) as ParsedEvent)
  }

  private consumeLine(): void {
    const text = Buffer.concat(this.fragments, this.lineBytes).toString('utf8').trim()
    if (!text) return
    let value: unknown
    try {
      value = JSON.parse(text) as unknown
    } catch {
      this.flushText()
      // 不附带坏行或 JSON.parse 错误中的原文，避免破损凭据绕过脱敏。
      this.emit({ kind: 'warning', text: 'agy 事件不是有效 JSON，已丢弃该行。' })
      return
    }
    if (!isRecord(value)) {
      this.flushText()
      this.emit({ kind: 'warning', text: 'agy 事件必须是 JSON 对象，已丢弃该行。' })
      return
    }
    const envelope = typeof value.event === 'string'
    const kind = envelope ? value.event : value.type
    let payload = value
    if (envelope && (kind === 'init' || kind === 'step_update' || kind === 'result')) {
      const nested = value[kind]
      if (!isRecord(nested)) {
        this.flushText()
        this.emit({ kind: 'warning', text: 'agy 事件 envelope 缺少有效的 payload，已丢弃该行。' })
        return
      }
      payload = nested
      if (kind === 'init' && typeof value.conversation_id === 'string' && nested.conversation_id === undefined) {
        payload = { conversation_id: value.conversation_id, ...nested }
      }
    }
    const stepIndex = typeof payload.step_index === 'number' && Number.isSafeInteger(payload.step_index) && payload.step_index >= 0 ? payload.step_index : undefined
    const state = typeof payload.state === 'string' ? payload.state : undefined
    if (kind === 'step_update' && payload.step_type === 'agent_response') {
      this.consumeText(payload, stepIndex, state)
      return
    }
    this.flushText()
    if (kind === 'init' || kind === 'result') {
      this.emit({ kind, details: payload })
    } else if (kind === 'step_update' && payload.step_type === 'tool') {
      const info = isRecord(payload.tool_info) ? payload.tool_info : undefined
      const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : typeof info?.name === 'string' ? info.name : undefined
      this.emit({ kind: 'tool', stepIndex, state, toolName, details: payload.tool_info })
    } else {
      this.emit({ kind: 'unknown', stepIndex, state, text: 'agy 上报了未识别的事件类型。', details: value })
    }
  }

  private consumeText(value: Record<string, unknown>, stepIndex: number | undefined, state: string | undefined): void {
    if (this.pendingText && this.pendingText.stepIndex !== stepIndex) this.flushText()
    const delta = typeof value.text_delta === 'string' ? value.text_delta : ''
    if (!this.pendingText && delta) this.pendingText = { stepIndex, state, text: '', truncated: false }
    const pending = this.pendingText
    if (!pending) return
    if (state !== undefined) pending.state = state
    let start = 0
    while (start < delta.length) {
      const newline = delta.indexOf('\n', start)
      const end = newline === -1 ? delta.length : newline + 1
      if (!pending.truncated) {
        const available = MAX_TEXT_CHARS - pending.text.length
        pending.text += delta.slice(start, Math.min(end, start + available))
        if (end - start > available) {
          pending.truncated = true
          this.emit({ kind: 'warning', stepIndex, text: 'agy 文本行超过 64 Ki 字符，后续行内正文已截断。' })
        }
      }
      if (newline !== -1) {
        if (pending.text) this.emit({ kind: 'text', stepIndex, state: pending.state, text: redactAgyText(pending.text) })
        pending.text = ''
        pending.truncated = false
      }
      start = end
    }
    if (state && /^(?:completed|complete|done|finished|success|error|failed|cancelled|canceled)$/i.test(state)) this.flushText()
  }

  private flushText(): void {
    const pending = this.pendingText
    this.pendingText = undefined
    if (!pending?.text) return
    this.emit({ kind: 'text', stepIndex: pending.stepIndex, state: pending.state, text: redactAgyText(pending.text) })
  }
}
