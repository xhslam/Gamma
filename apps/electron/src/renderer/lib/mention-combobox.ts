/** 每个编辑器只有当前 popup 拥有 ARIA；旧异步请求/React effect 不得清理或复活新列表。 */
export interface MentionComboboxBinding {
  listId: string
  onActiveDescendantChange: (id: string | undefined) => void
  setLoading: (loading: boolean) => void
  dispose: () => void
}

const owners = new WeakMap<HTMLElement, MentionComboboxBinding>()

export function bindMentionCombobox(editor: HTMLElement, popupRole: 'tree' | 'listbox'): MentionComboboxBinding {
  owners.get(editor)?.dispose()
  const listId = `gamma-mention-list-${crypto.randomUUID()}`
  const preserved = new Map(['role', 'aria-haspopup', 'aria-autocomplete', 'aria-busy']
    .map((name) => [name, editor.getAttribute(name)]))
  let loading = false
  let updateVersion = 0
  const binding: MentionComboboxBinding = {
    listId,
    onActiveDescendantChange(id) {
      const version = ++updateVersion
      if (owners.get(editor) !== binding) return
      editor.removeAttribute('aria-activedescendant')
      if (!id || loading) return
      const apply = (): void => {
        if (owners.get(editor) !== binding || loading || version !== updateVersion) return
        const list = document.getElementById(listId)
        const option = document.getElementById(id)
        if (list && option && list.contains(option)) editor.setAttribute('aria-activedescendant', id)
      }
      apply()
      // ReactRenderer 的 effect 可能先于 popup 挂载到 body；只在本帧补做一次，不轮询。
      if (!editor.hasAttribute('aria-activedescendant')) requestAnimationFrame(apply)
    },
    setLoading(value) {
      if (owners.get(editor) !== binding) return
      loading = value
      editor.setAttribute('aria-busy', String(value))
      if (value) {
        updateVersion += 1
        editor.removeAttribute('aria-activedescendant')
      }
    },
    dispose() {
      if (owners.get(editor) !== binding) return
      owners.delete(editor)
      updateVersion += 1
      for (const [name, value] of preserved) {
        if (value === null) editor.removeAttribute(name)
        else editor.setAttribute(name, value)
      }
      editor.setAttribute('aria-expanded', 'false')
      editor.removeAttribute('aria-controls')
      editor.removeAttribute('aria-activedescendant')
    },
  }
  owners.set(editor, binding)
  editor.setAttribute('role', 'combobox')
  editor.setAttribute('aria-expanded', 'true')
  editor.setAttribute('aria-controls', listId)
  editor.setAttribute('aria-haspopup', popupRole)
  editor.setAttribute('aria-autocomplete', 'list')
  editor.setAttribute('aria-busy', 'false')
  return binding
}
