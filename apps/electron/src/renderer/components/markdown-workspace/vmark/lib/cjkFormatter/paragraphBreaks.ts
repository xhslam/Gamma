// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Paragraph breaks — the boundary no bracket or quote pairs across.
 *
 * Purpose: a formatted segment can hold several paragraphs (it runs from one
 * protected region to the next). Markdown ends a paragraph at a blank line,
 * so an opener before one is unclosed: `(一\n\n二)` is two paragraphs with a
 * stray paren each, and converting it to `（一\n\n二）` invents a pair the
 * author never wrote. Every pairing rule in the formatter applies its pairing
 * inside one paragraph at a time through these helpers.
 *
 * Key decisions:
 *   - A blank line is one holding only spaces, tabs and blockquote markers
 *     (`>`), so a break inside a quote block (`> a\n>\n> b`) counts; CRLF line
 *     ends count the same as LF. A single newline is a soft break inside one
 *     paragraph and pairs as before.
 *   - The break text itself passes through untouched: the pairing rules only
 *     rewrite brackets and quotes, and a break holds neither.
 *
 * @coordinates-with rules/fullwidth.ts — parenthesis and bracket conversion
 * @coordinates-with rules/dashesQuotes.ts — guillemet, corner and nested-corner conversion
 * @coordinates-with quotePairing.ts — the stack-based quote pairing
 * @coordinates-with quoteToggle.ts — the pair the cursor sits in
 * @module lib/cjkFormatter/paragraphBreaks
 */

/** A newline, a line of only spaces, tabs and `>`, and its newline. */
const PARAGRAPH_BREAK = /\n[ \t>]*\r?\n/g;

/**
 * A cursor over `text`'s paragraph breaks for a scan that moves forward:
 * `crossed(index)` is true when at least one break starts at or before
 * `index` that an earlier call had not yet passed. A stack-based pairing
 * calls it at each position and drops its open entries when it is true.
 */
export function paragraphCrossings(text: string): (index: number) => boolean {
  const starts = [...text.matchAll(PARAGRAPH_BREAK)].map((m) => m.index);
  let next = 0;
  return (index) => {
    const before = next;
    while (next < starts.length && starts[next]! <= index) next++;
    return next > before;
  };
}

/**
 * Apply `rewrite` to each paragraph of `text` separately, keeping the breaks
 * between them as they are, so nothing `rewrite` pairs can span two
 * paragraphs.
 */
export function perParagraph(text: string, rewrite: (paragraph: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(PARAGRAPH_BREAK)) {
    out += rewrite(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return last === 0 ? rewrite(text) : out + rewrite(text.slice(last));
}
