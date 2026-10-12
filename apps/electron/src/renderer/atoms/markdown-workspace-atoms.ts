import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import { atomWithStorage } from 'jotai/utils'
import { initialMarkdownWorkspaceState } from '../components/markdown-workspace/markdown-document-controller'

/** 面板关闭不会移除草稿；项目/会话身份是明确的 key，不共享一个全局当前文档。 */
export const markdownWorkspaceStateAtomFamily = atomFamily((scope: string) => {
  void scope
  return atom(initialMarkdownWorkspaceState())
})

/** 侧边栏开启状态，持久化到 localStorage */
export const markdownSidebarOpenAtom = atomWithStorage<boolean>(
  'gamma:markdown:sidebar-open',
  false,
  undefined,
  { getOnInit: true }
)

/** 侧边栏视图模式（文件树 vs 目录大纲），持久化到 localStorage */
export const markdownSidebarViewModeAtom = atomWithStorage<'files' | 'outline'>(
  'gamma:markdown:sidebar-view-mode',
  'files',
  undefined,
  { getOnInit: true }
)

/** 文件树展开的目录路径集合，持久化到 localStorage */
export const markdownExpandedFoldersAtom = atomWithStorage<string[]>(
  'gamma:markdown:expanded-folders',
  [],
  undefined,
  { getOnInit: true }
)
