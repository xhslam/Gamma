// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Inline Markdown Parser
 *
 * Purpose: Parses inline markdown text to MDAST inline content nodes,
 * used for contexts where only inline (phrasing) content is expected.
 *
 * Pipeline: inline markdown string → unified/remark → extract paragraph children
 *
 * Key decisions:
 *   - Fast-path check for text without markdown chars avoids remark overhead
 *   - Falls back to plain text node on parse failure for resilience
 *   - One processor, built on first use: the dialect's plugin set is fixed
 *
 * @coordinates-with plugins/detailsBlock.ts — parses <summary> text with inline formatting
 * @coordinates-with parser/escapeMarkers.ts — escaped custom markers, as in the document parse
 * @coordinates-with mdastToProseMirror.ts — consumers convert resulting MDAST to PM nodes
 * The processor comes from the shared `inline-summary` dialect, so
 * this parser cannot drift from the others on what `~x~` or `==x==` mean.
 *
 * @module utils/markdownPipeline/inlineParser
 */

import type { Content, Paragraph, Root } from "mdast";
import { buildProcessorForMode } from "./dialect";
import {
  preprocessEscapedMarkers,
  restoreEscapedMarkers,
  restoreRawEscapedMarkers,
} from "./parser/escapeMarkers";
import { mdPipelineWarn } from "../debug";

/**
 * Characters that can make inline text mean something other than itself:
 * mark delimiters (`=`, `+`, `^` are the custom ==highlight==, ++underline++
 * and ^sup^ marks), brackets, a backslash escape, a character reference, a
 * tag, and what an autolink is made of.
 *
 * `&`, `\` and `<` belong here as much as the delimiters do. Without them a
 * summary written `a &lt; b` was taken as that literal text, and escaped once
 * more on every save.
 */
const NEEDS_PARSING = /[*_`~[\]=+^&\\<:@.]/;

/**
 * The `inline-summary` dialect — the smallest that still has inline marks.
 * Built from the shared descriptors so it cannot drift from the others on
 * what `~x~` or `==x==` mean. The plugin set is fixed, so it is
 * built once.
 */
let summaryProcessor: ReturnType<typeof buildProcessorForMode> | undefined;

/**
 * Parse inline markdown text to MDAST inline content.
 *
 * Wraps the text in a paragraph, parses it, and extracts the inline children.
 *
 * @param text - The inline markdown text to parse
 * @returns Array of inline MDAST content nodes
 */
export function parseInlineMarkdown(text: string): Content[] {
  if (!text || !text.trim()) {
    return [];
  }

  // Text with none of these is read as itself, and skips the parse.
  if (!NEEDS_PARSING.test(text)) {
    return [{ type: "text", value: text } as Content];
  }

  try {
    summaryProcessor ??= buildProcessorForMode("inline-summary");
    const processor = summaryProcessor;

    // Escaped custom markers (`\==`) are hidden from the inline-mark plugin
    // exactly as the document parse hides them (parser/escapeMarkers.ts).
    const source = preprocessEscapedMarkers(text);
    const tree = processor.parse(source) as Root;
    if (source !== text) restoreRawEscapedMarkers(tree, source);
    const transformed = processor.runSync(tree) as Root;
    if (source !== text) restoreEscapedMarkers(transformed);

    // The parser creates a root with children
    // For inline text, this should result in a single paragraph
    /* v8 ignore next -- @preserve runSync output always has children for valid remark processors */
    const children = (transformed as { children?: Content[] }).children ?? [];

    // Inline contexts (e.g. a details <summary>) accept phrasing content
    // only. Anything that parsed to something other than exactly one
    // paragraph — a thematic break for "***", a heading, multiple blocks —
    // is not representable inline and would throw when inserted into an
    // inline-only schema. Fall back to the literal text instead.
    const first = children[0];
    if (children.length === 1 && first?.type === "paragraph") {
      return (first as Paragraph).children as Content[];
    }

    return [{ type: "text", value: text } as Content];
  } catch (error) {
    // If parsing fails, return as plain text
    mdPipelineWarn("Failed to parse inline markdown:", error);
    return [{ type: "text", value: text } as Content];
  }
}
