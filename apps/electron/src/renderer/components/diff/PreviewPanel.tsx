/** 右侧工作区中的单个文件预览内容。标题与关闭由外层动态 Tab 承担。 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { getPreviewFileId, type PreviewFile } from '@/atoms/preview-atoms'
import { agentSessionPathMapAtom } from '@/atoms/agent-atoms'
import { DiffTabContent } from './DiffTabContent'
import { PreviewContentErrorBoundary } from './PreviewContentErrorBoundary'

interface PreviewPanelProps {
  sessionId: string
  file: PreviewFile
  onClose: () => void
  focused?: boolean
}

function PreviewPanelContent({ sessionId, file, onClose, focused }: PreviewPanelProps): React.ReactElement {
  const sessionPath = useAtomValue(agentSessionPathMapAtom).get(sessionId) ?? ''
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-content-area titlebar-no-drag">
      <div className="min-h-0 flex-1 overflow-hidden">
        <PreviewContentErrorBoundary resetKey={`${sessionId}:${file.filePath}`}>
          <DiffTabContent
            key={`${sessionId}:${file.filePath}`}
            filePath={file.filePath}
            dirPath={file.dirPath || sessionPath}
            sessionId={sessionId}
            gitRoot={file.gitRoot}
            previewOnly={file.previewOnly}
            readOnly={file.readOnly}
            basePaths={file.basePaths}
            unrestricted={file.unrestricted}
            workspaceSkillSlug={file.workspaceSkillSlug}
            legacySkillFilePath={file.legacySkillFilePath}
            baseRef={file.baseRef}
            htmlPreviewTarget={focused === undefined ? undefined : { id: getPreviewFileId(file), focused }}
            imageEditorPresentation="inline"
            onEmptyDiff={onClose}
          />
        </PreviewContentErrorBoundary>
      </div>
    </div>
  )
}

/** Pure file previews only re-render when their own file descriptor changes. */
export const PreviewPanel = React.memo(PreviewPanelContent, (previous, next) => {
  if (previous.sessionId !== next.sessionId || previous.file !== next.file || previous.focused !== next.focused) return false
  // previewOnly never calls onEmptyDiff, so its parent callback must not defeat render isolation.
  return previous.file.previewOnly || previous.onClose === next.onClose
})
