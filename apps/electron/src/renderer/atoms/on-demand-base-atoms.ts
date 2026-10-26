/**
 * on-demand-base-atoms — 按需面板基础 Atom 定义
 *
 * 仅包含原子级瞬时浮层状态定义，不引入其他业务/组件依赖，避免循环引用。
 */

import { atom } from 'jotai'
import type { OnDemandOverlayTab } from '@/lib/right-panel-state'

/** S1 激活的按需浮层 Tab，null 表示 S1 关闭（瞬时状态，不持久化） */
export const activeOnDemandOverlayAtom = atom<OnDemandOverlayTab | null>(null)

export interface DiffFetchStatus {
  loading: boolean
  error: string | null
}

/** 浮层与角标共享的改动数据首取与刷新状态，按 diffCacheKey 隔离 */
export const agentDiffStatusAtom = atom<Map<string, DiffFetchStatus>>(new Map())
