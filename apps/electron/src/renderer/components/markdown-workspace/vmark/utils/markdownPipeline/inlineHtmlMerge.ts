// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Inline HTML pairs — merging `<kbd>`, text, `</kbd>` into one node.
 *
 * Purpose: the parser reads an inline HTML element as three siblings — an
 * opening `html` node, the content, a closing `html` node. The editor shows an
 * element as one atom, so a pair whose content is plain is merged into a
 * single `html` node holding the element's source.
 *
 * That node is written back verbatim, and on the next load its text is parsed
 * as markdown again. So merging is only correct when the merged source READS
 * BACK as the siblings it was made from. It is not for `\*x\*` (the stars come
 * back as emphasis), for a hard break (written as `<br>`, it comes back as a
 * tag, and then as the text `&lt;br&gt;`), or for the text `&amp;` written
 * raw (it comes back as `&`).
 *
 * Key decisions:
 *   - Merge only what reads back the same. The merged source is parsed and
 *     compared with the original siblings; when they differ the pair is left
 *     as three nodes, which the serializer writes exactly. Plain words — the
 *     usual `<kbd>Ctrl</kbd>` — are recognised without parsing.
 *   - Rewrite as little as possible. Text goes in as written except for `<`,
 *     which would open a tag when the element is shown; `&` is escaped only
 *     when the first form does not read back, i.e. when it would otherwise
 *     decode as a character reference. Quotes and `>` need nothing.
 *   - A pair that holds a hard break is never merged: an element has no way
 *     to hold one.
 *   - Formatting inside a pair (emphasis, links, code) is not merged either;
 *     merging would discard the marks.
 *
 * @coordinates-with mdastToProseMirror.ts — applies this to inline children
 * @coordinates-with parser.ts — the read-back check
 * @module utils/markdownPipeline/inlineHtmlMerge
 */

import type { Content, Html, Text } from "mdast";
import { parseMarkdownToMdast } from "./parser";

const INLINE_HTML_OPEN_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>$/;
const INLINE_HTML_CLOSE_RE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/;

/** Letters, digits and spaces: text that cannot be read as anything else. */
const PLAIN_TEXT_RE = /^[\p{L}\p{N} ]*$/u;

/** Text placed before the element when it is parsed back, to make a paragraph. */
const PROBE_PREFIX = "x ";

const READ_BACK_CACHE_LIMIT = 512;
const readBackCache = new Map<string, boolean>();

type Token = readonly [type: string, value: string];

function parseInlineHtmlOpen(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<") || trimmed.startsWith("</") || trimmed.endsWith("/>")) {
    return null;
  }
  const match = trimmed.match(INLINE_HTML_OPEN_RE);
  return match ? match[1]!.toLowerCase() : null;
}

function isInlineHtmlClose(value: string, tagName: string): boolean {
  const match = value.trim().match(INLINE_HTML_CLOSE_RE);
  return match ? match[1]!.toLowerCase() === tagName : false;
}

/** `nodes` as (type, value) pairs, adjacent text joined. */
function tokensOf(nodes: readonly Content[]): Token[] {
  const tokens: Array<[string, string]> = [];
  for (const node of nodes) {
    const value = "value" in node && typeof node.value === "string" ? node.value : "";
    const last = tokens[tokens.length - 1];
    if (node.type === "text" && last?.[0] === "text") last[1] += value;
    else tokens.push([node.type, value]);
  }
  return tokens;
}

const sameTokens = (a: readonly Token[], b: readonly Token[]): boolean =>
  a.length === b.length && a.every((token, index) => token[0] === b[index]![0] && token[1] === b[index]![1]);

/** True when `source`, parsed as inline content, is exactly `expected`. */
function readsBackAs(source: string, expected: readonly Token[]): boolean {
  const key = JSON.stringify([source, expected]);
  const cached = readBackCache.get(key);
  if (cached !== undefined) return cached;

  const root = parseMarkdownToMdast(PROBE_PREFIX + source);
  const [paragraph, ...rest] = root.children;
  let answer = false;
  if (rest.length === 0 && paragraph?.type === "paragraph") {
    const [lead, ...actual] = tokensOf(paragraph.children as Content[]);
    answer = lead?.[0] === "text" && lead[1] === PROBE_PREFIX && sameTokens(actual, expected);
  }

  if (readBackCache.size >= READ_BACK_CACHE_LIMIT) readBackCache.clear();
  readBackCache.set(key, answer);
  return answer;
}

const escapeTagStart = (text: string): string => text.replace(/</g, "&lt;");
const escapeReferences = (text: string): string => escapeTagStart(text.replace(/&/g, "&amp;"));

/**
 * The source of the element made of `open`, `inner` and `close` as one node,
 * or null when no spelling of it reads back as those siblings.
 */
function mergedSource(open: Html, inner: readonly Content[], close: Html): string | null {
  if (inner.some((node) => node.type !== "text" && node.type !== "html")) return null;

  // A tree built by hand may leave `value` out; read it as empty.
  const valueOf = (node: Content): string => (node as Text | Html).value ?? "";
  const write = (escape: (text: string) => string): string =>
    open.value +
    inner.map((node) => (node.type === "text" ? escape(valueOf(node)) : valueOf(node))).join("") +
    close.value;

  if (inner.every((node) => node.type === "text" && PLAIN_TEXT_RE.test(valueOf(node)))) {
    return write(escapeTagStart);
  }
  const expected = tokensOf([open, ...inner, close]);
  for (const escape of [escapeTagStart, escapeReferences]) {
    const source = write(escape);
    if (readsBackAs(source, expected)) return source;
  }
  return null;
}

/**
 * `children` with each inline HTML pair that can be merged replaced by one
 * `html` node. Pairs that cannot are left as they are.
 */
export function mergeInlineHtmlTags(children: readonly Content[]): Content[] {
  const result: Content[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!;
    const tagName = node.type === "html" ? parseInlineHtmlOpen(node.value ?? "") : null;
    if (node.type !== "html" || tagName === null) {
      result.push(node);
      continue;
    }

    let depth = 1;
    let closeIndex = -1;
    for (let cursor = index + 1; cursor < children.length; cursor += 1) {
      const next = children[cursor]!;
      if (next.type !== "html") continue;
      const value = String(next.value ?? "");
      if (parseInlineHtmlOpen(value) === tagName) {
        depth += 1;
      } else if (isInlineHtmlClose(value, tagName)) {
        depth -= 1;
        if (depth === 0) {
          closeIndex = cursor;
          break;
        }
      }
    }

    const merged =
      closeIndex === -1
        ? null
        : mergedSource(node, children.slice(index + 1, closeIndex), children[closeIndex] as Html);
    if (merged === null) {
      result.push(node);
      continue;
    }
    result.push({ type: "html", value: merged } as Html);
    index = closeIndex;
  }

  return result;
}
