/**
 * 会话引用缓存管理 (Conversation Reference Cache Manager)
 *
 * 管理 ~/.gamma/conversation-ref-cache/ 中的规范化快照与结构化模型摘要缓存。
 * 遵循本地优先原则，所有文件写入均使用 safe-file 的原子写保证一致性。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getConfigDir } from '../config-paths'
import { writeJsonFileAtomic } from '../safe-file'
import type { NormalizedReferencedMessage } from './context-builder'

/** 摘要架构版本 */
export const SUMMARY_SCHEMA_VERSION = 'v1'

/**
 * 快照持久化数据结构
 */
export interface CachedConversationSnapshot {
  refId: string
  sourceConversationId: string
  sourceProjectId: string
  title: string
  snapshotUpToMessageId: string
  snapshotAt: number
  messageCount: number
  estTokens: number
  contentHash: string
  messages: NormalizedReferencedMessage[]
  previousReferencedTitles?: string[]
}

/**
 * 结构化摘要持久化数据结构
 */
export interface CachedConversationSummary {
  sourceConversationId: string
  snapshotUpToMessageId: string
  contentHash: string
  version: string
  createdAt: number
  summary: string
}

/**
 * 获取会话引用缓存主目录：~/.gamma/conversation-ref-cache
 */
export function getConversationRefCacheDir(): string {
  const base = join(getConfigDir(), 'conversation-ref-cache')
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
  }
  return base
}

/**
 * 获取快照缓存子目录
 */
export function getSnapshotCacheDir(): string {
  const dir = join(getConversationRefCacheDir(), 'snapshots')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取摘要缓存子目录
 */
export function getSummaryCacheDir(): string {
  const dir = join(getConversationRefCacheDir(), 'summaries')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 计算规范化消息列表的 SHA-256 稳定哈希
 */
export function computeSnapshotHash(messages: readonly NormalizedReferencedMessage[]): string {
  const hash = createHash('sha256')
  for (const m of messages) {
    hash.update(`${m.id}:${m.role}:${m.content}:`)
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const t of m.toolCalls) {
        hash.update(`${t.name}:${t.keyParam ?? ''}:${t.resultSummary ?? ''};`)
      }
    }
    if (m.attachments && m.attachments.length > 0) {
      for (const a of m.attachments) {
        hash.update(`${a.name}:${a.type ?? ''};`)
      }
    }
  }
  return hash.digest('hex').slice(0, 32)
}

/** 安全清理路径中的特殊字符，防路径遍历 */
function sanitizeFileNamePart(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * 获取快照缓存文件路径
 */
export function getSnapshotCacheFilePath(sourceSessionId: string, snapshotUpToMessageId: string): string {
  const safeSession = sanitizeFileNamePart(sourceSessionId)
  const safeMsg = sanitizeFileNamePart(snapshotUpToMessageId)
  return join(getSnapshotCacheDir(), `${safeSession}_${safeMsg}.json`)
}

/**
 * 保存规范化快照到磁盘缓存（原子写）
 */
export function saveSnapshotToCache(snapshot: CachedConversationSnapshot): void {
  try {
    const filePath = getSnapshotCacheFilePath(snapshot.sourceConversationId, snapshot.snapshotUpToMessageId)
    writeJsonFileAtomic(filePath, snapshot)
  } catch (error) {
    console.warn('[会话引用缓存] 保存快照失败:', error)
  }
}

/**
 * 从磁盘读取快照缓存
 */
export function loadSnapshotFromCache(
  sourceSessionId: string,
  snapshotUpToMessageId: string,
): CachedConversationSnapshot | null {
  try {
    const filePath = getSnapshotCacheFilePath(sourceSessionId, snapshotUpToMessageId)
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as CachedConversationSnapshot
    if (!parsed || parsed.sourceConversationId !== sourceSessionId) {
      return null
    }
    return parsed
  } catch (error) {
    console.warn('[会话引用缓存] 读取快照失败:', error)
    return null
  }
}

/**
 * 获取摘要缓存文件路径
 */
export function getSummaryCacheFilePath(
  sourceSessionId: string,
  snapshotUpToMessageId: string,
  contentHash: string,
): string {
  const safeSession = sanitizeFileNamePart(sourceSessionId)
  const safeMsg = sanitizeFileNamePart(snapshotUpToMessageId)
  const safeHash = sanitizeFileNamePart(contentHash)
  return join(getSummaryCacheDir(), `${safeSession}_${safeMsg}_${safeHash}_${SUMMARY_SCHEMA_VERSION}.json`)
}

/**
 * 保存模型结构化摘要到磁盘缓存（原子写）
 */
export function saveSummaryToCache(summary: CachedConversationSummary): void {
  try {
    const filePath = getSummaryCacheFilePath(
      summary.sourceConversationId,
      summary.snapshotUpToMessageId,
      summary.contentHash,
    )
    writeJsonFileAtomic(filePath, summary)
  } catch (error) {
    console.warn('[会话引用缓存] 保存摘要失败:', error)
  }
}

/**
 * 从磁盘读取结构化摘要缓存
 */
export function loadSummaryFromCache(
  sourceSessionId: string,
  snapshotUpToMessageId: string,
  contentHash: string,
): string | null {
  try {
    const filePath = getSummaryCacheFilePath(sourceSessionId, snapshotUpToMessageId, contentHash)
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as CachedConversationSummary
    if (!parsed || typeof parsed.summary !== 'string') return null
    return parsed.summary
  } catch (error) {
    console.warn('[会话引用缓存] 读取摘要失败:', error)
    return null
  }
}
