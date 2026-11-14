import { useEffect, useRef } from 'react'
import { Paperclip, Plus, MessageSquareText } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'

interface ComposerAttachmentMenuProps {
  onAttachContent: () => Promise<void>
  onReferenceConversations: () => void
}

export function ComposerAttachmentMenu({ onAttachContent, onReferenceConversations }: ComposerAttachmentMenuProps): React.ReactElement {
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null)
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerDownHandledRef = useRef(false)
  const pointerDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (actionTimer.current) clearTimeout(actionTimer.current)
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    if (pointerDownTimerRef.current) clearTimeout(pointerDownTimerRef.current)
    pendingAction.current = null
  }, [])

  const executePendingAction = () => {
    if (fallbackTimer.current) {
      clearTimeout(fallbackTimer.current)
      fallbackTimer.current = null
    }
    if (actionTimer.current) {
      clearTimeout(actionTimer.current)
      actionTimer.current = null
    }
    const action = pendingAction.current
    if (!action) return
    pendingAction.current = null
    actionTimer.current = setTimeout(() => {
      actionTimer.current = null
      void action()
    }, 0)
  }

  const scheduleAction = (action: () => void | Promise<void>) => {
    pendingAction.current = action
    // 兜底定时器：若 onCloseAutoFocus 因焦点丢失、快捷键或动画未触发，确保仍能调用动作
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    fallbackTimer.current = setTimeout(() => {
      executePendingAction()
    }, 350)
  }

  const handlePointerDown = () => {
    pointerDownHandledRef.current = true
    if (pointerDownTimerRef.current) clearTimeout(pointerDownTimerRef.current)
    pointerDownTimerRef.current = setTimeout(() => {
      pointerDownHandledRef.current = false
    }, 200)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      pointerDownHandledRef.current = true
      if (pointerDownTimerRef.current) clearTimeout(pointerDownTimerRef.current)
      pointerDownTimerRef.current = setTimeout(() => {
        pointerDownHandledRef.current = false
      }, 200)
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pointerDownHandledRef.current) {
      pointerDownHandledRef.current = false
      return
    }
    // 无 pointerdown 触发的点击（如辅助功能或自动化测试 click()），派发 PointerEvent 激活 Radix 触发器
    e.currentTarget.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      button: 0,
      ctrlKey: false,
    }))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={inputToolbarButtonClass}
              aria-label="添加附件或引用对话"
              onPointerDown={handlePointerDown}
              onKeyDown={handleKeyDown}
              onClick={handleClick}
            >
              <Plus className="size-[17px]" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top"><p>添加附件或引用对话</p></TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-48"
        onCloseAutoFocus={(event) => {
          if (!pendingAction.current) return
          // 等菜单退出、焦点锁与 body pointer-events 都释放后再打开原生窗口。
          // 否则菜单的自动回焦会与 macOS 文件选择 sheet 抢焦点。
          event.preventDefault()
          executePendingAction()
        }}
      >
        <DropdownMenuItem
          onSelect={() => { scheduleAction(onAttachContent) }}
          className="flex items-center gap-2 cursor-pointer text-xs"
        >
          <Paperclip className="size-3.5" />
          <span>附加文件或文件夹</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => { scheduleAction(onReferenceConversations) }}
          className="flex items-center gap-2 cursor-pointer text-xs"
        >
          <MessageSquareText className="size-3.5" />
          <span>引用对话</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
