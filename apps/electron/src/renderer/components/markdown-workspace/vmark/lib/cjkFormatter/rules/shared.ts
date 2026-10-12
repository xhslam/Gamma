// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * CJK rule internals — character ranges, punctuation maps, and neighbor helpers.
 *
 * Private plumbing shared across the individual rule groups in
 * `src/lib/cjkFormatter/rules/`. Consumers should import from
 * `@/lib/cjkFormatter/rules` (the barrel), not from this file directly.
 *
 * @module lib/cjkFormatter/rules/shared
 */

/**
 * THE definition of a Han ideograph, as a character-class BODY (needs `u`):
 * by script, so Extension A, the supplementary-plane extensions, the
 * compatibility ideographs, `々` and `〇` are all in it.
 */
export const HAN_CLASS = "\\p{Script=Han}";

/**
 * THE definition of a CJK letter, as a character-class BODY: Han, Hiragana,
 * Katakana and Bopomofo by Unicode script, plus the kana marks that Unicode
 * files under Common/Inherited but that are part of a word — the prolonged
 * sound mark (`ー`, and its halfwidth form) and the voicing marks.
 *
 * Every rule builds its pattern from this, and `isCJKLetter` tests against it.
 * There used to be two definitions — BMP block ranges for the spacing rules,
 * script properties for the punctuation rule — and they disagreed: a
 * supplementary-plane Han character got fullwidth punctuation but no spacing,
 * and `ー` got spacing but no fullwidth punctuation.
 *
 * Script properties match whole code points, so every `RegExp` built from this
 * MUST carry the `u` flag; without it the pattern does not compile to what it
 * says.
 *
 * Korean is deliberately absent: it uses native word spacing and particles
 * attach directly to the preceding word (`VMark에는`). The katakana middle dot
 * (`・`) is absent too — it is punctuation with its own spacing.
 */
export const CJK_LETTER_CLASS =
  // The combining voicing marks lead the class: after another member they
  // would read as a base character plus its mark, which is not what a class
  // member is. Then the prolonged sound mark, full and half width.
  "\\u{3099}-\\u{309c}\\u{ff9e}\\u{ff9f}\\u{30fc}\\u{ff70}" +
  `${HAN_CLASS}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Bopomofo}`;

const CJK_LETTER_REGEX = new RegExp(`[${CJK_LETTER_CLASS}]`, "u");
const HANGUL_REGEX = /\p{Script=Hangul}/u;

/**
 * Whether `char` is (or contains) a CJK letter — see `CJK_LETTER_CLASS`.
 * Accepts a single UTF-16 code unit or a whole code point.
 */
export function isCJKLetter(char: string): boolean {
  return CJK_LETTER_REGEX.test(char);
}

/** Whether `char` is (or contains) a Hangul letter. */
export function isHangulLetter(char: string): boolean {
  return HANGUL_REGEX.test(char);
}

/**
 * THE definition of a Latin letter, as a character-class BODY (needs `u`).
 *
 * Latin by script, not by ASCII range: with `[A-Za-z]` the run in
 * `中文café中文` began at `c` and so was spaced on the left, but ended at `é`
 * and so was not spaced on the right.
 *
 * Fullwidth Latin (`Ａ`–`ｚ`) is Latin by script and is excluded wherever this
 * is used, via `NOT_FULLWIDTH_LATIN`: a fullwidth form carries its own
 * sidebearing, exactly as fullwidth punctuation does, so it is never spaced.
 */
const LATIN_LETTER_CLASS = "\\p{Script=Latin}";
const NOT_FULLWIDTH_LATIN = "(?![\\u{ff21}-\\u{ff3a}\\u{ff41}-\\u{ff5a}])";

const LATIN_LETTER_REGEX = new RegExp(`^${NOT_FULLWIDTH_LATIN}[${LATIN_LETTER_CLASS}]`, "u");

/** Whether `char` starts with a Latin letter — see `LATIN_LETTER_CLASS`. */
export function isLatinLetter(char: string): boolean {
  if (char === "") return false;
  const code = char.charCodeAt(0);
  // ASCII decides itself; the script lookup is only worth paying beyond it.
  if (code < 0x80) return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  return LATIN_LETTER_REGEX.test(char);
}

/**
 * ONE Latin letter or ASCII digit, as a pattern FRAGMENT (needs `u`), with any
 * combining marks that follow it — so a decomposed `é` (`e` + U+0301) is one
 * unit and the mark cannot sit between the letter and a CJK neighbour.
 */
export const LATIN_ALNUM = `(?:${NOT_FULLWIDTH_LATIN}[${LATIN_LETTER_CLASS}0-9]\\p{M}*)`;

