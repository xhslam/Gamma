/**
 * MermaidBlock - Mermaid 图表渲染组件
 *
 * 优先使用 beautiful-mermaid 渲染，遇到 beautiful-mermaid 不支持的图型时
 * 自动回退到官方 mermaid 渲染器。
 *
 * 渲染时序：
 *   流式输出 → 源码自然增长（零跳动）
 *   code 稳定 350ms → 后台 renderMermaid
 *   成功 → SVG 替换源码展示
 *   失败 → 保持源码展示
 *
 * 防竞态：generation 计数器，只有最新一代的渲染结果才会生效
 *
 * 缩放交互：仅头部按钮（缩小 / 重置 / 放大）。不响应滚轮和拖拽，
 * 让滚轮事件正常冒泡到页面滚动；放大后用容器原生 overflow scrollbar 浏览。
 */

import * as React from 'react'
import type { RenderOptions } from 'beautiful-mermaid'

interface MermaidBlockProps {
  /** mermaid 源码 */
  code: string
  /** 覆盖默认剪贴板实现（Electron 可注入主进程剪贴板） */
  onCopy?: (text: string) => Promise<void>
}

/** 防抖间隔（ms） */
const DEBOUNCE_MS = 350
/** 缩放范围 */
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const ZOOM_STEP = 0.15
const INITIAL_SCALE = 1
let mermaidRenderId = 0

function isDarkMode(host: Element): boolean {
  return getComputedStyle(host).colorScheme === 'dark'
}

/** 共享组件从宿主 CSS 取色，不维护第二套图表色板。 */
function getThemeOptions(host: Element): RenderOptions {
  const style = getComputedStyle(host)
  const color = (role: string): string => style.getPropertyValue(`--color-${role}`).trim()
  return { bg: color('background'), fg: color('text'), line: color('secondary'), accent: color('accent'), muted: color('tertiary'), surface: color('panel'), border: color('border') }
}

function isUsableSvg(svg: unknown): svg is string {
  if (typeof svg !== 'string' || !svg.includes('<svg')) return false
  if (/(?:^|[^a-z])(?:NaN|Infinity|-Infinity)(?:[^a-z]|$)/i.test(svg)) return false
  // mermaid 解析失败时会返回带错误标记的 SVG，需要识别后走兜底
  if (svg.includes('aria-roledescription="error"')) return false
  if (svg.includes('class="error-text"')) return false
  return true
}

async function renderWithOfficialMermaid(code: string, host: Element): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  const dark = isDarkMode(host)
  const colors = getThemeOptions(host)
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // 解析/绘制失败时清理临时节点并抛错，而非把错误图注入 document.body
    // （后者会在页面底部残留一条孤立的 "Syntax error in text" bar）
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: {
      darkMode: dark,
      background: colors.bg, mainBkg: colors.surface,
      primaryColor: colors.surface, primaryTextColor: colors.fg, primaryBorderColor: colors.border,
      secondaryColor: colors.surface, secondaryTextColor: colors.fg, secondaryBorderColor: colors.border,
      tertiaryColor: colors.bg, tertiaryTextColor: colors.fg, tertiaryBorderColor: colors.border,
      lineColor: colors.line, textColor: colors.fg, nodeTextColor: colors.fg,
      clusterBkg: colors.bg, clusterBorder: colors.border, edgeLabelBackground: colors.bg,
      titleColor: colors.fg, noteBkgColor: colors.surface, noteTextColor: colors.fg, noteBorderColor: colors.border,
      actorBkg: colors.surface, actorTextColor: colors.fg, actorBorder: colors.border,
      signalColor: colors.line, signalTextColor: colors.fg, labelBoxBkgColor: colors.surface,
      labelBoxBorderColor: colors.border, labelTextColor: colors.fg, loopTextColor: colors.fg,
      activationBkgColor: colors.surface, activationBorderColor: colors.border,
      errorBkgColor: colors.surface, errorTextColor: colors.fg,
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`pie${i + 1}`, i % 2 ? colors.surface : colors.accent])),
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`cScale${i}`, i % 2 ? colors.surface : colors.accent])),
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`git${i}`, colors.accent])),
    },
  })

  const variables: Record<string, unknown> = mermaid.mermaidAPI.getConfig().themeVariables ?? {}
  const paletteVariables = Object.fromEntries(Object.entries(variables).map(([name, value]) => {
    if (typeof value !== 'string' || value === 'transparent' || !CSS.supports('color', value)) return [name, value]
    const color = /text|title|label/i.test(name) ? colors.fg
      : /border|stroke/i.test(name) ? colors.border
      : /line|grid/i.test(name) ? colors.line
      : /crit|active|git\d|pie\d|cScale\d/i.test(name) ? colors.accent : colors.surface
    return [name, color]
  }))
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables: paletteVariables })

  const id = `gamma-mermaid-${Date.now()}-${mermaidRenderId++}`
  const { svg } = await mermaid.render(id, code)
  if (!isUsableSvg(svg)) throw new Error('Mermaid 输出了无效 SVG')
  return svg
}

