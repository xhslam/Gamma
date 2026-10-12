// 移植自 xiaolai/vmark @ 07c40609；Copyright (c) 2026 Xiaolai Li，ISC 许可见 vmark/LICENSE。
/**
 * Purpose: render inline LaTeX with KaTeX once per distinct source, then reuse
 * the result by cloning it.
 *
 * Inline math repeats heavily in real documents: in a 11,142-formula math
 * textbook only 4,440 sources were distinct (`$0$` alone appeared 605 times).
 * KaTeX parses and lays out every call from scratch; a deep clone of the tree
 * it already built is a fraction of that.
 *
 * Key decisions:
 *   - The cache holds a DETACHED clone, never a live node, and every hit is
 *     cloned again, so no two node views ever share DOM.
 *   - Cloning, not `innerHTML`: KaTeX already produced the DOM, and reparsing a
 *     string of it would be both slower and a trusted-HTML sink.
 *   - Keyed by source alone. That is sound only while the render options are
 *     constant — no shared `macros` object, whose `\gdef`s would make the
 *     output depend on what rendered before. Adding one means keying on it.
 *   - Bounded LRU so a document with endless distinct formulas cannot grow it
 *     without limit.
 *
 * @coordinates-with plugins/latex/scheduleInlineMathRender.ts — the only caller
 * @module plugins/latex/inlineMathRenderCache
 */

import type { KatexModule } from "../shared/katexLoader";

/** Distinct formulas kept. A rendered inline formula is a few KB of DOM. */
export const INLINE_MATH_CACHE_LIMIT = 2000;

const cache = new Map<string, Node>();

/**
 * Render `latex` as inline math into `target`, replacing its children.
 * Throws whatever KaTeX throws (with `throwOnError: false`, only on a
 * programming error — a bad formula renders KaTeX's own error span).
 */
export function renderInlineMath(katex: KatexModule, latex: string, target: HTMLElement): void {
  const hit = cache.get(latex);
  if (hit) {
    // Refresh recency: Map iteration order is insertion order.
    cache.delete(latex);
    cache.set(latex, hit);
    target.replaceChildren(hit.cloneNode(true));
    return;
  }

  // KaTeX clears the target itself; doing it here too means whatever is left
  // afterwards is KaTeX's output and nothing else, which is what gets cached.
  target.replaceChildren();
  katex.default.render(latex, target, {
    throwOnError: false, displayMode: false, strict: false, trust: false,
    output: 'htmlAndMathml', maxExpand: 1000, maxSize: 20,
    // 每次重新创建，避免公式中的 gdef 污染之后的渲染和缓存。
    macros: { '\\centernot': '\\not' },
  });

  if (target.childNodes.length !== 1) return;
  cache.set(latex, target.firstChild!.cloneNode(true));
  if (cache.size > INLINE_MATH_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Test seam: forget every cached render. */
export function clearInlineMathRenderCache(): void {
  cache.clear();
}

/** Test seam: how many distinct formulas are cached. */
export function inlineMathRenderCacheSize(): number {
  return cache.size;
}
