// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Technical subspans — URLs, e-mail addresses, domains, versions, times and
 * numbers inside a Latin span.
 *
 * Purpose: find the constructs whose punctuation must stay halfwidth
 * (`v1.2.3`, `12:30`, `user@example.com`), in time linear in the span.
 *
 * Key decisions:
 *   - Order matters: more specific kinds (URLs, e-mail) claim their range
 *     before general ones (decimals), and a later kind may not overlap a
 *     claimed range.
 *   - E-mail addresses and domains are found by scanners, not by regular
 *     expressions. Both were `[class]+` followed by something the class
 *     itself cannot match, so on a long run of letters, digits, dots or
 *     hyphens with no `@` — a base64 line, a ruler of dashes — the engine
 *     scanned the run from every position in it. The scanners accept exactly
 *     what the expressions accepted; `__tests__/technicalSubspans.test.ts`
 *     keeps the expressions as the oracle.
 *   - Claimed ranges are a per-character mask, so the overlap test costs the
 *     length of the candidate rather than the number of ranges claimed so far.
 *
 * @coordinates-with latinSpanScanner.ts — calls findTechnicalSubspans per Latin span
 * @module lib/cjkFormatter/technicalSubspans
 */

import type { SpanMatch } from "./inlineSpanScanners";

type TechnicalSubspanType =
  | "urlLike"
  | "emailLike"
  | "domainLike"
  | "versionLike"
  | "decimalLike"
  | "timeLike"
  | "thousandsLike";

export interface TechnicalSubspan {
  /** Start position relative to the Latin span */
  start: number;
  /** End position relative to the Latin span */
  end: number;
  /** Type of technical construct */
  type: TechnicalSubspanType;
  /** The matched text */
  text: string;
}

// ---- ASCII character classes ------------------------------------------------

const LETTER = 1; // a-z A-Z
const DIGIT = 2; // 0-9
const WORD = 4; // letters, digits, underscore: what `\b` separates from the rest
const LOCAL = 8; // an e-mail local part: letters, digits, . _ % + -
const HOST = 16; // a host name: letters, digits, . -

const CLASS = new Uint8Array(128);
for (let code = 0; code < 128; code += 1) {
  const ch = String.fromCharCode(code);
  if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) CLASS[code] = LETTER | WORD | LOCAL | HOST;
  else if (ch >= "0" && ch <= "9") CLASS[code] = DIGIT | WORD | LOCAL | HOST;
  else if (ch === "_") CLASS[code] = WORD | LOCAL;
  else if (ch === "." || ch === "-") CLASS[code] = LOCAL | HOST;
  else if (ch === "%" || ch === "+") CLASS[code] = LOCAL;
}

/** Whether the character at `index` is in `mask`; false past either end. */
function is(text: string, index: number, mask: number): boolean {
  const code = text.charCodeAt(index); // NaN outside the text
  return code < 128 && (CLASS[code]! & mask) !== 0;
}

// ---- scanners ---------------------------------------------------------------

/**
 * E-mail addresses: a local part, `@`, a host, a dot, and at least two letters.
 *
 * Every address is tied to one `@`, so the scan visits each `@` once: the
 * local part is everything to its left that a local part may contain, and the
 * host ends at the LAST dot that at least two letters follow.
 */
export function scanEmails(text: string): SpanMatch[] {
  const matches: SpanMatch[] = [];
  let consumed = 0; // end of the previous address: a local part cannot reach back past it
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    let start = at;
    while (start > consumed && is(text, start - 1, LOCAL)) start -= 1;
    if (start === at) continue;

    let hostEnd = at + 1;
    while (is(text, hostEnd, HOST)) hostEnd += 1;

    // Walk the host from the right, counting the letters that follow the
    // current position, until a dot with two or more behind it.
    let letters = 0;
    let end = -1;
    for (let dot = hostEnd - 1; dot > at + 1; dot -= 1) {
      if (is(text, dot, LETTER)) {
        letters += 1;
      } else {
        if (text[dot] === "." && letters >= 2) {
          end = dot + 1 + letters;
          break;
        }
        letters = 0;
      }
    }
    if (end === -1) continue;
    matches.push({ start, end });
    consumed = end;
  }
  return matches;
}

