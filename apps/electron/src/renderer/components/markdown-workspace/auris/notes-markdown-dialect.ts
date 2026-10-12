// 移植自 Auris 1.0.17 @ 5d972ccd；兼容定界符和渲染副本归一化，原始草稿不在展示时改写。
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import type { Plugin } from "unified";
import { remarkInlineFastPaths } from "../vmark/utils/markdownPipeline/parser/fastPaths/remarkInlineFastPaths";
import { buildProbeOpaqueMask as buildOpaqueMask } from "./notes-math-opaque-ranges";
import { checkNestingDepth as assertNotesMarkdownNestingSafe } from "../vmark/utils/markdownPipeline/nestingDepth";

type MathDelimiterKind = "display" | "inline";

export interface MathDelimiterSpan {
  content: string;
  end: number;
  kind: MathDelimiterKind;
  start: number;
};


function lineStartAt(text: string, index: number) {
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEndAt(text: string, index: number) {
  const newline = text.indexOf("\n", index);
  return newline < 0 ? text.length : newline;
}

function displayBlockContext(before: string) {
  const quotePrefix = /^( {0,3}(?:>[ \t]?)+)/u.exec(before)?.[1] ?? "";
  const listPrefix = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/u.exec(
    before.slice(quotePrefix.length),
  )?.[0] ?? "";
  const continuation = `${quotePrefix}${" ".repeat(listPrefix.length)}`;

  return {
    continuation,
    separator: `\n${quotePrefix.trimEnd()}\n${continuation}`,
  };
}

function containsBlankLine(value: string) {
  return /\n[ \t]*\r?\n/u.test(value);
}

function longestDollarRun(value: string) {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    current = character === "$" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function longestDollarOnlyLine(value: string) {
  return value.split("\n").reduce((longest, line) => {
    const match = /^ {0,3}(\$+)[ \t]*\r?$/u.exec(line);
    return Math.max(longest, match?.[1]?.length ?? 0);
  }, 0);
}

/**
 * Locate AI-compatible LaTeX delimiters without allowing Markdown code or URL
 * regions to participate. Delimiters are the only bytes rewritten; the LaTeX
 * payload is copied verbatim.
 */
export function findCompatibleMathDelimiterSpans(
  markdown: string,
): MathDelimiterSpan[] {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) return [];

  const mask = buildOpaqueMask(markdown);
  const spans: MathDelimiterSpan[] = [];

  for (let index = 0; index < markdown.length - 1; index += 1) {
    if (
      mask[index] ||
      markdown[index] !== "\\" ||
      (index > 0 && markdown[index - 1] === "\\")
    ) {
      continue;
    }

    let openerIndex = index;
    while (markdown[openerIndex] === "\\") openerIndex += 1;
    const delimiterWidth = openerIndex - index;

    // NotebookLM can copy delimiters with two backslashes; an earlier rich
    // editor save can then escape both the backslashes and bracket, leaving
    // three. Accept only balanced runs of one to three, while leaving longer
    // runs and TeX line breaks alone.
    if (delimiterWidth > 3) continue;

    const opener = markdown[openerIndex];
    const kind: MathDelimiterKind | null =
      opener === "(" ? "inline" : opener === "[" ? "display" : null;
    if (!kind || mask[openerIndex]) continue;

    const closer = kind === "inline" ? ")" : "]";
    let close = -1;
    let cursor = openerIndex + 1;

    while (cursor < markdown.length) {
      if (markdown[cursor] !== "\\") {
        cursor += 1;
        continue;
      }

      const closeStart = cursor;
      while (markdown[cursor] === "\\") cursor += 1;
      const closeWidth = cursor - closeStart;

      if (
        closeWidth === delimiterWidth &&
        markdown[cursor] === closer &&
        !mask[closeStart] &&
        !mask[cursor]
      ) {
        close = closeStart;
        break;
      }
    }

    if (close < 0) continue;
    const end = close + delimiterWidth + 1;
    const rawContent = markdown.slice(openerIndex + 1, close);
    const content = sanitizeMathContent(rawContent);

    if (
      !content ||
      containsBlankLine(rawContent) ||
      mask.slice(index, end).some(Boolean)
    ) {
      continue;
    }

    if (kind === "inline" && rawContent.includes("\n")) {
      continue;
    }

    if (kind === "display") {
      const before = markdown.slice(lineStartAt(markdown, index), index);
      const after = markdown.slice(end, lineEndAt(markdown, end));
      const sharesLineWithProse = before.trim() || after.trim();

      // A paired escaped bracket around an ordinary word is often literal
      // Markdown text. Retain that spelling unless it contains math syntax.
      if (
        sharesLineWithProse &&
        content.length > 1 &&
        /^[\p{Letter}][\p{Letter}\p{Number}\s-]*$/u.test(content)
      ) {
        continue;
      }
    }

    spans.push({ content, end, kind, start: index });
    index = end - 1;
  }

  return spans;
}

/** Normalize export escapes only inside an already recognized math span. */
export function sanitizeMathContent(content: string): string {
  let cleaned = content.trim();
  // Runs before TeX commands are export/Markdown escapes. Row separators and
  // row spacing (\\[4pt]) are different syntax and must retain two slashes.
  cleaned = cleaned.replace(/\\{2,}([a-zA-Z]+|\{|\}|\||,|:|;|!)/gu, "\\$1");
  cleaned = cleaned.replace(/\\{4,}(?=\s|$)/gu, "\\\\");
  cleaned = cleaned.replace(/\\{2,}_|\\_(?=\{)/gu, "_");
  cleaned = cleaned.replace(/(?<!\\)\\([\[\]])(?!\d+(?:pt|em|ex|mm|cm|in)\])/gu, "$1");
  // Entity decoding is intentionally local to math; ordinary prose/code/HTML
  // keeps its original spelling and no markup is injected into the document.
  cleaned = cleaned.replace(/&(?:gt|lt|amp|quot|apos|#(\d+)|#x([\da-f]+));/giu,
    (entity, decimal: string | undefined, hex: string | undefined) => {
      if (decimal || hex) {
        const point = Number.parseInt(decimal ?? hex!, decimal ? 10 : 16);
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point) : entity;
      }
      return ({ "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&apos;": "'" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
    });
  cleaned = cleaned.replace(/(?<!\\)%/gu, "\\%");
  return cleaned;
}

/** Dollar math in pasted text and legacy escaped exports. Currency stays text. */
export function findDollarMathDelimiterSpans(markdown: string): MathDelimiterSpan[] {
  if (!markdown.includes("$")) return [];
  const mask = buildOpaqueMask(markdown);
  const spans: MathDelimiterSpan[] = [];
  // Pair equal dollar runs within one logical paragraph. A dead opener never
  // searches beyond a blank line or an opaque range.
  const runs: Array<{ start: number; end: number; slashes: number }> = [];
  for (let i = 0; i < markdown.length; i += 1) {
    if (markdown[i] !== "$" || mask[i]) continue;
    const start = i;
    while (markdown[i + 1] === "$") i += 1;
    let slashStart = start;
    while (slashStart > 0 && markdown[slashStart - 1] === "\\") slashStart -= 1;
    // Escaped single dollars are TeX/prose content, never delimiters. Keep
    // doubled escaped dollars as candidates for a damaged export only.
    if (i + 1 - start === 1 && (start - slashStart) % 2) continue;
    runs.push({ start, end: i + 1, slashes: start - slashStart });
  }
  for (let i = 0; i < runs.length; i += 1) {
    const open = runs[i]!;
    const width = open.end - open.start;
    if (open.slashes && (width !== 2 || open.slashes < 2)) continue;
    const close = runs[i + 1];
    if (!close || close.end - close.start !== width) continue;
    const raw = markdown.slice(open.end, close.start);
    if (!raw.trim() || containsBlankLine(raw) || mask.subarray(open.end, close.start).some(Boolean)) continue;
    const exportEscapes = /\\{2,}[a-zA-Z]|\\+_/u.test(raw);
    if (open.slashes && !exportEscapes) continue;
    if (close.slashes % 2 && !(width === 2 && exportEscapes)) continue;
    if (width === 1 && (/^\s|\s$/u.test(raw) || raw.includes("\n"))) continue;
    // An exported closer can have backslashes attached to the delimiter.
    // Strip these only alongside the independent evidence of export escapes.
    const content = sanitizeMathContent(width === 2 && exportEscapes ? raw.replace(/\\+$/u, "") : raw);
    spans.push({ start: open.start - open.slashes, end: close.end, content,
      kind: width === 2 ? "display" : "inline" });
    i += 1;
  }
  return spans;
}

/** Shared recognized spans for rich paste; never inspect code or link targets. */
export function findNotesMathDelimiterSpans(markdown: string): MathDelimiterSpan[] {
  const candidates = [...findCompatibleMathDelimiterSpans(markdown), ...findDollarMathDelimiterSpans(markdown)]
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: MathDelimiterSpan[] = [];
  for (const span of candidates) {
    if (!spans.length || span.start >= spans[spans.length - 1]!.end) spans.push(span);
  }
  return spans;
}

/** Normalize compatible AI delimiters and damaged dollar exports to canonical math. */
export function normalizeNotesMathDelimiters(markdown: string) {
  const spans = findNotesMathDelimiterSpans(markdown).filter(span => {
    // Standard dollar math already has parser-authoritative block/container
    // semantics. Only rewrite dollar exports when their escaping is damaged.
    const raw = markdown.slice(span.start, span.end);
    const width = /^\$+/u.exec(raw)?.[0].length ?? 0;
    const damagedSingleLineDollar = width > 0 && !raw.includes("\n") &&
      raw.slice(width, -width) !== span.content;
    return (!raw.startsWith("$") && !/^\\+\$/u.test(raw)) ||
      damagedSingleLineDollar ||
      (span.kind === "inline" && span.content.includes("$")) ||
      /^\\+\$\$/u.test(raw) || /\\+\$\$$/u.test(raw);
  });
  if (spans.length === 0) return markdown;

  const result: string[] = [];
  let cursor = 0;

  for (const span of spans) {
    result.push(markdown.slice(cursor, span.start));
    if (span.kind === "display") {
      const fence = "$".repeat(
        Math.max(2, longestDollarOnlyLine(span.content) + 1),
      );
      const before = markdown.slice(lineStartAt(markdown, span.start), span.start);
      const after = markdown.slice(span.end, lineEndAt(markdown, span.end));
      const { continuation, separator } = displayBlockContext(before);
      // remark-math only makes a block node when its fence is on a separate
      // line. AI exports may place \[...\] directly after the prose that
      // introduces it. Keep continuation indentation for lists and quotes.
      result.push(
        `${before.trim() ? separator : ""}${fence}\n${continuation}${span.content.replaceAll("\n", `\n${continuation}`)}\n${continuation}${fence}${after.trim() ? separator : ""}`,
      );
    } else {
      const fence = "$".repeat(Math.max(1, longestDollarRun(span.content) + 1));
      result.push(`${fence}${span.content}${fence}`);
    }
    cursor = span.end;
  }

  result.push(markdown.slice(cursor));
  return result.join("");
}

interface MdastNode {
  children?: MdastNode[];
  data?: { hChildren?: MdastNode[] };
  type: string;
  value?: string;
};

/** Avoid remark-math's `$100 and $200` currency false positive. */
const remarkValidateNotesMath: Plugin = function () {
  return (tree) => {
    const stack = [tree as MdastNode];
    while (stack.length > 0) {
      const parent = stack.pop();
      if (!parent?.children) continue;

      parent.children = parent.children.map((child) => {
        if (
          child.type === "inlineMath" &&
          typeof child.value === "string" &&
          (/^\s/u.test(child.value) || /\s$/u.test(child.value))
        ) {
          return { type: "text", value: `$${child.value}$` };
        }
        if (
          (child.type === "inlineMath" || child.type === "math") &&
          typeof child.value === "string"
        ) {
          child.value = sanitizeMathContent(child.value);
          // remark-math creates HAST text during parsing. remark-rehype uses
          // that cached text, so update it together with the MDAST value.
          const html = [...(child.data?.hChildren ?? [])];
          while (html.length) {
            const node = html.pop()!;
            if (node.type === "text") node.value = child.value;
            if (node.children) html.push(...node.children);
          }
        }
        if (child.children) stack.push(child);
        return child;
      });
    }
  };
};

/** One Notes Markdown dialect shared by editor import and reading rendering. */
export function createNotesMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkInlineFastPaths)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkValidateNotesMath);
}

export function parseNotesMarkdownAst(markdown: string) {
  assertNotesMarkdownNestingSafe(markdown);
  const processor = createNotesMarkdownProcessor();
  const source = normalizeNotesMathDelimiters(markdown);
  return processor.runSync(processor.parse(source));
}
