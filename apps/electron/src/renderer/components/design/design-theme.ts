import * as React from 'react'
import type { DesignThemeSnapshot } from '@gamma/shared'

/** 将 Chromium 已解析的颜色转换为有限十六进制数据，避免把任意 CSS 通过 IPC 传到编辑器。 */
export function designColorToHex(value: string): string {
  const match = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/)
  if (!match) throw new Error(`无法解析 Gamma 主题颜色: ${value}`)
  const bytes = [Number(match[1]), Number(match[2]), Number(match[3])].map((channel) => Math.round(Math.max(0, Math.min(255, channel))))
  if (match[4] !== undefined) bytes.push(Math.round(Math.max(0, Math.min(1, Number(match[4]))) * 255))
  return `#${bytes.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function readGammaDesignTheme(root: HTMLElement = document.documentElement): DesignThemeSnapshot {
  const doc = root.ownerDocument
  const view = doc.defaultView
  if (!view) throw new Error('Gamma 主题文档不可用')
  const probe = doc.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;'
  root.appendChild(probe)
  const color = (name: string): string => {
    probe.style.color = `hsl(var(--${name}))`
    return designColorToHex(view.getComputedStyle(probe).color)
  }
  try {
    probe.style.borderRadius = 'var(--radius)'
    const radius = Number.parseFloat(view.getComputedStyle(probe).borderRadius)
    return {
      mode: root.classList.contains('dark') ? 'dark' : 'light',
      background: color('background'), panel: color('panel'), inset: color('inset'),
      text: color('foreground'), secondary: color('muted-foreground'), tertiary: color('tertiary-foreground'),
      border: color('border'), accent: color('primary'), accentText: color('primary-foreground'),
      danger: color('destructive'), ring: color('ring'),
      fontFamily: view.getComputedStyle(root).fontFamily.replace(/\s+/g, ' '),
      radius: Number.isFinite(radius) ? Math.max(0, Math.min(32, radius)) : 6,
    }
  } finally { probe.remove() }
}

/** 监听实际主题 DOM，兼容浅/深色、跟随系统及特殊风格，不仅同步一个 dark 布尔值。 */
export function useDesignEditorTheme(artifactId: string, browserUrl: string | undefined): void {
  React.useEffect(() => {
    let frame = 0
    let disposed = false
    let last = ''
    const sync = (): void => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed) return
        try {
          const snapshot = readGammaDesignTheme()
          const serialized = JSON.stringify(snapshot)
          if (serialized === last) return
          last = serialized
          void window.electronAPI.updateDesignTheme(artifactId, snapshot).catch((error: unknown) => {
            if (!disposed) { last = ''; console.warn('[design] 主题同步失败:', error) }
          })
        } catch (error) { console.warn('[design] 无法读取当前 Gamma 主题:', error) }
      })
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    sync()
    return () => { disposed = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [artifactId, browserUrl])
}
