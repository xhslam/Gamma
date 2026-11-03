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
  useEffect(() => () => {
    if (actionTimer.current) clearTimeout(actionTimer.current)
    pendingAction.current = null
  }, [])

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
          const action = pendingAction.current
          if (!action) return
          // 等菜单退出、焦点锁与 body pointer-events 都释放后再打开原生窗口。
          // 否则菜单的自动回焦会与 macOS 文件选择 sheet 抢焦点。
          event.preventDefault()
          pendingAction.current = null
          actionTimer.current = setTimeout(() => {
            actionTimer.current = null
            void action()
          }, 0)
        }}
      >
        <DropdownMenuItem
          onSelect={() => { pendingAction.current = onAttachContent }}
          className="flex items-center gap-2 cursor-pointer text-xs"
        >
          <Paperclip className="size-3.5" />
          <span>附加文件或文件夹</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => { pendingAction.current = onReferenceConversations }}
          className="flex items-center gap-2 cursor-pointer text-xs"
        >
          <MessageSquareText className="size-3.5" />
          <span>引用对话</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