/**
 * Domains: a label starting with a letter at a word boundary, a dot, and a
 * tail of at least two characters that ends in a letter at a word boundary.
 *
 * A domain lies inside one run of host characters, and a run holds at most
 * one: it starts at the run's first eligible letter and ends at its last
 * eligible one, so each run is read a constant number of times.
 */
export function scanDomains(text: string): SpanMatch[] {
  const matches: SpanMatch[] = [];
  let index = 0;
  while (index < text.length) {
    if (!is(text, index, HOST)) {
      index += 1;
      continue;
    }
    const runStart = index;
    let runEnd = index;
    while (is(text, runEnd, HOST)) runEnd += 1;
    index = runEnd;

    // The last position a domain may end at: after a letter, before a non-word.
    let end = -1;
    for (let e = runEnd; e > runStart; e -= 1) {
      if (is(text, e - 1, LETTER) && !is(text, e, WORD)) {
        end = e;
        break;
      }
    }
    if (end === -1) continue;

    // The first position one may start at: a letter after a non-word.
    let start = -1;
    for (let s = runStart; s < end; s += 1) {
      if (is(text, s, LETTER) && !is(text, s - 1, WORD)) {
        start = s;
        break;
      }
    }
    if (start === -1) continue;

    let dot = start + 1;
    while (dot < end && text[dot] !== ".") dot += 1;
    // The tail after the dot needs one character and then the final letter.
    if (dot + 3 <= end) matches.push({ start, end });
  }
  return matches;
}

/** Every match of a global regular expression, as ranges. */
function regexScanner(pattern: RegExp): (text: string) => SpanMatch[] {
  return (text) => {
    const matches: SpanMatch[] = [];
    for (const match of text.matchAll(pattern)) {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
    return matches;
  };
}

/**
 * The technical kinds, most specific first.
 *
 * The four that stay regular expressions are linear as written: each either
 * anchors at a word boundary, so a digit run is entered once, or (the URL)
 * fails on its first character.
 */
const TECHNICAL_SCANNERS: Array<{
  type: TechnicalSubspanType;
  scan: (text: string) => SpanMatch[];
}> = [
  // URL-like: starts with http:// or https://
  { type: "urlLike", scan: regexScanner(/https?:\/\/[^\s]+/g) },
  // Email-like: contains @ with domain
  { type: "emailLike", scan: scanEmails },
  // Version-like: v1.2.3 or 1.2.3.4 (requires v prefix OR at least 2 dots)
  { type: "versionLike", scan: regexScanner(/\b(?:v\d+(?:\.\d+)+|\d+(?:\.\d+){2,})\b/g) },
  // Time-like: 12:30 or 1:30
  { type: "timeLike", scan: regexScanner(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) },
  // Thousands-like: 1,000 or 1,000,000
  { type: "thousandsLike", scan: regexScanner(/\b\d{1,3}(?:,\d{3})+\b/g) },
  // Domain-like: example.com (must have dot, no spaces, not just numbers)
  { type: "domainLike", scan: scanDomains },
  // Decimal-like: 3.14 (number.number)
  { type: "decimalLike", scan: regexScanner(/\b\d+\.\d+\b/g) },
];

/** Find technical subspans within a Latin span, sorted by start. */
export function findTechnicalSubspans(spanText: string): TechnicalSubspan[] {
  const subspans: TechnicalSubspan[] = [];
  // 1 where an earlier, more specific kind already claimed the character.
  let claimed: Uint8Array | undefined;

  for (const { type, scan } of TECHNICAL_SCANNERS) {
    for (const { start, end } of scan(spanText)) {
      let overlaps = false;
      if (claimed) {
        for (let i = start; i < end && !overlaps; i += 1) overlaps = claimed[i] === 1;
      }
      if (overlaps) continue;
      subspans.push({ start, end, type, text: spanText.slice(start, end) });
      claimed ??= new Uint8Array(spanText.length);
      claimed.fill(1, start, end);
    }
  }

  subspans.sort((a, b) => a.start - b.start);
  return subspans;
}
