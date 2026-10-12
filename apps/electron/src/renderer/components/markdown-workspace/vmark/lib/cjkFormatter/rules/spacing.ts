// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Group 3 — Spacing rules between CJK and Latin/punctuation.
 *
 * @module lib/cjkFormatter/rules/spacing
 */

import type { FormatOptions } from "../types";
import { CJK_LETTER_CLASS, LATIN_ALNUM } from "./shared";

/**
 * Sign characters recognised in front of a digit run (issue 898 + extensions).
 *
 * Covered:
 *   - ASCII `-` `+`
 *   - Fullwidth `－` (U+FF0D) `＋` (U+FF0B), common from CJK IMEs
 *   - Unicode minus `−` (U+2212), plus-minus `±` (U+00B1)
 *
 * Single source of truth — both sign-before-currency and sign-after-currency
 * slots in `alphanumPattern` reference this so adding/removing a sign char
 * stays in one place.
 */
const SIGN_CHAR_CLASS = "[-+−±－＋]";

/** Currency symbols allowed as a prefix to the digit run. */
const CURRENCY_CHAR_CLASS = "[$¥€£₹]";

/** Add spaces between CJK characters and English/numbers. */
export function addCJKEnglishSpacing(text: string): string {
  // Korean excluded: Korean uses native word spacing and particles attach
  // directly to preceding words (e.g., "VMark에는" not "VMark 에는").
  //
  // The pattern accepts an optional sign in two positions so all of the
  // following are treated as a single token attached to the digit run:
  //
  //   -1, +1, −1, ±1, －1, ＋1     (sign-before-currency slot, no currency)
  //   -$100, +€50, -$ 100         (sign-before-currency slot, with currency)
  //   $-100, $+100, $ -100        (sign-after-currency slot)
  //
  // The lookaheads keep hyphenated identifiers (e.g. `中文-Web`,
  // `中文+A1`) and CJK-CJK hyphenation (e.g. `中文-我`) intact:
  //   - sign-before fires only when a digit, or a currency-(maybe-space)-digit
  //     sequence, follows;
  //   - sign-after fires only when a digit follows.
  const alphanumPattern =
    `(?:${SIGN_CHAR_CLASS}(?=\\d|${CURRENCY_CHAR_CLASS}[ ]?\\d))?` +
    `(?:${CURRENCY_CHAR_CLASS}[ ]?)?` +
    `(?:${SIGN_CHAR_CLASS}(?=\\d))?` +
    `${LATIN_ALNUM}+` +
    "(?:[%‰℃℉]|°[CcFf]?|[ ]?(?:USD|CNY|EUR|GBP|RMB))?";

  // CJK (non-Korean) followed by alphanumeric
  text = text.replace(
    new RegExp(`([${CJK_LETTER_CLASS}])(${alphanumPattern})`, "gu"),
    "$1 $2"
  );
  // Alphanumeric followed by CJK (non-Korean).
  //
  // Only the END of the token is matched: its last letter or digit, then at
  // most one unit sign, then the CJK character. Where the space goes depends
  // on nothing else — a currency code ends in a letter, `°C` ends in one too —
  // and matching the whole token from its start made the engine read a long
  // run of letters to its end, find no CJK character there, and start again
  // one character later: a pasted base64 line cost its length squared.
  text = text.replace(
    new RegExp(`(${LATIN_ALNUM}[%‰℃℉°]?)([${CJK_LETTER_CLASS}])`, "gu"),
    "$1 $2"
  );

  return text;
}

const ENDS_WITH_LATIN_ALNUM = new RegExp(`${LATIN_ALNUM}$`, "u");

/**
 * Add space between CJK characters and half-width parentheses.
 *
 * `options.linkLabel` set means the text BEGINS with the `)` that closes a
 * markdown link — the protected URL sits immediately to its left. That `)` is
 * syntax and renders as nothing, so it is not spaced as a parenthesis:
 * `[链接](url)中文` renders `链接中文`, and a space after the `)` would
 * put a gap inside it. What decides the gap is what the reader sees on each
 * side, which is the link's own text: `[GitHub](url)上` still becomes
 * `[GitHub](url) 上`, by the Latin/CJK rule rather than by accident.
 */
export function addCJKParenthesisSpacing(text: string, options: FormatOptions = {}): string {
  const { linkLabel } = options;
  // Korean excluded: Korean uses native word spacing around parentheses.
  text = text.replace(new RegExp(`([${CJK_LETTER_CLASS}])\\(`, "gu"), "$1 (");
  return text.replace(
    new RegExp(`\\)([${CJK_LETTER_CLASS}])`, "gu"),
    (whole, cjk: string, offset: number) => {
      if (offset === 0 && linkLabel !== undefined && !ENDS_WITH_LATIN_ALNUM.test(linkLabel)) {
        return whole;
      }
      return `) ${cjk}`;
    }
  );
}

/**
 * Currency and unit binding.
 *
 * - Prefix currency symbols ($, ¥, €, £, ₹) bind tight to following number: `$ 100` → `$100`
 * - Unit symbols (%, ‰, ℃, ℉, °) bind tight to preceding number: `50 %` → `50%`
 * - Postfix currency codes (USD, CNY, EUR, GBP, RMB) are spaced from preceding number: `100USD` → `100 USD`
 *
 * Every gap this rule REMOVES is `[ \t]+`, never `\s+`. `\s` matches line
 * terminators, and the replacement drops the gap, so a number ending one
 * paragraph and a `%` starting the next were joined into a single paragraph.
 * It also matches U+00A0 and U+202F, which an author types on purpose between
 * a number and its unit; those are left alone for the same reason.
 */
