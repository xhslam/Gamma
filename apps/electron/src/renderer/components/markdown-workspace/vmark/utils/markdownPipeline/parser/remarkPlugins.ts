// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * VMark-specific remark plugins: math validation and setext-heading disable.
 *
 * @module utils/markdownPipeline/parser/remarkPlugins
 */

import type { Plugin } from "unified";
import type { Content, Parent, Root, Text } from "mdast";
import type { InlineMath } from "mdast-util-math";
import { createCodeFenceTracker } from "./opaqueRegions";

/**
 * Maximum mdast nesting depth the pipeline accepts before flattening.
 *
 * The mdast→ProseMirror converters (and several serializer walks) are
 * mutually recursive; adversarial input can nest emphasis thousands of
 * levels deep and blow the call stack — a parser CRASH found by the
 * OSS-Fuzz corpus soak. No legitimate document approaches 200
 * levels (ProseMirror marks cannot even represent nested same-type
 * emphasis), so beyond it the subtree flattens to its plain text: defined
 * degradation instead of a RangeError.
 */
export const MAX_MDAST_DEPTH = 200;

/** Flatten any node deeper than MAX_MDAST_DEPTH into its plain text. */
export const remarkDepthLimit: Plugin<[], Root> = function () {
  return (tree: Root) => {
    // Iterative — this guard must not itself be depth-limited.
    const stack: { node: Parent; depth: number }[] = [{ node: tree, depth: 0 }];
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (!Array.isArray(node.children)) continue;
      if (depth >= MAX_MDAST_DEPTH) {
        (node as { children: unknown[] }).children = [
          { type: "text", value: textOf(node) },
        ];
        continue;
      }
      for (const child of node.children) {
        if ("children" in child && Array.isArray((child as Parent).children)) {
          stack.push({ node: child as Parent, depth: depth + 1 });
        }
      }
    }
  };
};

/** Concatenated text of a subtree, iteratively. */
function textOf(node: Parent): string {
  let out = "";
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as { value?: string; children?: unknown[] };
    if (typeof current.value === "string") out += current.value;
    if (Array.isArray(current.children)) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) {
        stack.push(current.children[i]);
      }
    }
  }
  return out;
}

/**
 * Plugin to validate inline math and convert invalid ones back to text.
 * Invalid inline math: content with leading or trailing whitespace.
 * This prevents `$100 and $200` from being parsed as math.
 *
 * The restored text merges with its text neighbours, so the tree is the one a
 * text parse would have produced: one text node, not three siblings. Split
 * siblings made a paragraph read back from its own serialization (one text
 * node) differ from the first read of the same text.
 */
export const remarkValidateMath: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visitAndFixMath(tree);
  };
};

function visitAndFixMath(root: Root | Parent): void {
  // Iterative, NOT recursive: adversarial input can nest mdast thousands of
  // levels deep (emphasis-in-emphasis chains), and per-child recursion blew
  // the call stack — a parser CRASH on garbage input, found by the OSS-Fuzz
  // corpus soak. An explicit stack has no depth limit.
  const stack: (Root | Parent)[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    /* v8 ignore next -- @preserve defensive guard: always pushed with Root or Parent nodes; protects against leaf nodes passed in future refactors */
    if (!("children" in node) || !Array.isArray(node.children)) continue;

    // Type-safe children array using unknown to avoid strict type conflicts
    const newChildren: unknown[] = [];
    let modified = false;
    // True while the last entry of newChildren holds restored math text, so a
    // following text sibling joins it. Ordinary text siblings are left alone.
    let tailIsRestored = false;

    for (const child of node.children) {
      if (child.type === "inlineMath") {
        const mathNode = child as InlineMath;
        /* v8 ignore next -- @preserve remark-math always sets value to a string; the || "" fallback guards against hypothetical undefined from future parser versions */
        const value = mathNode.value || "";
        // Reject math with leading/trailing whitespace
        if (/^\s/.test(value) || /\s$/.test(value)) {
          // Convert back to text with dollar delimiters
          const restored: Text = { type: "text", value: `$${value}$`, position: child.position };
          const tail = newChildren[newChildren.length - 1] as Content | undefined;
          if (tail?.type === "text") {
            newChildren[newChildren.length - 1] = joinText(tail, restored);
          } else {
            newChildren.push(restored);
          }
          tailIsRestored = true;
          modified = true;
          continue;
        }
      }

      if (tailIsRestored && child.type === "text") {
        newChildren[newChildren.length - 1] = joinText(newChildren[newChildren.length - 1] as Text, child);
        tailIsRestored = false;
        continue;
      }
      tailIsRestored = false;

      if ("children" in child && Array.isArray((child as Parent).children)) {
        stack.push(child as Parent);
      }
      newChildren.push(child);
    }

    if (modified) {
      // Use type assertion to assign the modified children array
      (node as { children: unknown[] }).children = newChildren;
    }
  }
}

/**
 * One text node holding `left` then `right`, spanning both in the source when
 * both carry a position. A missing position is dropped rather than guessed.
 */
function joinText(left: Text, right: Text): Text {
  const joined: Text = { type: "text", value: left.value + right.value };
  if (left.position && right.position) {
    joined.position = { start: left.position.start, end: right.position.end };
  }
  return joined;
}

