import DOMPurify from 'dompurify'
import katex from 'katex'
import * as katexModule from 'katex'
import { sanitizeMathContent } from './notes-markdown-dialect'
import { renderInlineMath } from '../vmark/latex/inlineMathRenderCache'

/** Auris 的公式兼容处理只用于渲染副本；VMark 缓存仅保存离线 DOM。 */
export function renderMathMarkup(text: string, displayMode: boolean): string {
  return DOMPurify.sanitize(katex.renderToString(sanitizeMathContent(text), {
    displayMode, strict: false, throwOnError: false, trust: false,
    output: 'htmlAndMathml', maxExpand: 1000, maxSize: 20,
    macros: { '\\centernot': '\\not' },
  }))
}

export function renderMathInto(target: HTMLElement, text: string, displayMode: boolean): void {
  if (displayMode) target.innerHTML = renderMathMarkup(text, true)
  else renderInlineMath(katexModule, sanitizeMathContent(text), target)
}
