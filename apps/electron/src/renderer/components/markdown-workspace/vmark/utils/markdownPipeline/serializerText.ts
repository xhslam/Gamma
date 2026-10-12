// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Text serialization — line endings that would make a blank line, and `$`.
 *
 * Purpose: write a `text` node so that it comes back as text: the line endings
 * it carries never as block structure, and its `$` never as math.
 *
 * Upstream writes a text line ending raw. One raw line ending is a soft break
 * and reads back as itself. But a line ending that starts the paragraph, ends
 * it, or sits directly beside another one makes a BLANK line, and a blank line
 * is structure: the parser drops it at a paragraph's edge and splits the
 * paragraph at one inside. In a list item the empty first line also means the
 * item "starts with a blank line", so a nested list below it can no longer
 * interrupt the paragraph and is read back as its text — found by the branch's
 * cross-model audit from `- b\n  1. &#10;x`. Such text only arrives through
 * character references, so it leaves through them.
 *
 * Key decisions:
 *   - Encode only the line endings that would make a blank line; a lone soft
 *     break, LF or CRLF, stays raw so ordinary documents do not change.
 *   - A post-pass on `state.safe`'s output, not an `unsafe` pattern: upstream's
 *     hard-break handler reads ANY `\n` pattern in scope as "line endings are
 *     not allowed here" and degrades every hard break to a space.
 *   - Spaces between two line endings need nothing here: upstream already
 *     encodes a space beside a line ending, and `&#x20;` is not blank.
 *   - Every `$` no backslash escapes is escaped here, also as a post-pass:
 *     upstream leaves the second `$` of a line-opening `$$` bare, and a bare
 *     `$` pairs with a later one into inline math. The cosmetic pass drops
 *     the escapes a re-parse shows to be unneeded.
 *
 * @coordinates-with serializer.ts — installs this handler
 * @coordinates-with plugins/detailsSerializer.ts — the summary construct, where `<` is referenced
 * @coordinates-with listInterruptJoin.ts — the other half of "a list item's
 *   first line must not be blank"
 * @module utils/markdownPipeline/serializerText
 */

import { DETAILS_SUMMARY_CONSTRUCT } from "./plugins/detailsSerializer";

/** The slice of mdast-util-to-markdown's `State` this handler uses. */
interface TextState {
  safe: (value: string, info: TextInfo) => string;
  /** The constructs currently open, outermost first. */
  stack: readonly string[];
}

/** The characters around the node being serialized. */
interface TextInfo {
  before: string;
  after: string;
}

const LINE_ENDING = /\r\n|\r|\n/g;
const endsWithLineEnding = (value: string): boolean => /[\r\n]$/.test(value);
const startsWithLineEnding = (value: string): boolean => /^[\r\n]/.test(value);
const reference = (ending: string): string =>
  [...ending].map((char) => `&#x${char.charCodeAt(0).toString(16).toUpperCase()};`).join("");

/**
 * `value` with every line ending that would make a blank line written as a
 * character reference: one directly after a line ending (or after `before`
 * ending in one), and one directly before a line ending (or before `after`
 * starting with one).
 */
function encodeBlankLineEndings(value: string, before: string, after: string): string {
  const endings = [...value.matchAll(LINE_ENDING)];
  if (endings.length === 0) return value;

  let out = "";
  let cursor = 0;
  endings.forEach((match, index) => {
    const start = match.index;
    const end = start + match[0].length;
    const previous = endings[index - 1];
    const next = endings[index + 1];
    const afterLineEnding =
      previous !== undefined ? previous.index + previous[0].length === start : start === 0 && endsWithLineEnding(before);
    const beforeLineEnding =
      next !== undefined ? next.index === end : end === value.length && startsWithLineEnding(after);

    out += value.slice(cursor, start) + (afterLineEnding || beforeLineEnding ? reference(match[0]) : match[0]);
    cursor = end;
  });
  return out + value.slice(cursor);
}

/**
 * `escaped` with every `<` written as `&lt;`. Where upstream had escaped the
 * `<` with a backslash, the reference replaces the pair; a backslash that is
 * itself escaped (`\\<`) is left alone.
 */
function referenceTagStarts(escaped: string): string {
  let out = "";
  let backslashes = 0;
  for (const char of escaped) {
    if (char === "<") {
      out = (backslashes % 2 === 1 ? out.slice(0, -1) : out) + "&lt;";
    } else {
      out += char;
    }
    backslashes = char === "\\" ? backslashes + 1 : 0;
  }
  return out;
}

/**
 * `escaped` with every `$` that no backslash escapes written as `\$`.
 *
 * A text node's `$` is literal — math is a node of its own — and with
 * single-dollar inline math any bare `$` can pair with a later one and turn
 * the text between into math. Upstream escapes every `$` in phrasing except
 * one: the second of a `$$` that starts a line comes out bare (`\$$`), and the
 * next `$` on the line closes math over the text in between, swallowing even
 * a hard break. The cosmetic pass removes each escape a re-parse shows to be
 * unneeded, so ordinary text such as `$5` still comes out unescaped.
 */
function escapeBareDollars(escaped: string): string {
  return escaped.replace(/(\\*)\$/g, (run: string, backslashes: string) =>
    backslashes.length % 2 === 0 ? `${backslashes}\\$` : run,
  );
}

/**
 * `text` handler: upstream's escaping, then blank-line line endings encoded.
 *
 * Inside a `<details>` summary the text sits in raw HTML, where a `<` would
 * start a tag — or, spelling `</summary>`, end the summary. There it is
 * written as a character reference, which the summary's reader decodes.
 */
export function handleText(
  node: { value: string },
  _parent: unknown,
  state: TextState,
  info: TextInfo,
): string {
  const escaped = encodeBlankLineEndings(
    escapeBareDollars(state.safe(node.value, info)),
    info.before,
    info.after,
  );
  return state.stack.includes(DETAILS_SUMMARY_CONSTRUCT) ? referenceTagStarts(escaped) : escaped;
}
