import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useCreateSession } from '@/hooks/useCreateSession'
import { detectIsMac } from '@/lib/platform'

export function NewAgentWindowShortcut(): null {
  const { createAgent } = useCreateSession()
  const creating = useRef(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mac = detectIsMac()
      if (!(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
        || !event.shiftKey || event.altKey || event.code !== 'KeyN' || event.isComposing) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat || creating.current) return
      creating.current = true
      void (async () => {
        try {
          const id = await createAgent({ open: false })
          if (!id || !await window.electronAPI.detachAgentWindow(id, false)) toast.error('无法在新窗口创建任务')
        } catch {
          toast.error('无法在新窗口创建任务')
        } finally {
          creating.current = false
        }
      })()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [createAgent])
  return null
}
