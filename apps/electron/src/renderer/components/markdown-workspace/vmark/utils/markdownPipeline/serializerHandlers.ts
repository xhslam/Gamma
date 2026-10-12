// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Custom mdast-util-to-markdown handlers for images, links and raw HTML.
 *
 * Purpose: VMark overrides remark-stringify's default image/link handlers to
 * emit angle-bracket destinations for URLs containing whitespace instead of
 * percent-encoding them (more readable, still CommonMark).
 *
 * Key decisions:
 *   - Links whose only child is a text node equal to the URL (or its
 *     `mailto:` form) serialize as autolinks (`<url>`), mirroring
 *     mdast-util-to-markdown's formatLinkAsAutolink. Without this branch the
 *     custom handler rewrote every autolink and bare GFM URL literal to
 *     `[https\://…](https://…)` — losing the authored form and injecting
 *     escapes into the label (#1102).
 *   - Destinations and titles are escaped: a raw destination cannot hold
 *     whitespace, control chars, unbalanced parens, or a leading `<` (those
 *     switch to the `<…>` literal form with `\`, `<`, `>` escaped and CR/LF
 *     percent-encoded); `"` in titles is backslash-escaped so it cannot
 *     terminate the construct early.
 *   - Image alt text is escaped by the serializer's own text escaping, inside
 *     the label construct. An alt is read back as inline markdown and
 *     flattened to text, so every character that could start markup has to be
 *     escaped, not only the brackets: `_c_` came back as `c`.
 *   - Raw HTML is written as it is, except that a `|` inside a table cell is
 *     escaped: a pipe ends the cell wherever it stands.
 *   - The handlers carry a `peek` function (upstream Handle contract) so
 *     phrasing lookahead reads the first character without running the
 *     full serializer.
 *
 * @coordinates-with serializer.ts — installs these handlers on remark-stringify
 * @coordinates-with @/utils/markdownUrl — shared whitespace predicate (urlNeedsBrackets)
 * @module utils/markdownPipeline/serializerHandlers
 */

import type { Image, Link, Parents } from "mdast";
import { urlNeedsBrackets } from "../markdownUrl";
import { MAX_BLANK_LINES } from "./blankLineCapture";

/** mdast-util-to-markdown state (simplified for our handlers). */
export interface ToMarkdownState {
  containerPhrasing: (
    node: Link,
    info: { before: string; after: string }
  ) => string;
  /** Push a construct onto the state stack; returns the matching exit. */
  enter: (construct: string) => () => void;
  /** Escape `value` for the constructs currently on the stack. */
  safe: (value: string, info: { before: string; after: string }) => string;
}

/**
 * URI scheme at the start of a URL, per CommonMark: a letter followed by
 * 1-31 letters, digits, `+`, `.` or `-`.
 *
 * The previous spelling (`[a-z][a-z+.-]+`) excluded DIGITS, so `s3://` and
 * `h2://` were not recognized as autolinks and lost their authored form; and
 * it had no upper bound, so a 33-character scheme was emitted as `<scheme:…>`
 * which CommonMark does not read back as an autolink — the link became text.
 */
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/;

/** True when the URL contains a character that would terminate or invalidate an autolink (`<url>`): control chars, space, `<`, `>`, DEL. */
function hasAutolinkUnsafeChar(url: string): boolean {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || ch === "<" || ch === ">") return true;
  }
  return false;
}

/** CommonMark's maximum parenthesis nesting inside a raw destination. */
const MAX_RAW_DESTINATION_PAREN_DEPTH = 32;

/**
 * True when a raw destination cannot represent this URL's parentheses —
 * either they are unbalanced, or they nest deeper than CommonMark allows.
 *
 * Checking only the final balance was not enough: 40 balanced pairs are
 * "balanced" but exceed the nesting limit, so the raw form emitted here
 * reparsed as plain text and destroyed the link on the next save.
 */