/**
 * Disable setext heading parsing (underline-style headings with `---` or `===`).
 *
 * VMark always serializes headings as ATX (`#`), never setext. Disabling setext
 * parsing prevents a common misparse: an empty nested list item (`  -`) being
 * interpreted as a setext heading underline for the preceding paragraph.
 *
 * Applied ONLY to documents that contain the ambiguous line — see
 * `hasAmbiguousListUnderline`. Disabling it unconditionally traded one
 * corruption for another: an authored setext heading became a paragraph whose
 * underline was escaped to `\=====`, or a paragraph plus a thematic break, and
 * `useTiptapFlush` wrote that back to the file on the next keystroke. Only the
 * first corruption had been measured.
 *
 * VMark still SERIALIZES headings as ATX, so a setext document is normalised on
 * write — but it is read as headings first, rather than destroyed.
 */
export const remarkDisableSetextHeadings: Plugin<[], Root> = function () {
  const data = this.data();
  const micromarkExtensions =
    (data.micromarkExtensions as unknown[]) || ((data as Record<string, unknown>).micromarkExtensions = []);
  micromarkExtensions.push({
    disable: { null: ["setextUnderline"] },
  });
};

/** Flags indicating which optional remark plugins are needed. */
export interface ContentAnalysis {
  hasMath: boolean;
  hasFrontmatter: boolean;
  hasWikiLinks: boolean;
  hasDetails: boolean;
  /** An INDENTED lone list marker, the line that misparses as a setext underline. */
  hasAmbiguousListUnderline: boolean;
}

/**
 * A line that is nothing but an indented list marker — `  -`, `\t*`, `   +`.
 *
 * This is the exact shape `remarkDisableSetextHeadings` exists to protect: an
 * empty nested list item directly under a paragraph, which CommonMark reads as
 * a setext underline for that paragraph. Detecting it lets the protection apply
 * only to documents that need it, instead of costing every document its setext
 * headings.
 */
const AMBIGUOUS_LIST_UNDERLINE = /^[ \t]+[-*+][ \t]*$/;

/** Indented-code line: 4+ spaces or a tab. Its content is literal text. */
const INDENTED_CODE_LINE = /^(?: {4}|\t)/;

/**
 * Whether the document contains the ambiguous shape, OUTSIDE code regions.
 *
 * The bare regex matches a lone indented marker anywhere — including inside a
 * fenced block or an indented code block, where `  -` is just a character in a
 * code sample. One such line used to disable setext headings for the WHOLE
 * document, so a real `Title` / `-----` heading elsewhere in the same file
 * silently parsed as a paragraph and could be rewritten on save.
 *
 * Fence state comes from the shared tracker (opaqueRegions.ts), the
 * one CommonMark fence-line scanner, so its closer/CRLF rules are
 * tested in one place. Indented-code lines are skipped too: `    -` is
 * never a setext underline — indented code cannot interrupt a
 * paragraph, and a setext underline allows at most 3 spaces of indent.
 */
function hasAmbiguousListUnderline(markdown: string): boolean {
  const tracker = createCodeFenceTracker();
  for (const line of markdown.split("\n")) {
    if (tracker.feed(line)) continue;
    if (INDENTED_CODE_LINE.test(line)) continue;
    if (AMBIGUOUS_LIST_UNDERLINE.test(line)) return true;
  }
  return false;
}

/** A frontmatter fence line: three dashes, then nothing but spaces or tabs. */
const FRONTMATTER_FENCE = /^---[ \t]*$/;

/**
 * Whether the document opens with frontmatter: a fence on its first line and
 * another one closing it further down.
 *
 * This has to be exact, not a hint. `---` on the first line is also an
 * ordinary thematic break, and once the frontmatter extension has looked for a
 * closing fence and not found one, it reads every list and blockquote in the
 * rest of the document as a paragraph. So the extension is loaded only when
 * it will succeed. `frontmatterDetection.test.ts` holds this to the
 * extension's own reading.
 */
function opensWithFrontmatter(markdown: string): boolean {
  if (!markdown.startsWith("---")) return false;
  const lines = markdown.split(/\r\n|\r|\n/);
  if (!FRONTMATTER_FENCE.test(lines[0]!)) return false;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_FENCE.test(lines[index]!)) return true;
  }
  return false;
}

/**
 * Analyze markdown content to determine which plugins are needed.
 * This enables lazy loading of plugins for better performance.
 */
export function analyzeContent(markdown: string): ContentAnalysis {
  return {
    // Math: look for $ or $$ (quick heuristic)
    hasMath: markdown.includes("$"),
    hasFrontmatter: opensWithFrontmatter(markdown),
    // Wiki links: look for [[
    hasWikiLinks: markdown.includes("[["),
    // Details block: look for <details pattern
    // Case-insensitive: the details plugin accepts `<DETAILS>` and `<Details>`,
    // so a case-sensitive probe left those parsing as raw HTML instead.
    hasDetails: /<details(?:[\s>]|$)/i.test(markdown),
    hasAmbiguousListUnderline: hasAmbiguousListUnderline(markdown),
  };
}