// CJK punctuation
export const CJK_TERMINAL_PUNCTUATION = "，。！？；：、";
export const CJK_CLOSING_BRACKETS = "》」』】）〉";
export const CJK_OPENING_BRACKETS = "《「『【（〈";

/** One CJK letter or CJK punctuation mark, as a pattern (needs `u`). */
export const CJK_CHARS_PATTERN = `[${CJK_LETTER_CLASS}《》「」『』【】（）〈〉，。！？；：、]`;

// Punctuation conversion map (half-width → full-width)
export const PUNCTUATION_MAP: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
};

/**
 * Anything addressable by UTF-16 code-unit position: a plain string, or a
 * mutable working array of single characters. `normalizeFullwidthPunctuation`
 * needs the second form — it reads the left neighbor from the copy it is
 * converting into, so one scan resolves the neighbor-propagation the rule used
 * to need a whole extra pass per converted character for.
 */
export type CharSequence = { readonly length: number; readonly [index: number]: string };

/**
 * Nearest non-space character to the left of `pos` (handles surrogate pairs).
 *
 * `skipSpaces` is FALSE for punctuation conversion: a mark
 * separated from the CJK character by a space must not become fullwidth,
 * because fullwidth punctuation carries its own sidebearing and is never
 * preceded by a space in any CJK orthography. Skipping produced
 * `中文 ， English`, `中文 ：smile:`, and `## 1。 第一章`.
 *
 * It stays TRUE for the quote-context reader, which needs whitespace to be
 * transparent so quote classification is idempotent under the formatter's own
 * spacing output.
 */
export function getLeftNeighbor(
  text: CharSequence,
  pos: number,
  skipSpaces = true
): string {
  for (let i = pos - 1; i >= 0; i--) {
    if (!skipSpaces || (text[i] !== " " && text[i] !== "\t")) {
      const ch = text[i]!;
      if (ch === " " || ch === "\t") return "";
      const code = ch.charCodeAt(0);
      // Combine surrogate pair if we landed on a low surrogate.
      if (code >= 0xdc00 && code <= 0xdfff && i - 1 >= 0) {
        const prev = text[i - 1]!;
        const prevCode = prev.charCodeAt(0);
        /* v8 ignore next -- @preserve Defensive guard: stranded low surrogate without a preceding high surrogate is malformed UTF-16 that cannot occur in well-formed JS strings */
        if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
          return prev + ch;
        }
      }
      return ch;
    }
  }
  return "";
}

/** Nearest non-space character to the right of `pos`; see `getLeftNeighbor`. */
export function getRightNeighbor(
  text: string,
  pos: number,
  skipSpaces = true
): string {
  for (let i = pos + 1; i < text.length; i++) {
    if (!skipSpaces || (text[i] !== " " && text[i] !== "\t")) {
      const ch = text[i]!;
      if (ch === " " || ch === "\t") return "";
      const code = ch.charCodeAt(0);
      // Combine surrogate pair if we landed on a high surrogate.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const next = text[i + 1]!;
        const nextCode = next.charCodeAt(0);
        /* v8 ignore next -- @preserve Defensive guard: stranded high surrogate without a following low surrogate is malformed UTF-16 that cannot occur in well-formed JS strings */
        if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
          return ch + next;
        }
      }
      return ch;
    }
  }
  return "";
}

/**
 * The whole code point that ENDS just before `index` — a supplementary-plane
 * character is returned as one string, not as its low surrogate. Empty at the
 * start of the text.
 */
export function codePointBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

/** The whole code point that STARTS at `index`; empty past the end. */
export function codePointAt(text: string, index: number): string {
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

/**
 * Check if text contains CJK characters (Han, Kana, Bopomofo, or Hangul),
 * supplementary planes included. Hangul counts here — this gates whether the
 * CJK rules run at all — even though it is not a CJK LETTER for spacing.
 */
export function containsCJK(text: string): boolean {
  return isCJKLetter(text) || isHangulLetter(text);
}

/**
 * Replace every `open … close` pair, where the content holds no `close`, with
 * `render(content)` — what `text.replace(/open([^close]*)close/g, …)` does,
 * in one pass. The expression rescans to the end of the text from every
 * `open` once the last `close` is behind it; this stops at the first `open`
 * that has none.
 */
export function replaceDelimited(
  text: string,
  open: string,
  close: string,
  render: (content: string) => string
): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(open, cursor);
    if (start === -1) break;
    const end = text.indexOf(close, start + open.length);
    if (end === -1) break;
    out += text.slice(cursor, start) + render(text.slice(start + open.length, end));
    cursor = end + close.length;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}
