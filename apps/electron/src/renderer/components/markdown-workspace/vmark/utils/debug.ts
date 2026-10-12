/** Gamma 宿主适配：移植模块不依赖 Tauri logger，不记录用户正文。 */
export function mdPipelineWarn(message: string, ..._details: unknown[]): void {
  console.warn('[Markdown] 解析器发现未支持的节点或属性：', message)
}
export function linkPopupError(message: string, ..._details: unknown[]): void {
  console.warn('[Markdown] 标题定位：', message)
}
export function cjkFmtWarn(message: string, ..._details: unknown[]): void {
  console.warn('[Markdown] 中文排版保护：', message)
}

export function sourcePeekError(_message: string, ..._details: unknown[]): void {
  console.warn('[Markdown] 段落源码转换失败，保留原文。')
}
