// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Pre/post processors for VMark's custom escape markers.
 *
 * Purpose: users write `\==`, `\++`, `\^`, `\~` to produce literal characters.
 * remark resolves backslash escapes before VMark's inline-mark plugin runs, so
 * by then `\==` and `==` are the same text. The sequences are therefore
 * swapped for Unicode Private Use Area placeholders before parsing — inert to
 * every tokenizer — and swapped back once the marks have been read.
 *
 * Key decisions:
 *   - Every sequence is replaced, wherever it stands; WHERE an escape applies
 *     is decided afterwards, from the node the placeholder ended up in. The
 *     parser already knows what is code, math, HTML, a link destination or a
 *     paragraph. A scanner run over the source beforehand has to guess, and
 *     guessed wrong: one stray backtick was taken for the start of a code span
 *     that never closed, switching escapes off for the rest of the document,
 *     while indented code, math, HTML, frontmatter and link destinations were
 *     not recognised at all and kept the placeholder — a private-use character
 *     written into the user's file.
 *   - Where the parser reads no escapes — code, math, HTML, frontmatter, an
 *     autolink's address, a reference's identifier — the placeholder goes back
 *     to the sequence as written (`\==`). Everywhere else it becomes the
 *     literal marker (`==`), which is what the escape means.
 *   - Two passes, because transforms run between them. Raw nodes are restored
 *     straight after parsing: a later transform may turn one into text (math
 *     that fails validation), and that text must already hold the source.
 *     HTML waits for the second pass: a `<details>` block is HTML that is
 *     parsed again as markdown, and its text needs the placeholders until the
 *     inline marks inside it have been read.
 *   - The source scan honours backslash pairing: in `\\==` the backslashes
 *     escape each other and the marker is real.
 *
 * @coordinates-with ../parser.ts — runs the three steps around the parse
 * @coordinates-with ../inlineParser.ts — the same steps for a details summary
 * @coordinates-with ../plugins/customInline.ts — the marks the placeholders hide from
 * @module utils/markdownPipeline/parser/escapeMarkers
 */

import type { Root } from "mdast";

/**
 * Escape placeholders for custom inline markers.
 * Uses Unicode Private Use Area to avoid conflicts with normal text.
 */
const ESCAPE_PATTERNS: ReadonlyArray<{ sequence: string; placeholder: string; restore: string }> = [
  { sequence: "\\==", placeholder: "", restore: "==" },
  { sequence: "\\++", placeholder: "", restore: "++" },
  { sequence: "\\^", placeholder: "", restore: "^" },
  { sequence: "\\~", placeholder: "", restore: "~" },
];

const ANY_PLACEHOLDER = /[-]/;

/** Node types whose `value` the parser copies from the source without reading escapes. */
const RAW_VALUE_TYPES: ReadonlySet<string> = new Set(["code", "inlineCode", "math", "inlineMath", "yaml"]);

/**
 * Replace `\==`, `\++`, `\^` and `\~` with placeholders, everywhere.
 *
 * One pass over the backslashes. A backslash that does not start a sequence
 * escapes the character after it, so both are skipped: that is what keeps the
 * second backslash of `\\==` from being read as the start of `\==`.
 */
export function preprocessEscapedMarkers(markdown: string): string {
  let out = "";
  let copied = 0;
  for (let at = markdown.indexOf("\\"); at !== -1; at = markdown.indexOf("\\", at)) {
    const match = ESCAPE_PATTERNS.find(({ sequence }) => markdown.startsWith(sequence, at));
    if (match) {
      out += markdown.slice(copied, at) + match.placeholder;
      at += match.sequence.length;
      copied = at;
    } else {
      at += 2;
    }
  }
  return copied === 0 ? markdown : out + markdown.slice(copied);
}

/** `text` with each placeholder replaced by the escape sequence as written. */
function toSequences(text: string): string {
  if (!ANY_PLACEHOLDER.test(text)) return text;
  let out = text;
  for (const { placeholder, sequence } of ESCAPE_PATTERNS) out = out.split(placeholder).join(sequence);
  return out;
}

/** `text` with each placeholder replaced by the literal marker. */
function toLiterals(text: string): string {
  if (!ANY_PLACEHOLDER.test(text)) return text;
  let out = text;
  for (const { placeholder, restore } of ESCAPE_PATTERNS) out = out.split(placeholder).join(restore);
  return out;
}

type Fields = Record<string, unknown>;

/** Apply `restore` to every string under `holder[key]`, in place. */
function restoreField(holder: Fields, key: string, restore: (text: string) => string): void {
  const value = holder[key];
  if (typeof value === "string") {
    holder[key] = restore(value);
  } else if (value && typeof value === "object") {
    const nested = value as Fields;
    for (const inner of Object.keys(nested)) restoreField(nested, inner, restore);
  }
}

/** Every node of `tree`, without recursion: a hostile tree can be deep. */
function eachNode(tree: Root, visit: (node: Fields) => void): void {
  const pending: Fields[] = [tree as unknown as Fields];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    visit(node);
    // Pushed one by one: a spread of a very long child list overflows the
    // argument limit.
    if (Array.isArray(node.children)) {
      for (const child of node.children as Fields[]) pending.push(child);
    }
  }
}

/** True when `node` is a link written as an address, not as `[text](address)`. */
function isAutolink(node: Fields, source: string): boolean {
  if (node.type !== "link") return false;
  const start = (node.position as { start?: { offset?: number } } | undefined)?.start?.offset;
  // A link made by a transform has no position; those are bare addresses too.
  return typeof start !== "number" || source[start] !== "[";
}

/**
 * First pass, on the tree as parsed and before any transform: put the source
 * text back where the parser read no escapes. `source` is the text that was
 * parsed, placeholders included.
 */
export function restoreRawEscapedMarkers(tree: Root, source: string): void {
  eachNode(tree, (node) => {
    if (RAW_VALUE_TYPES.has(String(node.type))) {
      restoreField(node, "value", toSequences);
      restoreField(node, "data", toSequences);
    }
    restoreField(node, "identifier", toSequences);
    if (isAutolink(node, source)) {
      restoreField(node, "url", toSequences);
      for (const child of (node.children as Fields[] | undefined) ?? []) {
        if (child.type === "text") restoreField(child, "value", toSequences);
      }
    }
  });
}

/**
 * Second pass, after the transforms: the source text back into what is still
 * HTML, and the literal marker everywhere else.
 */
export function restoreEscapedMarkers(tree: Root): void {
  eachNode(tree, (node) => {
    for (const key of Object.keys(node)) {
      if (key === "children" || key === "position" || key === "type") continue;
      const raw = node.type === "html" || (node.type === "details" && key === "summary");
      restoreField(node, key, raw ? toSequences : toLiterals);
    }
  });
}
