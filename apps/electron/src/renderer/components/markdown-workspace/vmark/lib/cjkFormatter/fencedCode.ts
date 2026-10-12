// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Fenced code blocks as protected regions.
 *
 * Purpose: the fenced-code detector of the protected-region scanner
 * (markdownParser.ts). The scan itself — one pass over the lines, a closer
 * at least as long as the opener's whole run, CRLF/LF/CR line endings — is
 * the shared scanner in `utils/markdownPipeline/fencedCodeBlocks.ts`; see its
 * header for the rules.
 *
 * Key decisions:
 *   - An unclosed fence claims the rest of the document, as CommonMark says;
 *     a document being edited is unterminated most of the time, and the
 *     renderer shows that text as code, so the formatter must not rewrite it.
 *
 * @coordinates-with markdownParser.ts — the scanner that calls this first
 * @coordinates-with utils/markdownPipeline/fencedCodeBlocks.ts — the shared scan
 * @module lib/cjkFormatter/fencedCode
 */
import { findFencedCodeBlocks } from "../../utils/markdownPipeline/fencedCodeBlocks";
import type { ProtectedRegion } from "./types";

/**
 * Every fenced code block in `text`, in order, each from its opener's line
 * start to the end of its closer's line content (before the line ending), or
 * to the end of the text when no line closes it.
 */
export function findFencedCodeRegions(text: string): ProtectedRegion[] {
  return findFencedCodeBlocks(text).map(({ start, end }) => ({ start, end, type: "fenced_code" }));
}
