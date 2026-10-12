// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Hard-break serialization — the `break` handler.
 *
 * Purpose: write a hard break in the document's chosen spelling (`\` or two
 * trailing spaces) at the one place that knows it is writing a hard break.
 *
 * The style cannot be applied to the finished string instead. A backslash
 * that ends a line of text is a hard break, a LaTeX row separator in `$$`
 * math, a line of an HTML block, an attribute value spanning two lines, or a
 * literal backslash before a soft break — and the string does not say which.
 * Rewriting it by pattern corrupts every one of those but the first. Here only
 * `break` nodes are written, so nothing else can be.
 *
 * Key decisions:
 *   - "May a line ending appear here?" is asked of upstream, through
 *     `state.safe`, rather than re-derived: a table cell answers no, and the
 *     break degrades to a space exactly as upstream's own handler does.
 *     `serializerBreak.test.ts` holds the backslash style to stock
 *     remark-stringify's output for every construct a break can sit in.
 *   - One more place takes no line ending: directly before inline HTML that
 *     would start an HTML block on a line of its own. Upstream replaces the
 *     line ending there with a space AFTER this handler has run, which turns a
 *     backslash break into a literal backslash and a space. So the break is
 *     written as the space itself. (HTML that may start a line is handled in
 *     serializerBreakBeforeHtml.ts, and the break before it is kept.)
 *   - Two trailing spaces say "hard break" only directly after a
 *     non-whitespace character that leaves them alone. Where they cannot say
 *     it, the break is written with a backslash whatever the style
 *     (`mustBeBackslash`):
 *       · first in its parent, or right after another break — spaces alone on
 *         a line make a BLANK line; the paragraph splits and the break is gone;
 *       · after text that ends in a space or tab — the spaces join that run
 *         and are read back as part of the break, so the text loses its own
 *         whitespace, and after a tab no break is read back at all;
 *       · after emphasis, strong or strikethrough whose text ends in
 *         whitespace — that delimiter then has whitespace on both sides, and
 *         its handler has both written as character references
 *         (serializerAttention.ts, `encodeSides`); `&#x20;` plus one space is
 *         not a hard break. `*italic \` continued on the next line is ordinary
 *         writing;
 *       · after an inline tag that opens its paragraph — a line holding one
 *         complete tag and then only whitespace starts an HTML block.
 *   - `peek` tells the truth. It is the first character the node BEFORE the
 *     break is told to expect, and that node decides its own escaping by it:
 *     `1.` or `-` is text only while something other than whitespace follows,
 *     and must escape itself before a two-space break. So the rule above is
 *     decided from the tree — the break's place among its siblings — which
 *     `peek` can see as well as the handler can, and the two share it.
 *     Answering a backslash always, or a space always, each loses breaks: the
 *     first turns `1.` into an empty list item, the second is the emphasis
 *     case.
 *   - The handler also refuses two spaces when the output so far ends in
 *     whitespace or is empty, whatever the tree says. That is the one place it
 *     can differ from `peek`, and only for a sibling shape the rule does not
 *     know: a backslash is then written where a space was announced, to a
 *     neighbour whose output ended in whitespace.
 *
 * @coordinates-with serializer.ts — installs this handler, one processor per style
 * @coordinates-with serializerAttention.ts — the delimiters that encode their neighbours
 * @coordinates-with serializerBreakBeforeHtml.ts — keeps the line ending before inline HTML
 * @coordinates-with serializerText.ts — text line endings, the sibling concern
 * @module utils/markdownPipeline/serializerBreak
 */

import { ATTENTION_NODE_TYPES, siblingIndex } from "./serializerAttention";

/** How a hard break is spelled. */
export type HardBreakSpelling = "backslash" | "twoSpaces";

/** The slice of mdast-util-to-markdown's `State` this handler uses. */
interface BreakState {
  safe: (value: string, info: BreakInfo) => string;
  /** Index of the child being serialized, per open container. */
  indexStack: number[];
}

/** The characters around the node being serialized. */
interface BreakInfo {
  before: string;
  after: string;
}

/** A phrasing node as far as this handler looks at one. */
interface PhrasingNode {
  type: string;
  value?: string;
  children?: readonly PhrasingNode[];
}

const BACKSLASH_BREAK = "\\\n";
const TWO_SPACE_BREAK = "  \n";

const endsInWhitespace = (value: string | undefined): boolean => /[ \t\r\n]$/.test(value ?? "");

/**
 * True when no line ending can be written here because the node after the
 * break is inline HTML that would start an HTML block on a line of its own.
 * HTML that may start a line has been given another type by then
 * (serializerBreakBeforeHtml.ts), so an `html` sibling here is one that may
 * not — and upstream would turn the line ending into a space in any case.
 */
function cannotEndLine(node: unknown, parent: PhrasingNode | undefined, state: BreakState): boolean {
  const siblings = parent?.children ?? [];
  return siblings[siblingIndex(node, parent, state) + 1]?.type === "html";
}

/**
 * True when this break cannot be written as two trailing spaces, judged from
 * its place among its siblings. See the module header for each case.
 */
function mustBeBackslash(node: unknown, parent: PhrasingNode | undefined, state: BreakState): boolean {
  const siblings = parent?.children ?? [];
  const index = siblingIndex(node, parent, state);
  const previous = siblings[index - 1];
  if (previous === undefined || previous.type === "break") return true;
  if (previous.type === "text") return endsInWhitespace(previous.value);
  // A tag that opens its paragraph, then only whitespace: an HTML block.
  if (previous.type === "html") return index === 1;
  if (ATTENTION_NODE_TYPES.has(previous.type)) {
    const last = previous.children?.[previous.children.length - 1];
    return last?.type === "text" && endsInWhitespace(last.value);
  }
  return false;
}

/** Build the `break` handler for one hard-break spelling. */
export function createBreakHandler(spelling: HardBreakSpelling) {
  const handle = (
    node: unknown,
    parent: PhrasingNode | undefined,
    state: BreakState,
    info: BreakInfo,
  ): string => {
    // Where no line ending can be written — a table cell, or before HTML
    // that would start a block — the break becomes a space, or nothing when
    // whitespace already separates the two sides.
    if (state.safe("\n", info) !== "\n" || cannotEndLine(node, parent, state)) {
      return /[ \t]/.test(info.before) ? "" : " ";
    }
    if (
      spelling === "twoSpaces" &&
      !mustBeBackslash(node, parent, state) &&
      info.before !== "" &&
      !endsInWhitespace(info.before)
    ) {
      return TWO_SPACE_BREAK;
    }
    return BACKSLASH_BREAK;
  };
  const peek = (node: unknown, parent: PhrasingNode | undefined, state: BreakState): string => {
    if (cannotEndLine(node, parent, state)) return " ";
    return spelling === "twoSpaces" && !mustBeBackslash(node, parent, state) ? " " : "\\";
  };
  return Object.assign(handle, { peek });
}
