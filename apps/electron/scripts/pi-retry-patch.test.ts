import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isRetryableAssistantError } from '@earendil-works/pi-ai'
import type { AssistantMessage } from '@earendil-works/pi-ai'

// 与 bun.lock 校验的 pi-ai 1.3.0 tarball 中该段保持一致，包含容易被旧补丁遗漏的 HTTP/2 注释。
const pristineContext = `    // "stream ended without ..." and "Anthropic stream ended before message_stop"
    // (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
    "ended without",
    "stream ended before message_stop",
    "stream ended before a terminal response event",
    "http2 request did not get a response",
    // Node ERR_HTTP2_STREAM_CANCEL: the HTTP/2 session died before the request was
    // sent, e.g. after the Bedrock SDK's 5-minute session timeout (#10379).
    "pending stream has been canceled",
`

describe('Given 冻结锁文件中的 Pi 重试补丁', () => {
  test('When 在干净的 1.3.0 原始上下文应用 Then 成功保留上游 HTTP/2 处理和新增匹配', () => {
    const root = mkdtempSync(join(tmpdir(), 'gamma-pi-patch-'))
    try {
      mkdirSync(join(root, 'dist', 'utils'), { recursive: true })
      const file = join(root, 'dist', 'utils', 'retry.js')
      writeFileSync(file, pristineContext)
      const patch = resolve(import.meta.dir, '../../../patches/@earendil-works%2Fpi-ai@1.3.0.patch')
      execFileSync('git', ['apply', '--check', patch], { cwd: root, stdio: 'pipe' })
      execFileSync('git', ['apply', patch], { cwd: root, stdio: 'pipe' })
      const applied = readFileSync(file, 'utf8')
      expect(applied).toContain('pending stream has been canceled')
      expect(applied).toContain('\\\\bstream_read_error\\\\b')
      expect(applied).toContain('incomplete chunked read')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('When 运行已安装 SDK Then 传输断连仍可重试，用户取消和额度耗尽不重试', () => {
    const error = (errorMessage: string, stopReason: AssistantMessage['stopReason'] = 'error'): AssistantMessage => ({
      role: 'assistant', content: [], api: 'openai-responses', provider: 'test', model: 'test', stopReason, errorMessage,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 0,
    })
    for (const message of ['stream_read_error', 'stream ended before a terminal event', 'peer closed connection', 'incomplete chunked read', 'TypeError: Failed to fetch', 'pending stream has been canceled']) {
      expect(isRetryableAssistantError(error(message))).toBe(true)
    }
    expect(isRetryableAssistantError(error('stream_read_error', 'aborted'))).toBe(false)
    expect(isRetryableAssistantError(error('insufficient_quota'))).toBe(false)
  })
})
