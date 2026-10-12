// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Linear-time scanners for the bracketed inline constructs.
 *
 * Purpose: find inline code, images, links, HTML tags, wiki links and footnote
 * markers in one forward pass each. They replace regular expressions of the
 * shape `OPENER [^CLOSER]* CLOSER`, which are correct but cost the square of
 * the input when the closer never comes: the engine scans from each opener to
 * the end of the document, fails, and starts again at the next opener. A
 * pasted run of `[` or of unbalanced backticks froze the window, because the
 * formatter is synchronous.
 *
 * Key decisions:
 *   - Each scanner accepts EXACTLY what its regular expression accepted. The
 *     expressions are kept in `__tests__/inlineSpanScanners.test.ts` as the
 *     oracle and compared against these on generated input, so this is a
 *     change of cost and not of behaviour.
 *   - "Where is the next closer?" is answered by `forwardFinder`, which
 *     remembers its last answer. Openers are visited left to right, so the
 *     same closer is found once however many openers precede it, and "there
 *     is none" is found once for the whole document.
 *   - Inline code pairs backtick RUNS: an opener of k backticks closes at the
 *     next run of exactly k. Runs are indexed by length so that lookup does
 *     not rescan either.
 *
 * @coordinates-with markdownParserInline.ts — the only consumer; owns order and overlap
 * @module lib/cjkFormatter/inlineSpanScanners
 */

/** A half-open match: `end` is exclusive. */
export interface SpanMatch {
  start: number;
  end: number;
}

/** A link match, with the half-open range of its URL (what gets protected). */
export interface LinkMatch extends SpanMatch {
  urlStart: number;
  urlEnd: number;
}

/**
 * `text.indexOf(needle, from)`, remembering the last answer.
 *
 * Amortised linear over a whole scan PROVIDED the caller asks with
 * non-decreasing `from`; an out-of-order question is still answered correctly,
 * just without the saving.
 */
export function forwardFinder(text: string, needle: string): (from: number) => number {
  let askedFrom = 0;
  let found = -2; // -2: not searched yet; -1: none at or after `askedFrom`
  return (from) => {
    if (found !== -2 && from >= askedFrom && (found === -1 || from <= found)) return found;
    askedFrom = from;
    found = text.indexOf(needle, from);
    return found;
  };
}

const isAsciiLetter = (ch: string | undefined): boolean =>
  ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));

/** A line terminator, as `^` under the `m` flag understands one. */
const isLineTerminator = (ch: string): boolean =>
  ch === "\n" || ch === "\r" || ch === "\u{2028}" || ch === "\u{2029}";

/**
 * Inline code: a run of k backticks, content that neither starts nor ends
 * with a backtick, then a run of exactly k backticks.
 *
 * A run that finds no partner gives up one backtick from its LEFT and tries
 * again with the rest — in ```` ```a`` ```` the span is ` ``a`` `, opened by
 * the last two backticks of the first run.
 */
export function scanInlineCode(text: string): SpanMatch[] {
  const runStart: number[] = [];
  const runLength: number[] = [];
  for (let i = text.indexOf("`"); i !== -1; ) {
    let end = i + 1;
    while (text[end] === "`") end += 1;
    runStart.push(i);
    runLength.push(end - i);
    i = text.indexOf("`", end);
  }

  // Run indices grouped by run length, ascending, each with a cursor that only
  // moves forward: openers are visited left to right.
  const byLength = new Map<number, { runs: number[]; cursor: number }>();
  runLength.forEach((length, index) => {
    const group = byLength.get(length);
    if (group) group.runs.push(index);
    else byLength.set(length, { runs: [index], cursor: 0 });
  });
  const nextRunOfLength = (length: number, after: number): number => {
    const group = byLength.get(length);
    if (!group) return -1;
    while (group.cursor < group.runs.length && group.runs[group.cursor]! <= after) group.cursor += 1;
    return group.cursor < group.runs.length ? group.runs[group.cursor]! : -1;
  };

  const matches: SpanMatch[] = [];
  let run = 0;
  while (run < runStart.length) {
    const openerEnd = runStart[run]! + runLength[run]!;
    let closer = -1;
    let length = runLength[run]!;
    for (; length >= 1; length -= 1) {
      closer = nextRunOfLength(length, run);
      if (closer !== -1) break;
    }
    if (closer === -1) {
      run += 1;
      continue;
    }
    matches.push({ start: openerEnd - length, end: runStart[closer]! + length });
    run = closer + 1;
  }
  return matches;
}

