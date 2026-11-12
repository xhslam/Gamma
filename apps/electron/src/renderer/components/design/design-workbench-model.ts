import type { DesignArtifact, DesignArtifactKind } from '@gamma/shared'

export const DESIGN_ARTIFACT_TYPES: ReadonlyArray<{ kind: DesignArtifactKind; label: string; hint: string }> = [
  { kind: 'canvas', label: '设计画布', hint: '界面、多画板与交互原型' },
  { kind: 'whiteboard', label: '白板', hint: '流程图、思维导图与自由协作' },
  { kind: 'slides', label: '幻灯片', hint: '编辑、放映与 PowerPoint 导出' },
  { kind: 'system', label: '设计系统', hint: '品牌、Tokens、组件与素材' },
  { kind: 'dashboard', label: '数据看板', hint: '数据、图表与来源追溯' },
  { kind: 'motion', label: '动画', hint: '时间线、播放与影片导出' },
]
export type DesignSort = 'recent' | 'created' | 'name'

export function filterDesignArtifacts(artifacts: readonly DesignArtifact[], query: string, kind: DesignArtifactKind | 'all', sort: DesignSort): DesignArtifact[] {
  const needle = query.trim().toLocaleLowerCase()
  return artifacts.filter((item) => (kind === 'all' || item.kind === kind) && (!needle || `${item.title}\n${item.rootPath}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt - a.createdAt : (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))
}
