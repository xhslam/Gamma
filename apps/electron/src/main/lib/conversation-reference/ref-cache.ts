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
 * 获取分块摘要缓存子目录
 */
export function getChunkSummaryCacheDir(): string {
  const dir = join(getConversationRefCacheDir(), 'chunks')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 计算规范化单分块消息列表的 SHA-256 结构化哈希
 * 严格包含 sourceConversationId 与字段长度前缀，防止跨源混用及分隔串歧义碰撞
 */
export function computeChunkHash(
  sourceConversationId: string,
  chunkIndex: number,
  messages: readonly NormalizedReferencedMessage[],
): string {
  const hash = createHash('sha256')
  hash.update(`src:${sourceConversationId.length}:${sourceConversationId}\n`)
  hash.update(`idx:${chunkIndex}\n`)
  for (const m of messages) {
    hash.update(`msg:${m.id.length}:${m.id}:${m.role.length}:${m.role}:${Buffer.byteLength(m.content, 'utf8')}:${m.content}\n`)
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const t of m.toolCalls) {
        hash.update(`tool:${t.name.length}:${t.name}:${(t.keyParam ?? '').length}:${t.keyParam ?? ''}:${(t.resultSummary ?? '').length}:${t.resultSummary ?? ''}\n`)
      }
    }
    if (m.attachments && m.attachments.length > 0) {
      for (const a of m.attachments) {
        hash.update(`att:${a.name.length}:${a.name}:${(a.type ?? '').length}:${a.type ?? ''}\n`)
      }
    }
  }
  return hash.digest('hex').slice(0, 32)
}

/**
 * 分块摘要持久化数据结构
 */
export interface CachedChunkSummary {
  sourceConversationId: string
  chunkIndex: number
  chunkHash: string
  version: string
  createdAt: number
  summary: string
}

/**
 * 获取分块摘要缓存文件路径（严格绑定源会话与分块哈希）
 */
export function getChunkSummaryCacheFilePath(
  sourceSessionId: string,
  chunkHash: string,
): string {
  const safeSession = sanitizeFileNamePart(sourceSessionId)
  const safeHash = sanitizeFileNamePart(chunkHash)
  return join(getChunkSummaryCacheDir(), `${safeSession}_${safeHash}_${SUMMARY_SCHEMA_VERSION}.json`)
}

/**
 * 保存分块摘要到磁盘缓存（原子写）
 */
export function saveChunkSummaryToCache(entry: CachedChunkSummary): void {
  try {
    const filePath = getChunkSummaryCacheFilePath(entry.sourceConversationId, entry.chunkHash)
    writeJsonFileAtomic(filePath, entry)
  } catch (error) {
    console.warn('[会话引用缓存] 保存分块摘要失败:', error)
  }
}

/**
 * 从磁盘读取分块摘要缓存（严格核对源会话与分块哈希）
 */
export function loadChunkSummaryFromCache(
  sourceSessionId: string,
  chunkHash: string,
): string | null {
  try {
    const filePath = getChunkSummaryCacheFilePath(sourceSessionId, chunkHash)
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as CachedChunkSummary
    if (!parsed || parsed.sourceConversationId !== sourceSessionId || parsed.chunkHash !== chunkHash || typeof parsed.summary !== 'string') {
      return null
    }
    return parsed.summary
  } catch (error) {
    console.warn('[会话引用缓存] 读取分块摘要失败:', error)
    return null
  }
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
 * 获取基于 refId 的不可变快照文件路径
 */
export function getSnapshotCacheFilePathByRefId(refId: string): string {
  const safeRef = sanitizeFileNamePart(refId)
  return join(getSnapshotCacheDir(), `${safeRef}.json`)
}

/**
 * 获取快照缓存文件路径（兼容旧接口）
 */
export function getSnapshotCacheFilePath(sourceSessionIdOrRefId: string, snapshotUpToMessageId?: string): string {
  if (!snapshotUpToMessageId) {
    return getSnapshotCacheFilePathByRefId(sourceSessionIdOrRefId)
  }
  const safeSession = sanitizeFileNamePart(sourceSessionIdOrRefId)
  const safeMsg = sanitizeFileNamePart(snapshotUpToMessageId)
  return join(getSnapshotCacheDir(), `${safeSession}_${safeMsg}.json`)
}

/**
 * 原子冻结 refId 快照；错误向调用方传播，防止只保存引用而未冻结内容
 */
export function saveSnapshotToCache(snapshot: CachedConversationSnapshot): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(snapshot.refId)) throw new Error('无效的快照引用 ID')
  writeJsonFileAtomic(getSnapshotCacheFilePathByRefId(snapshot.refId), snapshot)
}

/**
 * 按 refId 读取并验证快照摘要；缺失或损坏时返回空，不从源重建
 */
export function loadSnapshotFromCache(
  refIdOrSessionId: string,
  snapshotUpToMessageId?: string,
): CachedConversationSnapshot | null {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(refIdOrSessionId)) return null
  try {
    const path = getSnapshotCacheFilePathByRefId(refIdOrSessionId)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedConversationSnapshot
    if (!parsed || parsed.refId !== refIdOrSessionId || !Array.isArray(parsed.messages)
      || typeof parsed.contentHash !== 'string'
      || (snapshotUpToMessageId !== undefined && parsed.snapshotUpToMessageId !== snapshotUpToMessageId)
      || parsed.messages.some((m) => !m || typeof m.id !== 'string' || typeof m.content !== 'string' || !['user', 'assistant', 'tool'].includes(m.role))
      || computeSnapshotHash(parsed.messages) !== parsed.contentHash) return null
    return parsed
  } catch {
    console.warn('[会话引用缓存] 快照不可读，已跳过')
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
