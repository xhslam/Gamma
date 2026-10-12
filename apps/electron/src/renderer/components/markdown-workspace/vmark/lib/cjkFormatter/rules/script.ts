// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Which script a construct sits in, decided from its ADJACENT
 * characters.
 *
 * Purpose: a few rules have no single correct output across CJK. The ellipsis
 * is `……` in Chinese (GB/T 15834) and Japanese (JIS X 4051) but `…` in Korean
 * and `...` in Latin text, and only the Latin form takes a following space.
 *
 * Key decision — adjacency, not a document-level guess. `containsCJK` is
 * evaluated per SEGMENT, and a segment spans everything between two protected
 * regions, so "the document's script" is in practice the whole file's. A
 * document-level detector would rewrite the `...` inside an English quotation
 * in a Chinese file. Reading the immediate neighbours is local, needs no
 * detection pass, and is the same principle `normalizeFullwidthPunctuation`
 * uses to decide punctuation width.
 *
 * @coordinates-with universal.ts — normalizeEllipsis, the only consumer today
 * @coordinates-with shared.ts — the one definition of a CJK letter
 * @module lib/cjkFormatter/rules/script
 */

import { codePointAt, codePointBefore, isCJKLetter, isHangulLetter } from "./shared";

/**
 * The script family a rule should format for.
 *
 * Han, Kana and Bopomofo collapse into one bucket on purpose: every rule that
 * consults this treats Chinese and Japanese identically, and the two cannot be
 * told apart from a single Han character anyway.
 */
export type AdjacentScript = "han" | "hangul" | "none";

/**
 * Classify the character immediately before `start` or immediately after
 * `end`, whichever is CJK.
 *
 * Whitespace and line breaks are NOT skipped: a construct separated from a CJK
 * character by a space is not attached to it, the same rule the punctuation
 * width test applies.
 */
export function adjacentScript(text: string, start: number, end: number): AdjacentScript {
  // Whole code points, so a supplementary-plane Han character is read as one
  // character rather than a lone surrogate.
  const before = codePointBefore(text, start);
  const after = codePointAt(text, end);

  for (const ch of [before, after]) {
    if (ch === "") continue;
    if (isCJKLetter(ch)) return "han";
    if (isHangulLetter(ch)) return "hangul";
  }
  return "none";
}
