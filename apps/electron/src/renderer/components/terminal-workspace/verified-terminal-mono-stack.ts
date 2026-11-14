/**
 * Adapted from VMark v0.9.94, src/services/fonts/verifiedMonoStack.ts,
 * commit 00ad428592dc5e80aab5afc8878a3f8c3bd27930.
 * The measured drop-the-head algorithm is retained; Auris supplies its CSS
 * stack instead of VMark settings/platform helpers.
 *
 * ISC License
 *
 * Copyright (c) 2026 Xiaolai Li
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
const REPEAT = 32;

/**
 * Probe size in px. Deliberately larger than any UI font size: `offsetWidth` is
 * an integer, and at small sizes the rounding gap between a wide and a narrow
 * glyph can close enough to make a proportional font look uniform.
 */
const PROBE_PX = 32;

/** Mean advance of `char` under `stack`, or null when there is no DOM. */
function advance(stack: string, char: string): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;font-kerning:none;";
  span.style.fontSize = `${PROBE_PX}px`;
  span.style.fontFamily = stack;
  span.textContent = char.repeat(REPEAT);
  document.body.appendChild(span);
  const width = span.offsetWidth;
  span.remove();
  return width / REPEAT;
}

/**
 * True when `stack` renders with a uniform advance — i.e. really monospace.
 *
 * Returns true when the engine cannot be measured, so a DOM-less caller keeps
 * whatever it asked for rather than being silently downgraded.
 */
export function stackRendersMonospace(stack: string): boolean {
  const wide = advance(stack, "W");
  const narrow = advance(stack, "i");
  if (wide === null || narrow === null) return true;
  // A zero-width measurement means the span never laid out (detached document,
  // display:none ancestor). That is "cannot measure", not "not monospace".
  if (wide === 0 && narrow === 0) return true;
  return wide === narrow;
}

const memo = new Map<string, string>();

/**
 * Drop leading families until the remainder renders monospace.
 *
 * Exported for tests, which inject `rendersMonospace` so the algorithm can be
 * driven deterministically without depending on which fonts a machine happens
 * to have installed — the exact dependency that let the previous version of
 * this guard pass everywhere while the bug was live.
 */
export function narrowToMonospace(
  stack: string,
  rendersMonospace: (candidate: string) => boolean = stackRendersMonospace,
): string {
  const families = stack
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (!families.length) return stack;

  for (let i = 0; i < families.length; i++) {
    const candidate = families.slice(i).join(", ");
    if (rendersMonospace(candidate)) return candidate;
  }
  // Nothing in the stack measured monospace, the bare generic included. Return
  // the generic anyway: it is the engine's own idea of a fixed-pitch font and
  // there is no better answer left.
  return families[families.length - 1] ?? "monospace";
}

/** Auris already resolves a CSS stack; validate that stack directly. */
export function verifiedMonoStack(preferred: string): string {
  const cached = memo.get(preferred);
  if (cached !== undefined) return cached;
  const verified = narrowToMonospace(preferred);
  memo.set(preferred, verified);
  return verified;
}
