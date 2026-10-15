/**
 * AI Elements - 对话容器原语
 *
 * 基于 use-stick-to-bottom 实现自动滚动到底部的对话容器。
 * 移植自 gamma-frontend 的 ai-elements/conversation.tsx。
 *
 * 包含：
 * - Conversation — 根容器（StickToBottom）
 * - ConversationContent — 内容区域
 * - ConversationEmptyState — 空状态
 * - ConversationScrollButton — 滚动到底部按钮
 */

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowDownIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { createContext, useCallback, useContext, useLayoutEffect } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { useConversationScrollPolicy } from '@/hooks/useConversationScrollPolicy'
import { attachScrollFade } from '@/components/ui/scroll-fade'
import { CONVERSATION_JUMP_DISTANCE } from '@/lib/conversation-scroll-policy'

const ConversationDistanceContext = createContext(0)

export function useConversationJumpVisible(): boolean {
  return useContext(ConversationDistanceContext) > CONVERSATION_JUMP_DISTANCE
}

// ===== Conversation 根容器 =====

export type ConversationProps = ComponentProps<typeof StickToBottom>

export function Conversation({ className, children, initial = 'instant', resize = 'instant', targetScrollTop, mass, damping, stiffness, instance, ...props }: ConversationProps): React.ReactElement {
  const policy = useConversationScrollPolicy({ initial, resize, targetScrollTop, mass, damping, stiffness })
  return (
    <ConversationDistanceContext.Provider value={policy.distance}>
      <StickToBottom
        className={cn('relative min-h-0 flex-1 overflow-y-hidden scrollbar-none', className)}
        instance={instance ?? policy.instance}
        role="log"
        {...props}
      >
        {children}
      </StickToBottom>
    </ConversationDistanceContext.Provider>
  )
}

// ===== ConversationContent 内容区域 =====

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

export function ConversationContent({ className, ...props }: ConversationContentProps): React.ReactElement {
  const { scrollRef } = useStickToBottomContext()
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    // 仅消息视口羽化，输入框、迷你地图和覆盖层保持清晰。
    return attachScrollFade(element, { fadeSize: 24 })
  }, [scrollRef])
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-1 py-4 px-8', className)}
      {...props}
    />
  )
}

// ===== ConversationEmptyState 空状态 =====

export interface ConversationEmptyStateProps extends ComponentProps<'div'> {
  title?: string
  description?: string
  icon?: React.ReactNode
}

export function ConversationEmptyState({
  className,
  title = '暂无消息',
  description = '在下方输入框开始对话',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <div className="space-y-1">
            <h3 className="font-medium text-sm">{title}</h3>
            {description && (
              <p className="text-muted-foreground text-sm">{description}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ===== ConversationScrollButton 滚动到底部 =====

export type ConversationScrollButtonProps = ComponentProps<typeof Button>

export function ConversationScrollButton({
  className,
  ...props
}: ConversationScrollButtonProps): React.ReactElement | null {
  const { scrollToBottom } = useStickToBottomContext()
  const distance = useContext(ConversationDistanceContext)

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth')
  }, [scrollToBottom])

  if (distance <= CONVERSATION_JUMP_DISTANCE) return null

  return (
    <Button
      className={cn(
        'absolute bottom-[26px] left-1/2 -translate-x-1/2 rounded-[17px] size-9',
        'bg-card shadow-sm hover:bg-accent/80',
        className
      )}
      onClick={handleScrollToBottom}
      aria-label="跳至最新消息"
      title="跳至最新消息"
      type="button"
      variant="ghost"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  )
}
