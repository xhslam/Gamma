// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Inline Span Detectors for the Protected-Region Scanner
 *
 * Purpose: detectors 3 through 11 — the constructs that live INSIDE a line
 * rather than owning one. Inline code, images, link URLs, HTML tags, HTML
 * character references, wiki links, footnote definitions and references, and
 * both math forms.
 *
 * Split out of markdownParser.ts when adding the character-reference detector
 * (#1382) took that file past the 300-line limit. The seam mirrors the one
 * already there for markdownParserBlocks.ts: document scaffolding and fences
 * stay in the parent, line-oriented blocks are in Blocks, spans are here.
 *
 * Order is load-bearing and preserved exactly as it was: images before links
 * (or an image gets URL-only protection), footnote DEFINITIONS before
 * references (or `[^1]:` splits into a reference plus a stray colon), and
 * character references after HTML tags (so `&amp;` inside an attribute is
 * already claimed and cannot be split out of its tag). Each detector guards
 * its match START against the regions claimed before it, so a construct nested
 * in an earlier region is not double-protected.
 *
 * Cost is linear in the document. The bracketed constructs are found by the
 * scanners in inlineSpanScanners.ts rather than by `opener [^closer]* closer`
 * expressions, which reread the rest of the document from every opener once
 * the last closer is behind them. The three that remain expressions cannot do
 * that: a character reference is bounded in length, display math pairs each
 * `$$` with the next one, and inline math stops at the end of its line.
 *
 * Appends to `regions` IN PLACE, like detectLineOrientedRegions, because the
 * detectors are order-dependent and each reads what the previous ones claimed.
 *
 * @coordinates-with markdownParser.ts — calls this between the fence and block passes
 * @coordinates-with inlineSpanScanners.ts — the linear scanners for detectors 3-9
 * @coordinates-with characterReferences.ts — the shared reference pattern
 * @coordinates-with protectedRegionSearch.ts — the "already claimed" test
 * @module lib/cjkFormatter/markdownParserInline
 */

import type { ProtectedRegion } from "./types";
import { characterReferenceMatcher } from "./characterReferences";
import {
  scanFootnoteDefinitions,
  scanFootnoteReferences,
  scanHtmlTags,
  scanImages,
  scanInlineCode,
  scanLinks,
  scanWikiLinks,
  type SpanMatch,
} from "./inlineSpanScanners";
import { createRegionLookup } from "./protectedRegionSearch";

/**
 * Add each match whose START is not already inside a region.
 *
 * `protect` narrows a match to the part that becomes the region; by default
 * the whole match.
 */
function claim<M extends SpanMatch>(
  regions: ProtectedRegion[],
  type: ProtectedRegion["type"],
  matches: Iterable<M>,
  protect: (match: M) => SpanMatch = (match) => match
): void {
  const alreadyClaimed = createRegionLookup(regions);
  for (const match of matches) {
    if (alreadyClaimed(match.start)) continue;
    const { start, end } = protect(match);
    regions.push({ start, end, type });
  }
}

/** Every match of a global expression, as ranges. */
function* regexMatches(pattern: RegExp, text: string): Generator<SpanMatch> {
  for (const match of text.matchAll(pattern)) {
    yield { start: match.index, end: match.index + match[0].length };
  }
}

/** Detectors 3-11. Appends to `regions` in place. */
export function detectInlineSpanRegions(text: string, regions: ProtectedRegion[]): void {
  // 3. Inline code (backticks, handling escaped and multiple backticks)
  // Match `code` or ``code with ` inside`` etc. Skipped inside a fenced block.
  claim(regions, "inline_code", scanInlineCode(text));

  // 4. Images: ![alt](url) or ![alt](url "title")
  claim(regions, "image", scanImages(text));

  // 5. Link URLs: [text](url) - protect only the URL part
  claim(regions, "link_url", scanLinks(text), ({ urlStart, urlEnd }) => ({
    start: urlStart,
    end: urlEnd,
  }));

  // 6. HTML tags (including self-closing and with attributes)
  claim(regions, "html_tag", scanHtmlTags(text));

  // 6b. HTML character references: &copy; &#20854; &#x5176; (issue #1382).
  //     A reference is punctuation wrapped around text, so every rule that
  //     rewrites punctuation could reach its terminating `;` — and
  //     normalizeFullwidthPunctuation did, turning `&#x5176;实` into
  //     `&#x5176；实`. That is no longer a reference: it parses as literal text
  //     and is backslash-escaped on the next save, so the document silently
  //     stops saying what the user wrote.
  //
  //     Reachable WITHOUT the user typing an entity, which is why it went
  //     unnoticed: the WYSIWYG serializer emits one at a strong/emphasis
  //     delimiter boundary, so bolding `满足自己的需求。` and leaving `其实`
  //     outside produces `**满足自己的需求。**&#x5176;实` on its own.
  //
  //     After the HTML-tag pass, so `&amp;` inside an attribute is already
  //     claimed and cannot be split out of its tag.
  claim(regions, "character_reference", regexMatches(characterReferenceMatcher(), text));

  // 7. Wiki links: [[target]] or [[target|display]]
  claim(regions, "wiki_link", scanWikiLinks(text));

  // 8. Footnote definitions: [^1]: content (protect the marker, not content)
  // Must be detected BEFORE references so [^1]: doesn't get split
  claim(regions, "footnote_def", scanFootnoteDefinitions(text));

  // 9. Footnote references: [^1], [^note], etc.
  claim(regions, "footnote_ref", scanFootnoteReferences(text));

  // 10. Math blocks: $$...$$  (display math)
  claim(regions, "math_block", regexMatches(/\$\$[\s\S]*?\$\$/g, text));

  // 11. Inline math: $...$ (but not $$, and not escaped \$).
  //
  //     The padding rule is micromark's, and it is the whole reason this is
  //     not a naive `\$[^$\n]+\$`: content may be padded with one
  //     space on BOTH sides, but one-sided padding is not math at all. Without
  //     it, `价格是 $100 和 $200 元` and `cost $5, tax $1` were "protected" —
  //     which skipped the CJK rules inside them AND made the space in front of
  //     the span a segment edge, so it was eaten as trailing whitespace.
  //
  //     `mathRegionParity.test.ts` checks a corpus against `parseMarkdown`
  //     itself, so this cannot drift away from what VMark renders.
  claim(regions, "math_inline", inlineMathMatches(text));
}

/** Inline-math candidates that satisfy the padding rule. */
function* inlineMathMatches(text: string): Generator<SpanMatch> {
  for (const match of text.matchAll(/(?<![\\$])\$(?!\$)([^$\n]+)\$(?!\$)/g)) {
    const content = match[1]!;
    const paddedLeft = /^[ \t]/.test(content);
    const paddedRight = /[ \t]$/.test(content);
    if (paddedLeft !== paddedRight) continue;
    // An all-whitespace run is padding with nothing to pad.
    if (paddedLeft && content.trim() === "") continue;
    // A trailing backslash would escape the closing delimiter.
    if (content.endsWith("\\")) continue;
    yield { start: match.index, end: match.index + match[0].length };
  }
}
