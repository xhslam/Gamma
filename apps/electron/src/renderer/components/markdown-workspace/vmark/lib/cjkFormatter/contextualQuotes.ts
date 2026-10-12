// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Contextual quote conversion
 *
 * Purpose: rewrite the quote pairs that quotePairing.ts finds into the glyphs
 * the chosen mode asks for — curly everywhere, curly only next to CJK, or
 * corner brackets next to CJK — leaving unpaired quotes as they are.
 *
 * Key decisions:
 *   - Pairs come from analyzeQuotes with corner brackets visible as quotes, so
 *     formatting this function's own corner output again sees the same
 *     pairing topology.
 *   - User-authored corner glyphs are paired but never rewritten.
 *
 * @coordinates-with quotePairing.ts — analyzeQuotes, the pairing this converts
 * @coordinates-with rules/applyRules.ts — calls this when smartQuoteConversion is on
 * @module lib/cjkFormatter/contextualQuotes
 */

import { analyzeQuotes } from "./quotePairing";
import {
  STRAIGHT_DOUBLE,
  STRAIGHT_SINGLE,
  CURLY_DOUBLE_OPEN,
  CURLY_DOUBLE_CLOSE,
  CURLY_SINGLE_OPEN,
  CURLY_SINGLE_CLOSE,
  CORNER_DOUBLE_OPEN,
  CORNER_DOUBLE_CLOSE,
  CORNER_SINGLE_OPEN,
  CORNER_SINGLE_CLOSE,
  CORNER_QUOTE_ROLES,
} from "./quoteClassification";

/**
 * Apply contextual quote conversion
 *
 * @param text The text to process
 * @param mode Quote conversion mode
 * @returns Text with quotes converted according to mode
 */
export function applyContextualQuotes(
  text: string,
  mode: "off" | "curly-everywhere" | "contextual" | "corner-for-cjk"
): string {
  if (mode === "off") {
    return text;
  }

  // Corner-aware pairing keeps the topology stable when this function's own
  // output (corner-for-cjk) is formatted again — see TokenizeOptions.
  const { pairs } = analyzeQuotes(text, { cornerBracketsAsQuotes: true });

  // Build replacement map
  const replacements = new Map<number, string>();

  for (const pair of pairs) {
    let openQuote: string;
    let closeQuote: string;

    if (mode === "curly-everywhere") {
      openQuote = pair.type === "double" ? CURLY_DOUBLE_OPEN : CURLY_SINGLE_OPEN;
      closeQuote = pair.type === "double" ? CURLY_DOUBLE_CLOSE : CURLY_SINGLE_CLOSE;
    } else if (mode === "contextual") {
      if (pair.isCJKInvolved) {
        openQuote = pair.type === "double" ? CURLY_DOUBLE_OPEN : CURLY_SINGLE_OPEN;
        closeQuote = pair.type === "double" ? CURLY_DOUBLE_CLOSE : CURLY_SINGLE_CLOSE;
      } else {
        // Keep straight quotes for pure Latin
        openQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
        closeQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
      }
    } else if (mode === "corner-for-cjk") {
      if (pair.isCJKInvolved) {
        openQuote = pair.type === "double" ? CORNER_DOUBLE_OPEN : CORNER_SINGLE_OPEN;
        closeQuote = pair.type === "double" ? CORNER_DOUBLE_CLOSE : CORNER_SINGLE_CLOSE;
      } else {
        openQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
        closeQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
      }
    } else {
      continue;
    }

    // Never rewrite a corner glyph: user-authored 「」『』 stay as written
    // (matching the pre-corner-aware behavior, where they were invisible to
    // pairing and therefore untouched).
    if (!(text[pair.openIndex]! in CORNER_QUOTE_ROLES)) {
      replacements.set(pair.openIndex, openQuote);
    }
    if (!(text[pair.closeIndex]! in CORNER_QUOTE_ROLES)) {
      replacements.set(pair.closeIndex, closeQuote);
    }
  }

  // Apply replacements
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (replacements.has(i)) {
      result += replacements.get(i);
    } else {
      result += text[i];
    }
  }

  return result;
}
