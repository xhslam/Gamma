/** 会话消息检索公共契约。 */

export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * 消息搜索结果
 */
export interface SessionMessageSearchResult {
  /** 消息 ID */
  messageId: string
  /** 消息角色 */
  role: MessageRole
  /** 匹配上下文片段，完整保留命中的查询文本 */
  snippet: string
  /** snippet 内匹配起始位置 */
  matchStart: number
  /** 匹配长度 */
  matchLength: number
}

export interface SessionMessageSearchResponse {
  /** 当前查询返回的最佳命中 */
  results: SessionMessageSearchResult[]
  /** 为防止主进程资源耗尽，是否只检索了当前会话的可索引前缀 */
  truncated: boolean
  /** 查询文本过长，已拒绝模糊匹配以保护事件循环 */
  queryTooLong: boolean
}
