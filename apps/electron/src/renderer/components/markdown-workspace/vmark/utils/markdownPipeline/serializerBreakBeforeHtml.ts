// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * A line ending directly before inline HTML — keeping it.
 *
 * Purpose: mdast-util-to-markdown replaces a line ending that comes directly
 * before an inline `html` node with a space, because a tag at the start of a
 * line may be read as the start of an HTML BLOCK. After a hard break that
 * leaves `\ ` — a literal backslash and a space — or three spaces: the break
 * is gone, and in the backslash spelling a backslash has been added to the
 * text. `text\` followed by `<kbd>…` on the next line is ordinary writing.
 * After a soft line ending the author's line break becomes a space, and a
 * literal backslash before it is escaped on that save and not on the next.
 *
 * Most tags cannot do what upstream guards against: only some HTML starts a
 * block that may interrupt a paragraph (`<div>`, `<pre>`, a comment), and
 * `<b>`, `<span>`, `<kbd>` do not. For those the line ending is safe, and the
 * break can be kept.
 *
 * How: upstream decides by node TYPE. Before serializing, an `html` node that
 * follows a line ending — a `break`, or text that ends in one — and may
 * safely start a line is given another type, with a handler that writes the
 * same text. Upstream then leaves the line ending alone.
 *
 * Key decisions:
 *   - "May this start a line inside a paragraph?" is asked of the parser, on a
 *     three-token probe (`x`, a break, the HTML), not answered from a list of
 *     tag names: the list is CommonMark's seven HTML-block start conditions,
 *     and a copy of it here would be a second definition free to drift.
 *     Answers are cached by the HTML text; the cache is small and bounded.
 *   - The tree handed in is not changed. Only the nodes on the way to a
 *     retyped one are copied.
 *   - HTML that WOULD start a block keeps its type. The break before it
 *     cannot be written at all, and serializerBreak.ts writes a space there
 *     instead of a spelling that would add a backslash.
 *
 * @coordinates-with serializer.ts — runs the pass and installs the handler
 * @coordinates-with serializerBreak.ts — the break's side of the same boundary
 * @coordinates-with parser.ts — the probe
 * @module utils/markdownPipeline/serializerBreakBeforeHtml
 */

import { parseMarkdownToMdast } from "./parser";

/** The type an `html` node is given when the line ending before it may stay. */
export const HTML_AFTER_BREAK = "htmlAfterBreak";

/** A tree node as far as this pass looks at one. */
interface TreeNode {
  type: string;
  value?: string;
  children?: readonly TreeNode[];
}

const PROBE_CACHE_LIMIT = 512;
const probeCache = new Map<string, boolean>();

/**
 * True when `html` may start a line inside a paragraph and stay inline — the
 * parser reads `x`, a hard break, then `html` back as exactly that.
 */
function canFollowLineEnding(html: string): boolean {
  const cached = probeCache.get(html);
  if (cached !== undefined) return cached;

  const root = parseMarkdownToMdast(`x\\\n${html}\n`);
  const [paragraph, ...rest] = root.children as TreeNode[];
  const inline = paragraph?.type === "paragraph" ? (paragraph.children ?? []) : [];
  const answer = rest.length === 0 && inline[1]?.type === "break" && inline[2]?.type === "html";

  if (probeCache.size >= PROBE_CACHE_LIMIT) probeCache.clear();
  probeCache.set(html, answer);
  return answer;
}

/** True when `previous` is written with a line ending last: a break, or text that ends in one. */
function endsWithLineEnding(previous: TreeNode | undefined): boolean {
  if (previous?.type === "break") return true;
  return previous?.type === "text" && /[\r\n]$/.test(previous.value ?? "");
}

/**
 * `node` with every inline `html` that follows a line ending, and may keep it,
 * retyped as HTML_AFTER_BREAK. Returns `node` itself when nothing below it
 * changes.
 */
export function keepLineEndingsBeforeHtml<T extends TreeNode>(node: T): T {
  const children = node.children;
  if (!children) return node;

  let changed: TreeNode[] | undefined;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    let replacement = keepLineEndingsBeforeHtml(child);
    if (
      child.type === "html" &&
      endsWithLineEnding(children[index - 1]) &&
      canFollowLineEnding(child.value ?? "")
    ) {
      replacement = { ...child, type: HTML_AFTER_BREAK };
    }
    if (replacement !== child) {
      changed ??= children.slice();
      changed[index] = replacement;
    }
  }
  return changed ? { ...node, children: changed } : node;
}

/** Handler for HTML_AFTER_BREAK: the HTML as written, like `html` itself. */
export const handleHtmlAfterBreak = Object.assign(
  (node: { value?: string }): string => node.value ?? "",
  { peek: (): string => "<" },
);