export function fixCurrencySpacing(
  text: string,
  postfixCurrency: "tight" | "spaced" = "spaced"
): string {
  // Prefix currency symbols bind tight to following number
  text = text.replace(/([$¥€£₹])[ \t]+(\d)/g, "$1$2");

  // Prefix currency codes bind tight to following number (style choice: keep tight)
  text = text.replace(/(USD|CNY|EUR|GBP|RMB|JPY)[ \t]+(\d)/g, "$1$2");

  // Unit symbols bind tight to preceding number
  // Note: No word boundary assertion since these are Unicode symbols
  text = text.replace(/(\d)[ \t]+(%|‰|℃|℉|°[CcFf]?)(?=[\s,;.。，；、！？!?)\]」』】〉》)]|$)/g, "$1$2");

  // Postfix currency codes: space or tight based on setting
  if (postfixCurrency === "spaced") {
    // Add space between number and postfix currency code if missing
    text = text.replace(/(\d)(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1 $2");
  } else {
    // Remove space between number and postfix currency code
    text = text.replace(/(\d)[ \t]+(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1$2");
  }

  return text;
}

/**
 * Remove same-line spaces around slashes (preserves URLs and line breaks).
 *
 * Whitespace on the LEFT ONLY is left alone. That shape is a path
 * or a root-anchored token — `路径 /usr/local/bin`, `see /etc/hosts` — never a
 * spaced separator, and collapsing it welded the path onto the preceding word.
 * Both-sides (`读 / 写`) and right-side-only (`读/ 写`) are separators and still
 * tighten.
 *
 * Spaces and tabs only — taking a line break would merge adjacent lines (e.g.
 * a heading with a following line that starts with an absolute path).
 *
 * A scan over the slashes, reading what
 * `/(?<![/:])([ \t]*)\/([ \t]*)(?!\/)/g` reads: the blanks on each side
 * of a slash, not preceded by `/` or `:` and not followed by `/` (so `://` and
 * `//` are never touched). The expression tried every blank of a run as a
 * starting point, so a long run of spaces with no slash after it was read
 * once per space.
 */
export function fixSlashSpacing(text: string): string {
  const isBlank = (index: number): boolean => text[index] === " " || text[index] === "\t";
  const isGuard = (index: number): boolean => text[index] === "/" || text[index] === ":";

  let out = "";
  let cursor = 0; // end of the previous match; nothing before it is read again
  let slash = text.indexOf("/");
  for (; slash !== -1; slash = text.indexOf("/", Math.max(slash + 1, cursor))) {
    // Right side: every blank, less one if that would put a slash next.
    let end = slash + 1;
    while (isBlank(end)) end += 1;
    if (text[end] === "/") {
      if (end === slash + 1) continue; // `//`
      end -= 1;
    }

    // Left side: every blank back to the previous match, less one if the
    // character before them is a guard.
    let start = slash;
    while (start > cursor && isBlank(start - 1)) start -= 1;
    if (isGuard(start - 1)) {
      if (start === slash) continue; // `:/`, or the second slash of `//`
      start += 1;
    }

    const leftOnly = start < slash && end === slash + 1;
    out += text.slice(cursor, start) + (leftOnly ? text.slice(start, end) : "/");
    cursor = end;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

/**
 * Collapse multiple spaces to a single space, preserving indentation.
 *
 * Two things this must NOT do:
 *
 * 1. **Collapse a hard break**. A run of two or more spaces at
 *    end of line is markdown syntax. Collapsing it to one left
 *    `removeTrailingSpaces` — which would have PRESERVED a two-space run —
 *    looking at a single space, which it then deleted. So
 *    `preserveTwoSpaceHardBreaks` was inert under default settings and every
 *    hard line break in a CJK document was silently dropped, changing the
 *    rendered output. The lookaheads keep end-of-line runs intact: `(?! )`
 *    makes the run the WHOLE run, and the second then asks whether the line
 *    ends there. (Asking it of every shorter prefix, each time skipping the
 *    rest of the run, gave the same answer at the square of the cost.)
 *
 * 2. **Mistake a segment-leading run for indentation**. The
 *    `(\S)` prefix is how indentation is spared, but a segment that starts
 *    mid-line — because a protected region sits immediately to its left — has
 *    no `\S` to anchor against, so `` `code`   中文 `` kept all three spaces.
 */
export function collapseSpaces(text: string, options: FormatOptions = {}): string {
  const { preserveTwoSpaceHardBreaks = false, startsAtLineStart = true } = options;

  let out = preserveTwoSpaceHardBreaks
    ? text.replace(/(\S) {2,}(?! )(?!\r?\n|$)/g, "$1 ")
    : text.replace(/(\S) {2,}/g, "$1 ");

  // Same exemption for the segment-leading run: `中文 \`code\`  \n` puts the
  // hard break at the START of the segment that follows the code span, where
  // there is no `\S` in front of it at all.
  if (!startsAtLineStart) {
    out = preserveTwoSpaceHardBreaks
      ? out.replace(/^ {2,}(?! )(?!\r?\n|$)/, " ")
      : out.replace(/^ {2,}/, " ");
  }

  return out;
}