function parensNeedAngleForm(url: string): boolean {
  let depth = 0;
  let deepest = 0;
  for (const ch of url) {
    if (ch === "(") {
      depth++;
      if (depth > deepest) deepest = depth;
    } else if (ch === ")") {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth !== 0 || deepest > MAX_RAW_DESTINATION_PAREN_DEPTH;
}

/** True when the URL contains an ASCII control character or DEL. */
function hasControlChar(url: string): boolean {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Format a destination for `[text](…)` / `![alt](…)`.
 *
 * Raw form is kept whenever CommonMark allows it. URLs that a raw
 * destination cannot represent — empty, whitespace, control chars,
 * unbalanced parens, or a leading `<` (which would read as the literal
 * form) — switch to `<…>` with `\`, `<`, `>` escaped and CR/LF
 * percent-encoded (newlines are invalid in a destination even escaped).
 */
/**
 * Escape an `&` that would otherwise start a character reference.
 *
 * A destination is entity-decoded when parsed, so a URL whose LITERAL text
 * is `?a=1&amp;b=2` must be written `?a=1&amp;amp;b=2` to come back the
 * same. Emitting it verbatim silently changed the URL to `?a=1&b=2` on
 * every save.
 */
function escapeEntityStarts(url: string): string {
  return url.replace(
    /&(?=[a-zA-Z][a-zA-Z0-9]*;|#\d+;|#[xX][0-9a-fA-F]+;)/g,
    "&amp;",
  );
}

function formatDestination(url: string): string {
  const needsAngle =
    url === "" ||
    url.startsWith("<") ||
    urlNeedsBrackets(url) ||
    hasControlChar(url) ||
    parensNeedAngleForm(url);
  if (!needsAngle) return escapeEntityStarts(url);
  const escaped = escapeEntityStarts(url)
    .replace(/\\/g, "\\\\")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  return `<${escaped}>`;
}

/** Escape a title for the double-quoted `"…"` position. */
function formatTitle(title: string): string {
  return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The text to place inside `<…>` when the link round-trips as an autolink,
 * or null when it must stay in `[text](url)` resource form. Mirrors
 * mdast-util-to-markdown's formatLinkAsAutolink: a single text child equal
 * to the URL (or the URL minus `mailto:`), no title, a URI scheme, and no
 * characters that would terminate the autolink.
 */
function autolinkValue(node: Link): string | null {
  if (node.title) return null;
  if (node.children.length !== 1) return null;
  const child = node.children[0]!;
  if (child.type !== "text" || !child.value) return null;
  if (child.value !== node.url && `mailto:${child.value}` !== node.url) return null;
  if (!URI_SCHEME_RE.test(node.url) || hasAutolinkUnsafeChar(node.url)) return null;
  return child.value;
}

/**
 * Custom image handler: escaped alt/title, angle-bracket destination when
 * the raw form cannot represent the URL.
 */
function imageHandler(node: Image, _parent: Parents | undefined, state: ToMarkdownState): string {
  // The alt text is read back as inline markdown and flattened to text, so it
  // is escaped the way label text is: `_c_` would otherwise come back as `c`.
  const exit = state.enter("image");
  const subexit = state.enter("label");
  const alt = state.safe(node.alt || "", { before: "![", after: "]" });
  subexit();
  exit();
  const formattedUrl = formatDestination(node.url);

  if (node.title) {
    return `![${alt}](${formattedUrl} "${formatTitle(node.title)}")`;
  }
  return `![${alt}](${formattedUrl})`;
}

/**
 * Custom link handler: preserves autolinks, escaped title, angle-bracket
 * destination when the raw form cannot represent the URL.
 */
function linkHandler(
  node: Link,
  _parent: Parents | undefined,
  state: ToMarkdownState
): string {
  // `<https://…>` for URI autolinks, `<user@example.com>` for mailto (#1102).
  const autolink = autolinkValue(node);
  if (autolink !== null) {
    return `<${autolink}>`;
  }

  const formattedUrl = formatDestination(node.url);

  // Serialize children (the link text) INSIDE the label construct, so `]`
  // is escaped there (upstream marks `]` unsafe only inConstruct "label").
  // Without this, `[link [foo [bar]]](/uri)` serialized its inner `]`
  // unescaped, the reparse closed the label early, and the next pass
  // degraded the link to literal text (CommonMark example 512).
  const exit = state.enter("link");
  const subexit = state.enter("label");
  const text = state.containerPhrasing(node, {
    before: "[",
    after: "](",
  });
  subexit();
  exit();

  if (node.title) {
    return `[${text}](${formattedUrl} "${formatTitle(node.title)}")`;
  }
  return `[${text}](${formattedUrl})`;
}

/** Image handler with the upstream `peek` contract (lookahead sees `!`). */
export const handleImage = Object.assign(imageHandler, {
  peek: () => "!",
});

/** Link handler with the upstream `peek` contract (`<` for autolinks, `[` otherwise). */
export const handleLink = Object.assign(linkHandler, {
  peek: (node: Link) => (autolinkValue(node) !== null ? "<" : "["),
});

/** `value` with every `|` that no backslash escapes given one. */
function escapeBarePipes(value: string): string {
  let out = "";
  let backslashes = 0;
  for (const char of value) {
    if (char === "|" && backslashes % 2 === 0) out += "\\";
    backslashes = char === "\\" ? backslashes + 1 : 0;
    out += char;
  }
  return out;
}

/**
 * `html` handler: the node's source as written — except inside a table cell,
 * where an unescaped `|` ends the cell wherever it stands. HTML read from a
 * cell keeps the backslash of its `\|`, so that is left alone; a pipe that
 * arrives bare (text merged into an element, inlineHtmlMerge.ts) is escaped.
 * Upstream writes HTML raw everywhere, which split the row.
 */
export const handleHtml = Object.assign(
  (node: { value?: string }, _parent: unknown, state: { stack: readonly string[] }): string => {
    const value = node.value ?? "";
    return state.stack.includes("tableCell") ? escapeBarePipes(value) : value;
  },
  { peek: (): string => "<" },
);

/**
 * Custom mdast-util-to-markdown join: when the right sibling carries a captured
 * `data.blankLinesBefore` count (stamped by proseMirrorToMdast only when
 * preserveBlankLines is on), emit that many blank lines between the two blocks;
 * otherwise return undefined to inherit the default join (0 for tight list
 * children, 1 for normal siblings — so tight lists stay tight, SC5). Only a
 * finite integer in [0, MAX_BLANK_LINES] counts; any other value inherits the
 * default. Placed here so serializer.ts stays under its file-size baseline.
 */
export function blankLinesJoin(
  _left: unknown,
  right: { data?: object | undefined },
): number | undefined {
  const n = right?.data && "blankLinesBefore" in right.data ? right.data.blankLinesBefore : undefined;
  // Only a finite integer in the captured range is a valid separator count;
  // anything else (NaN, fraction, negative, over-cap) inherits the default.
  // A negative would concatenate adjacent blocks; NaN would remove the
  // separator; a huge value would emit a pathological run.
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_BLANK_LINES) {
    return undefined;
  }
  return n;
}
