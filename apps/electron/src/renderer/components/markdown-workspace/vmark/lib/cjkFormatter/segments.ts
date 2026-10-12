// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Formattable Segment Extraction and Reconstruction
 *
 * Purpose: Splits markdown text into formattable segments (the gaps between
 * protected regions) and reassembles the document after the segments have
 * been formatted. Split out of markdownParser.ts, which owns protected-region
 * detection.
 *
 * A segment also records what its edges ARE, because the rules cannot see
 * past them: whether each edge is a real line edge, and whether its first
 * character is the `)` closing a link whose URL is the protected region to
 * its left.
 *
 * Invariant: `protectedRegions` must be sorted by start and non-overlapping,
 * exactly as returned by `findProtectedRegions` (which coalesces overlapping
 * or contained regions). Overlapping regions would make reconstruction emit
 * the overlapped range twice.
 *
 * @coordinates-with markdownParser.ts — findProtectedRegions produces the regions
 * @coordinates-with formatter.ts — calls extract before and reconstruct after formatting
 * @module lib/cjkFormatter/segments
 */

import type { ProtectedRegion } from "./types";

/**
 * A text segment that should be formatted (a non-protected region).
 *
 * The two edge flags exist because the line-anchored rules — `removeTrailingSpaces`
 * (`/ +$/gm`) and `collapseSpaces` — run on a segment, not on the document, and
 * a segment boundary is NOT a line boundary. Without them, the space in
 * `使用 \`printf\` 函数` sat at the end of the segment `使用 ` and was deleted as
 * end-of-line trailing whitespace: a CJK/Latin spacer deleting CJK/Latin
 * spacing, on every inline code span, image, wiki link, footnote reference,
 * inline math span and HTML tag in the document.
 */
export interface TextSegment {
  start: number;
  end: number;
  text: string;
  /** The character BEFORE `start` is a line break, or `start` is offset 0. */
  startsAtLineStart: boolean;
  /**
   * The character AT `end` is a line break, or `end` is the end of the text.
   *
   * Note it describes what FOLLOWS the segment, not its last character: a
   * segment that swallows the newline and stops at a fence reports `false`.
   * That is harmless — the rule consults this only for the segment's LAST
   * line, which in that case is empty.
   */
  endsAtLineEnd: boolean;
  /**
   * Defined when the segment begins with the `)` closing a link whose URL is the
   * protected region ending at `start`: that link's visible text. See
   * `FormatOptions.linkLabel`.
   */
  linkLabel: string | undefined;
}

/** Any ECMAScript line terminator, so CRLF documents behave like LF ones. */
const isLineBreak = (ch: string | undefined): boolean => ch !== undefined && /[\n\r]/.test(ch);

/**
 * The visible text of the inline link whose URL is `region`, when the
 * character right after the region is that link's closing `)`; otherwise
 * undefined.
 *
 * `[text](url)` protects only `url`, so `](` ends the segment on the left and
 * `)` begins the one on the right — where, with nothing to say otherwise, it
 * reads as an ordinary closing parenthesis. Trailing emphasis and code
 * markers are dropped so `[**GitHub**](url)` reports `GitHub`: the question a
 * rule asks of this is which character the reader sees last.
 */
function closedLinkLabel(text: string, region: ProtectedRegion): string | undefined {
  if (region.type !== "link_url") return undefined;
  if (text[region.end] !== ")") return undefined;
  const labelEnd = region.start - 2;
  if (labelEnd < 1 || text[labelEnd] !== "]" || text[labelEnd + 1] !== "(") return undefined;
  const labelStart = text.lastIndexOf("[", labelEnd - 1) + 1;
  return text.slice(labelStart, labelEnd).replace(/[*_~`]+$/, "");
}

/**
 * Extract text segments that should be formatted (non-protected regions).
 *
 * Each segment reports whether its edges coincide with real line edges of the
 * FULL text, which the rules cannot otherwise know — see `TextSegment`.
 */
export function extractFormattableSegments(
  text: string,
  protectedRegions: ProtectedRegion[]
): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentPos = 0;

  let previous: ProtectedRegion | undefined;

  const push = (start: number, end: number): void => {
    segments.push({
      start,
      end,
      text: text.slice(start, end),
      startsAtLineStart: start === 0 || isLineBreak(text[start - 1]),
      endsAtLineEnd: end >= text.length || isLineBreak(text[end]),
      linkLabel: previous ? closedLinkLabel(text, previous) : undefined,
    });
  };

  for (const region of protectedRegions) {
    if (region.start > currentPos) push(currentPos, region.start);
    currentPos = region.end;
    previous = region;
  }

  // Add remaining text after last protected region
  if (currentPos < text.length) push(currentPos, text.length);

  return segments;
}

/**
 * Reconstruct the full text after formatting segments.
 */
export function reconstructText(
  originalText: string,
  formattedSegments: TextSegment[],
  protectedRegions: ProtectedRegion[]
): string {
  const parts: { start: number; text: string }[] = [];

  // Add protected regions
  for (const region of protectedRegions) {
    parts.push({
      start: region.start,
      text: originalText.slice(region.start, region.end),
    });
  }

  // Add formatted segments
  for (const segment of formattedSegments) {
    parts.push({
      start: segment.start,
      text: segment.text,
    });
  }

  // Sort by original position and join
  parts.sort((a, b) => a.start - b.start);
  return parts.map((p) => p.text).join("");
}
