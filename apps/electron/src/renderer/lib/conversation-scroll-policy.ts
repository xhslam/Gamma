/** 会话滚动的产品阈值，不依赖第三方库内部的 near-bottom 常量。 */
export const CONVERSATION_FOLLOW_DISTANCE = 40
export const CONVERSATION_JUMP_DISTANCE = 120
export const CONVERSATION_INPUT_COOLDOWN_MS = 150

export function getConversationScrollDistance(scrollHeight: number, clientHeight: number, scrollTop: number): number {
  return Math.max(0, scrollHeight - clientHeight - Math.max(0, scrollTop))
}

export function canResumeConversationFollow(distance: number, elapsedSinceInput: number, movingTowardBottom: boolean): boolean {
  return movingTowardBottom && distance <= CONVERSATION_FOLLOW_DISTANCE && elapsedSinceInput >= CONVERSATION_INPUT_COOLDOWN_MS
}

export function isConversationScrollKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey
    && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
}
