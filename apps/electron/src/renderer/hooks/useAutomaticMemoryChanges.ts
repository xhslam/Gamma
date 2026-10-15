import { useEffect } from 'react'
import { useStore } from 'jotai'
import { automaticMemoryChangesAtom } from '@/atoms/automatic-memory-atoms'
import { appendAutomaticMemoryChange } from '@/lib/automatic-memory-presentation'

type MemoryStore = ReturnType<typeof useStore>
const observers = new WeakMap<MemoryStore, { count: number; unsubscribe: () => void }>()

/** 全局观察者和消息列表可共同挂载；同一 Jotai store 只注册一个 IPC listener。 */
export function useAutomaticMemoryChanges(): void {
  const store = useStore()
  useEffect(() => {
    let observer = observers.get(store)
    if (!observer) {
      const unsubscribe = window.electronAPI.onAutomaticMemoryChanged((change) => {
        store.set(automaticMemoryChangesAtom, (previous) => appendAutomaticMemoryChange(previous, change))
      })
      observer = { count: 0, unsubscribe }
      observers.set(store, observer)
    }
    observer.count++
    return () => {
      observer.count--
      if (observer.count === 0) {
        observer.unsubscribe()
        observers.delete(store)
      }
    }
  }, [store])
}
