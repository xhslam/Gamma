/**
 * @pierre/diffs 共享样式常量
 *
 * 与 DiffView.tsx 保持一致的颜色方案，
 * 供 edit-result / write-result / read-result 等工具渲染器复用。
 */

/** Pierre diffs 主题颜色 CSS — 注入到 unsafeCSS */
export const PIERRE_DIFF_CSS = `
  :root, :host {
    --diffs-bg: transparent;
    --diffs-fg: hsl(var(--foreground));
    --diffs-fg-number: hsl(var(--muted-foreground));
    --diffs-modified-base: hsl(var(--primary));
    --diffs-mixer: hsl(var(--foreground));
    --diffs-bg-context: hsl(var(--muted));
    --diffs-bg-buffer: hsl(var(--muted));
    --diffs-bg-separator: hsl(var(--background));
    --diffs-bg-addition: hsl(var(--muted));
    --diffs-bg-deletion: hsl(var(--primary) / 0.08);
    --diffs-bg-addition-emphasis: hsl(var(--muted));
    --diffs-bg-deletion-emphasis: hsl(var(--primary) / 0.16);
    --diffs-addition-base: hsl(var(--success));
    --diffs-deletion-base: hsl(var(--destructive));
    --diffs-addition-bg: hsl(var(--muted));
    --diffs-deletion-bg: hsl(var(--primary) / 0.08);
    --diffs-separator-bg: hsl(var(--background));
    --diffs-gap-style: 3px solid hsl(var(--content-area));
    --diffs-scrollbar-thumb: light-dark(hsl(var(--muted-foreground) / 0.6), hsl(var(--muted-foreground) / 0.2));
    --diffs-scrollbar-thumb-hover: light-dark(hsl(var(--muted-foreground) / 0.8), hsl(var(--muted-foreground) / 0.35));
  }
  [data-line] span { color: hsl(var(--foreground)) !important; background-color: transparent !important; }
  [data-code]::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  [data-code]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-code]::-webkit-scrollbar-thumb {
    background: var(--diffs-scrollbar-thumb);
    border-radius: 3px;
  }
  [data-code]::-webkit-scrollbar-thumb:hover {
    background: var(--diffs-scrollbar-thumb-hover);
  }
  [data-code]::-webkit-scrollbar-corner {
    background: transparent;
  }
  [data-separator=line-info],
  [data-separator=line-info] [data-separator-wrapper],
  [data-separator=line-info] [data-separator-content],
  [data-separator=line-info] [data-expand-button] {
    background-color: var(--diffs-separator-bg) !important;
  }
  [data-line-type=change-addition] {
    background-color: var(--diffs-addition-bg) !important;
  }
  [data-line-type=change-deletion] {
    background-color: var(--diffs-deletion-bg) !important;
  }
  [data-line-type=change-addition] [data-column-number],
  [data-line-type=change-addition] [data-gutter-buffer]:not([data-gutter-buffer=buffer]) {
    color: hsl(var(--success)) !important;
    background-color: var(--diffs-addition-bg) !important;
  }
  [data-line-type=change-deletion] [data-column-number],
  [data-line-type=change-deletion] [data-gutter-buffer]:not([data-gutter-buffer=buffer]) {
    color: hsl(var(--destructive)) !important;
    background-color: var(--diffs-deletion-bg) !important;
  }
  [data-gutter-buffer=buffer] {
    background: none !important;
  }
  [data-line-type=context] [data-column-number],
  [data-line-type=metadata] [data-column-number],
  [data-line-type=expanded] [data-column-number],
  [data-gutter] {
    background-color: hsl(var(--content-area)) !important;
  }
`

/** Pierre File 组件的 CSS — 纯代码预览（无 diff 行类型） */
export const PIERRE_FILE_CSS = `
  :root, :host {
    --diffs-bg: transparent;
    --diffs-fg: hsl(var(--foreground));
    --diffs-fg-number: hsl(var(--muted-foreground));
    --diffs-modified-base: hsl(var(--primary));
    --diffs-mixer: hsl(var(--foreground));
    --diffs-bg-context: hsl(var(--muted));
    --diffs-bg-buffer: hsl(var(--muted));
    --diffs-bg-separator: hsl(var(--background));
    --diffs-bg-addition: hsl(var(--muted));
    --diffs-bg-deletion: hsl(var(--primary) / 0.08);
    --diffs-bg-addition-emphasis: hsl(var(--muted));
    --diffs-bg-deletion-emphasis: hsl(var(--primary) / 0.16);
    --diffs-scrollbar-thumb: light-dark(hsl(var(--muted-foreground) / 0.6), hsl(var(--muted-foreground) / 0.2));
    --diffs-scrollbar-thumb-hover: light-dark(hsl(var(--muted-foreground) / 0.8), hsl(var(--muted-foreground) / 0.35));
  }
  [data-line] span { color: hsl(var(--foreground)) !important; background-color: transparent !important; }
  [data-code]::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  [data-code]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-code]::-webkit-scrollbar-thumb {
    background: var(--diffs-scrollbar-thumb);
    border-radius: 3px;
  }
  [data-code]::-webkit-scrollbar-thumb:hover {
    background: var(--diffs-scrollbar-thumb-hover);
  }
  [data-code]::-webkit-scrollbar-corner {
    background: transparent;
  }
  [data-column-number],
  [data-gutter] {
    background-color: hsl(var(--content-area)) !important;
  }
`

/**
 * 为 Read 工具的 partial read 修正 PierreFile 行号。
 *
 * Claude SDK 的 Read 结果常带 cat -n 行号；渲染前会剥离这些前缀以避免双行号，
 * 这里再把 Pierre 的 gutter 起始值调整回真实文件行号。
 */
export function createPierreFileCSS(lineNumberStart: number, maxLineNumber: number): string {
  const safeStart = Number.isFinite(lineNumberStart) ? Math.max(1, Math.floor(lineNumberStart)) : 1
  const safeMax = Number.isFinite(maxLineNumber) ? Math.max(safeStart, Math.floor(maxLineNumber)) : safeStart
  const minWidth = `${Math.max(3, String(safeMax).length)}ch`

  if (safeStart === 1) {
    return `
      ${PIERRE_FILE_CSS}
      :root, :host {
        --diffs-min-number-column-width: ${minWidth};
      }
    `
  }

  return `
    ${PIERRE_FILE_CSS}
    :root, :host {
      --diffs-min-number-column-width: ${minWidth};
    }
    [data-gutter] {
      counter-reset: gamma-read-line ${safeStart - 1};
    }
    /* color: transparent 隐藏 Pierre 自带的相对行号；
     * text-shadow: none 阻断 Terminal 主题的 CRT 辉光继承——否则
     * transparent 文字会被 text-shadow 画出模糊轮廓，与 ::before 真实行号叠加。 */
    [data-line-number-content] {
      color: transparent !important;
      text-shadow: none !important;
    }
    [data-line-number-content]::before {
      counter-increment: gamma-read-line;
      content: counter(gamma-read-line);
      color: var(--diffs-fg-number);
    }
  `
}
