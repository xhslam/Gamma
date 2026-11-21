import { useEffect, useRef } from 'react'
import { Paperclip, Plus, MessageSquareText } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { inputToolbarButtonClass, inputToolbarPlusIconClass } from '@/components/ai-elements/input-toolbar-styles'
import { cn } from '@/lib/utils'

interface ComposerAttachmentMenuProps {
  onAttachContent: () => Promise<void>
  onReferenceConversations: () => void
}

export function ComposerAttachmentMenu({ onAttachContent, onReferenceConversations }: ComposerAttachmentMenuProps): React.ReactElement {
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null)
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alreadyActivatedRef = useRef(false)

  useEffect(() => () => {
    if (actionTimer.current) clearTimeout(actionTimer.current)
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    pendingAction.current = null
    alreadyActivatedRef.current = false
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

  /**
   * Radix 的 DropdownMenuTrigger 在 pointerdown（以及 Enter/Space 的 keydown）就已经
   * 开合菜单，随后到达的 click 不能再补发 pointerdown，否则等于第二次开合、
   * 把刚打开的菜单立刻关掉。
   *
   * 这里只记录「本次激活是否已由 pointerdown/keydown 处理」，并在配对的 click 上消费掉。
   * 旧实现用 200ms 定时器让标记自动过期：辅助技术与自动化工具常先发 pointerdown、
   * 隔一段时间再发 detail=0 的 click，超过 200ms 后标记失效就会补发 pointerdown 关掉菜单。
   * 改为按事件配对消费，不依赖任何时间窗口。
   */
  const handlePointerDown = (): void => {
    alreadyActivatedRef.current = true
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') alreadyActivatedRef.current = true
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (alreadyActivatedRef.current) {
      alreadyActivatedRef.current = false
      return
    }
    // 完全没有前置 pointerdown 的合成 click（如 `element.click()`）才补发一次交给 Radix。
    event.currentTarget.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      button: 0,
      ctrlKey: false,
    }))
    alreadyActivatedRef.current = false
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
              className={cn(inputToolbarButtonClass, inputToolbarPlusIconClass)}
              aria-label="添加附件或引用对话"
              onPointerDown={handlePointerDown}
              onKeyDown={handleKeyDown}
              onClick={handleClick}
            >
              <Plus />
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