async function renderMermaidSvg(code: string, host: Element): Promise<string> {
  try {
    const { renderMermaidSVGAsync } = await import('beautiful-mermaid')
    const svg = await renderMermaidSVGAsync(code, getThemeOptions(host))
    if (isUsableSvg(svg)) {
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
      const root = parsed.documentElement
      root.setAttribute('style', `${root.getAttribute('style') ?? ''};--_text-faint:var(--color-tertiary);--_group-hdr:var(--color-inset);--_inner-stroke:var(--color-border);--_key-badge:var(--color-inset)`)
      return root.outerHTML
    }
  } catch {
    // beautiful-mermaid 只覆盖部分图型，不支持时交给官方 mermaid 兜底。
  }

  return renderWithOfficialMermaid(code, host)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ===== 图标（与 CodeBlock 一致） =====

const ICON_ATTRS = {
  width: 14, height: 14, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}
const copyIconPath = (
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
)
const checkIconPath = <polyline points="20 6 9 17 4 12" />
const zoomInPath = (
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </>
)
const zoomOutPath = (
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </>
)

// ===== 主组件 =====

export function MermaidBlock({ code, onCopy }: MermaidBlockProps): React.ReactElement {
  const [renderedSvg, setRenderedSvg] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [scale, setScale] = React.useState<number>(INITIAL_SCALE)

  const hostRef = React.useRef<HTMLDivElement>(null)
  const codeRef = React.useRef(code)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** generation 计数器：每次 code 变化递增，防止异步竞态 */
  const generationRef = React.useRef(0)

  codeRef.current = code

  const renderCurrentCode = React.useCallback(async (generation: number) => {
    try {
      const svg = await renderMermaidSvg(codeRef.current, hostRef.current ?? document.documentElement)
      if (generationRef.current !== generation) return
      setRenderedSvg(svg)
    } catch {
      if (generationRef.current === generation) setRenderedSvg(null)
    }
  }, [])

  // ==== 唯一的渲染 effect：全部走防抖，generation 防竞态 ====
  React.useEffect(() => {
    // 每次 code 变化递增 generation，作废所有旧的异步渲染
    generationRef.current++
    const currentGen = generationRef.current

    if (debounceRef.current) clearTimeout(debounceRef.current)
    setRenderedSvg(null)
    setScale(INITIAL_SCALE)
    debounceRef.current = setTimeout(() => {
      void renderCurrentCode(currentGen)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [code, renderCurrentCode])

  // ---- 主题变化：重新渲染当前 code ----
  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let signature = JSON.stringify(getThemeOptions(host))
    const observer = new MutationObserver(() => {
      const next = JSON.stringify(getThemeOptions(host))
      if (next === signature) return
      signature = next
      generationRef.current++
      void renderCurrentCode(generationRef.current)
    })
    // 文档的局部主题和全局主题都可能变化；不监听 SVG 子树，避免自身渲染触发循环。
    for (let ancestor: Element | null = host; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style'] })
    }
    return () => observer.disconnect()
  }, [renderCurrentCode])

  const handleZoomIn = React.useCallback(() => {
    setScale((prev) => clamp(prev + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))
  }, [])
  const handleZoomOut = React.useCallback(() => {
    setScale((prev) => clamp(prev - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))
  }, [])
  const handleZoomReset = React.useCallback(() => setScale(INITIAL_SCALE), [])

  const handleCopy = React.useCallback(async () => {
    try {
      await (onCopy ? onCopy(code) : navigator.clipboard.writeText(code))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('[MermaidBlock] 复制失败:', error)
    }
  }, [code])

  const zoomPercent = Math.round(scale * 100)

  return (
    <div ref={hostRef} className="mermaid-block-wrapper group/mermaid rounded-lg overflow-hidden my-2 border border-border/50">
      {/* 头部栏 */}
      <div className="flex items-center justify-between h-[34px] px-2 py-1 bg-muted/60 text-muted-foreground text-xs">
        <span className="font-medium select-none">Mermaid</span>
        <div className="flex items-center gap-1">
          {renderedSvg && (
            <div className="flex items-center gap-0.5 mr-2">
              <button data-icon-button="true" type="button" onClick={handleZoomOut} className="p-0.5 rounded hover:bg-foreground/10 transition-colors" title="缩小">
                <svg {...ICON_ATTRS}>{zoomOutPath}</svg>
              </button>
              <button type="button" onClick={handleZoomReset} className="px-1 py-0.5 rounded hover:bg-foreground/10 transition-colors min-w-[40px] text-center tabular-nums" title="重置缩放">
                {zoomPercent}%
              </button>
              <button data-icon-button="true" type="button" onClick={handleZoomIn} className="p-0.5 rounded hover:bg-foreground/10 transition-colors" title="放大">
                <svg {...ICON_ATTRS}>{zoomInPath}</svg>
              </button>
            </div>
          )}
          <button type="button" onClick={handleCopy} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-foreground/10 transition-colors text-muted-foreground hover:text-foreground">
            <svg {...ICON_ATTRS}>{copied ? checkIconPath : copyIconPath}</svg>
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>

      <div className="overflow-hidden">
        {!renderedSvg ? (
          <pre
            className="mermaid-block-scroll overflow-x-auto p-4 m-0 text-[13px] leading-[1.6] bg-muted/30 text-foreground/80"
          >
            <code>{code}</code>
          </pre>
        ) : (
          <div className="mermaid-block-scroll bg-background overflow-auto min-h-[180px]">
            <div className="flex w-max min-w-full items-center justify-start p-4 min-h-[180px]">
              <div
                className="mermaid-svg inline-block [&>svg]:block [&>svg]:h-auto"
                style={{ zoom: scale }}
                dangerouslySetInnerHTML={{ __html: renderedSvg }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
