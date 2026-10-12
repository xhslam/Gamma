// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Latin Span Scanner
 *
 * Purpose: Identifies "Latin spans" (runs of ASCII-ish characters) within text
 * that contains CJK characters. These spans protect punctuation inside technical
 * constructs (URLs, versions, decimals, times) from being converted to fullwidth.
 *
 * Key decisions:
 *   - The technical constructs themselves are found by technicalSubspans.ts;
 *     this module finds the spans and answers "what is at this position"
 *   - Spans and subspans are sorted and disjoint, and looked up by binary
 *     search: the punctuation rule asks once per punctuation mark
 *   - Surrogate pair awareness: supplementary-plane CJK (Extensions B-G) are
 *     handled by advancing 2 code units at a time
 *   - Whitespace-only spans are discarded to avoid false positives
 *   - A span character is a Latin LETTER by script, not by ASCII range, so an
 *     accented word is one span rather than several
 *   - Korean (Hangul) is not a CJK letter here, since its spacing rules differ
 *
 * Spec Reference: Rule 2, Section 2.1 of cjk-typography-rules-draft.md
 *
 * @coordinates-with rules.ts — normalizeFullwidthPunctuation uses isInTechnicalSubspan
 * @coordinates-with quotePairing.ts — isCJKLetter reused for CJK boundary detection
 * @coordinates-with rules/shared.ts — the one definition of a CJK and of a Latin letter
 * @coordinates-with technicalSubspans.ts — finds the constructs inside one span
 * @module lib/cjkFormatter/latinSpanScanner
 */

import { isCJKLetter, isLatinLetter } from "./rules/shared";
import { findTechnicalSubspans, type TechnicalSubspan } from "./technicalSubspans";

// Re-exported: this module is where callers outside the rules have always
// found it. The definition itself lives in rules/shared.ts.
export { isCJKLetter };
export type { TechnicalSubspan };

export interface LatinSpan {
  /** Start position in the original text */
  start: number;
  /** End position in the original text (exclusive) */
  end: number;
  /** The Latin span text */
  text: string;
  /** Technical subspans within this Latin span (positions relative to span start) */
  subspans: TechnicalSubspan[];
}

/**
 * Check if a character can be part of a Latin span
 * Allowed: Latin letters, 0-9, whitespace, common ASCII punctuation
 */
function isLatinSpanChar(char: string): boolean {
  const code = char.charCodeAt(0);

  // Newline breaks spans
  if (char === "\n") return false;

  // Latin letters, accented ones included
  if (isLatinLetter(char)) return true;

  // Digits 0-9
  if (code >= 0x30 && code <= 0x39) return true;

  // Whitespace (space, tab)
  if (char === " " || char === "\t") return true;

  // Common ASCII punctuation used in prose/tech
  const allowedPunctuation = '.,!?;:\'"()[]{}<>/-_@#&=+*%$\\|~`^';
  if (allowedPunctuation.includes(char)) return true;

  return false;
}

/**
 * Scan text for Latin spans (runs of ASCII-ish characters between CJK)
 *
 * @param text The text to scan
 * @returns Array of Latin spans with their positions and technical subspans
 */
export function scanLatinSpans(text: string): LatinSpan[] {
  const spans: LatinSpan[] = [];
  let spanStart = -1;
  let i = 0;

  while (i < text.length) {
    const char = text[i]!;

    // Check for surrogate pairs (CJK Extension B-G)
    let fullChar = char;
    if (
      char.charCodeAt(0) >= 0xd800 &&
      char.charCodeAt(0) <= 0xdbff &&
      i + 1 < text.length
    ) {
      fullChar = char + text[i + 1]!;
    }

    const isCJK = isCJKLetter(fullChar);
    const isLatin = !isCJK && isLatinSpanChar(char);
    const isNewline = char === "\n";

    if (isLatin && spanStart === -1) {
      // Start a new Latin span
      spanStart = i;
    } else if ((!isLatin || isNewline) && spanStart !== -1) {
      // End the current Latin span
      const spanText = text.slice(spanStart, i);
      // Only add non-empty spans (trim whitespace-only spans)
      if (spanText.trim().length > 0) {
        spans.push({
          start: spanStart,
          end: i,
          text: spanText,
          subspans: findTechnicalSubspans(spanText),
        });
      }
      spanStart = -1;
    }

    // Advance by 2 for surrogate pairs
    if (fullChar.length === 2) {
      i += 2;
    } else {
      i += 1;
    }
  }

  // Handle span at end of text
  if (spanStart !== -1) {
    const spanText = text.slice(spanStart);
    if (spanText.trim().length > 0) {
      spans.push({
        start: spanStart,
        end: text.length,
        text: spanText,
        subspans: findTechnicalSubspans(spanText),
      });
    }
  }

  return spans;
}

/**
 * The index of the range containing `position`, or -1.
 *
 * A binary search, so `ranges` must be sorted by start and non-overlapping —
 * which is how `scanLatinSpans` and `findTechnicalSubspans` return them. The
 * punctuation rule asks once per punctuation mark; walking the list instead
 * made a document of many short spans cost its length squared.
 */
function indexOfRangeAt(
  position: number,
  ranges: ReadonlyArray<{ start: number; end: number }>
): number {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (position < ranges[mid]!.start) high = mid - 1;
    else if (position >= ranges[mid]!.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Check if a position is inside any Latin span
 */
export function isInLatinSpan(position: number, spans: LatinSpan[]): boolean {
  return indexOfRangeAt(position, spans) !== -1;
}

/**
 * Get the technical subspan at a position, if any
 */
export function getTechnicalSubspanAt(
  position: number,
  spans: LatinSpan[]
): TechnicalSubspan | null {
  const span = spans[indexOfRangeAt(position, spans)];
  if (!span) return null;
  return span.subspans[indexOfRangeAt(position - span.start, span.subspans)] ?? null;
}

/**
 * Check if a position is inside a technical subspan (URL, version, etc.)
 */
export function isInTechnicalSubspan(
  position: number,
  spans: LatinSpan[]
): boolean {
  return getTechnicalSubspanAt(position, spans) !== null;
}