/** Images: `![alt](url)`, alt without `]`, url non-empty and without `)`. */
export function scanImages(text: string): SpanMatch[] {
  return scanBracketParen(text, "![").map(({ start, end }) => ({ start, end }));
}

/** Links: `[text](url)`, text without `]`, url non-empty and without `)`. */
export function scanLinks(text: string): LinkMatch[] {
  return scanBracketParen(text, "[");
}

/** The shared shape of an image and a link: opener, label, `](`, url, `)`. */
function scanBracketParen(text: string, opener: string): LinkMatch[] {
  const nextBracket = forwardFinder(text, "]");
  const nextParen = forwardFinder(text, ")");
  const matches: LinkMatch[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(opener, from);
    if (start === -1) break;
    const bracket = nextBracket(start + opener.length);
    if (bracket === -1) break; // no `]` left: no later opener can close either
    from = start + 1;
    if (text[bracket + 1] !== "(") continue;
    const paren = nextParen(bracket + 2);
    if (paren === -1) break; // no `)` left, and every later `](` is further right
    if (paren === bracket + 2) continue; // empty url
    matches.push({ start, end: paren + 1, urlStart: bracket + 2, urlEnd: paren });
    from = paren + 1;
  }
  return matches;
}

/** HTML tags: `<name …>` and `</name …>`, up to the first `>`. */
export function scanHtmlTags(text: string): SpanMatch[] {
  const nextClose = forwardFinder(text, ">");
  const matches: SpanMatch[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf("<", from);
    if (start === -1) break;
    from = start + 1;
    const name = text[start + 1] === "/" ? start + 2 : start + 1;
    if (!isAsciiLetter(text[name])) continue;
    const close = nextClose(name + 1);
    if (close === -1) break; // no `>` left for this tag or any after it
    matches.push({ start, end: close + 1 });
    from = close + 1;
  }
  return matches;
}

/** Wiki links: `[[target]]` or `[[target|display]]`, both parts non-empty. */
export function scanWikiLinks(text: string): SpanMatch[] {
  const nextBracket = forwardFinder(text, "]");
  const nextPipe = forwardFinder(text, "|");
  const matches: SpanMatch[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf("[[", from);
    if (start === -1) break;
    const bracket = nextBracket(start + 2);
    if (bracket === -1) break; // no `]` left: nothing can close
    from = start + 1;
    const pipe = nextPipe(start + 2);
    const targetEnd = pipe !== -1 && pipe < bracket ? pipe : bracket;
    if (targetEnd === start + 2) continue; // empty target
    // With a `|`, the display runs to the same first `]` and must be non-empty.
    if (targetEnd === pipe && bracket === pipe + 1) continue;
    if (text[bracket + 1] !== "]") continue;
    matches.push({ start, end: bracket + 2 });
    from = bracket + 2;
  }
  return matches;
}

/** Footnote definitions: `[^label]:` at the start of a line, label non-empty. */
export function scanFootnoteDefinitions(text: string): SpanMatch[] {
  return scanFootnoteMarkers(text, true);
}

/** Footnote references: `[^label]`, label non-empty and without `]`. */
export function scanFootnoteReferences(text: string): SpanMatch[] {
  return scanFootnoteMarkers(text, false);
}

function scanFootnoteMarkers(text: string, definitionsOnly: boolean): SpanMatch[] {
  const nextBracket = forwardFinder(text, "]");
  const matches: SpanMatch[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf("[^", from);
    if (start === -1) break;
    const bracket = nextBracket(start + 2);
    if (bracket === -1) break; // no `]` left: no later marker can close either
    from = start + 1;
    if (bracket === start + 2) continue; // empty label
    if (definitionsOnly) {
      if (start > 0 && !isLineTerminator(text[start - 1]!)) continue;
      if (text[bracket + 1] !== ":") continue;
      matches.push({ start, end: bracket + 2 });
      from = bracket + 2;
    } else {
      matches.push({ start, end: bracket + 1 });
      from = bracket + 1;
    }
  }
  return matches;
}
