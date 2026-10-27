type WeChatSendResponse = {
  ret?: unknown
  errcode?: unknown
  errmsg?: unknown
}

function readOptionalStatusCode(response: WeChatSendResponse, field: 'ret' | 'errcode'): number | undefined {
  const value = response[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`微信 iLink sendmessage 返回了无效 ${field}`)
  }
  return value
}

/** Accept iLink's documented empty success response while rejecting explicit failures. */
export function assertWeChatSendSucceeded(response: unknown): void {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('微信 iLink sendmessage 返回了无效响应')
  }

  const typed = response as WeChatSendResponse
  const ret = readOptionalStatusCode(typed, 'ret')
  const errcode = readOptionalStatusCode(typed, 'errcode')
  if (ret !== undefined && ret !== 0) throw new Error(`微信 iLink sendmessage 失败: ret=${ret}`)
  if (errcode !== undefined && errcode !== 0) throw new Error(`微信 iLink sendmessage 失败: errcode=${errcode}`)
}
