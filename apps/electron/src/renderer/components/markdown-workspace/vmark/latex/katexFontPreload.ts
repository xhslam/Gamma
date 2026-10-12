// 移植自 xiaolai/vmark @ 07c40609；Copyright (c) 2026 Xiaolai Li，ISC 许可见 vmark/LICENSE。
/**
 * Purpose: load KaTeX's web fonts while the editor is still small, before a
 * math-heavy document needs them.
 *
 * WebKit re-resolves style for the WHOLE document each time a web font
 * finishes loading. KaTeX spreads its glyphs over 20 faces that load on first
 * use, so scrolling a large math document into a bold, AMS or big-delimiter
 * glyph for the first time restyled everything: ~400 ms per new face on a
 * 420K-char textbook, measured in real WebKit, and gone when the faces were
 * loaded before the document opened.
 *
 * Key decisions:
 *   - Only faces the KaTeX stylesheet declared (family `KaTeX_*`), and only
 *     those still unloaded; `FontFace.load()` is a no-op for the rest.
 *   - Once per window: the FontFaceSet belongs to the document, and a face
 *     loads once.
 *   - A window whose document declares no KaTeX face yet (stylesheet not
 *     attached) is not marked done, so a later call can still do the work.
 *   - Idle-scheduled: it must not compete with the editor's first render.
 *
 * @coordinates-with plugins/latex/tiptapInlineMath.ts — schedules it when an editor is created
 * @coordinates-with main.tsx — imports the KaTeX stylesheet that declares the faces
 * @module plugins/latex/katexFontPreload
 */

let preloaded = false;

const KATEX_FAMILY = /^["']?KaTeX_/;

/** Start loading every declared, still-unloaded KaTeX font face. */
export function preloadKatexFonts(): void {
  if (preloaded) return;
  const fonts: FontFaceSet | undefined =
    typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return;
  let declared = false;
  fonts.forEach((face) => {
    if (!KATEX_FAMILY.test(face.family)) return;
    declared = true;
    if (face.status === "unloaded") void face.load().catch(() => undefined);
  });
  if (declared) preloaded = true;
}

/** {@link preloadKatexFonts} at the next idle moment. */
export function scheduleKatexFontPreload(): void {
  if (preloaded) return;
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => preloadKatexFonts(), { timeout: 2000 });
  } else {
    setTimeout(preloadKatexFonts, 0);
  }
}

/** Test seam: forget that the fonts were requested. */
export function resetKatexFontPreloadForTest(): void {
  preloaded = false;
}
