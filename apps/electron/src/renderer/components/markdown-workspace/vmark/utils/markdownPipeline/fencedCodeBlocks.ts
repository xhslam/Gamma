// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Fenced code blocks, found in one pass over the lines.
 *
 * Purpose: the one fenced-code scanner for code that must find fences in raw
 * markdown text without parsing it — the CJK formatter's protected regions
 * and the serializer cosmetic pass's code ranges. A fence is up to three
 * spaces of indentation and a run of three or more backticks or tildes; it
 * closes on a line holding, after up to three spaces, a run of the SAME
 * character at least as long as the opener's WHOLE run, and nothing else but
 * spaces and tabs.
 *
 * Key decisions:
 *   - One pass, line by line: outside a fence a line may open one, inside a
 *     fence a line may only close it. A pairing PATTERN retried every opener
 *     that had no closer against the whole rest of the document — quadratic
 *     on a document of openers that cannot close one another ("```a").
 *   - The opener's run is the whole run. A pattern let it shrink by
 *     backtracking, so six backticks read as a three-backtick fence with
 *     "```" as its info string and a three-backtick line closed it — which
 *     CommonMark forbids.
 *   - An unclosed fence runs to the end of the document, as CommonMark says,
 *     and is reported with `closed: false`; each caller decides what that
 *     means for it. That includes an opener on the last line with no newline
 *     after it.
 *   - Lines end at CRLF, LF or a lone CR, as a multiline pattern's `^`/`$`
 *     read them, so a CRLF document's fences open and close as an LF one's.
 *   - Container prefixes (`>` of a blockquote, list indentation past three
 *     spaces) are not understood: this is a text scan, not a parse.
 *
 * @coordinates-with lib/cjkFormatter/fencedCode.ts — protected regions for the CJK formatter
 * @coordinates-with serializerCodeRanges.ts — code ranges for the cosmetic pass
 * @module utils/markdownPipeline/fencedCodeBlocks
 */

/** One fenced code block: from its opener's line start to the end of its closer's line content. */
export interface FencedCodeBlock {
  start: number;
  /** End of the closer line's content (before its line ending), or the text length when unclosed. */
  end: number;
  /** False for a fence no line closes, which runs to the end of the text. */
  closed: boolean;
}

/** Up to three spaces, then the fence run (captured whole). */
const OPENER = /^ {0,3}(`{3,}|~{3,})/;

/** The open fence a closer must match. */
interface OpenFence {
  start: number;
  char: string;
  length: number;
}

/**
 * Whether `line` closes `fence`: up to three spaces, a run of the fence's
 * character at least as long as its opener's, then only spaces and tabs.
 */
function closes(line: string, fence: OpenFence): boolean {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const runStart = i;
  while (line[i] === fence.char) i++;
  if (i - runStart < fence.length) return false;
  for (; i < line.length; i++) if (line[i] !== " " && line[i] !== "\t") return false;
  return true;
}

/** A line ending: CRLF, LF, or a lone CR (CommonMark's three). */
const LINE_ENDING = /\r\n|\n|\r/g;

/** Every fenced code block in `text`, in order. */
export function findFencedCodeBlocks(text: string): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];
  let open: OpenFence | null = null;
  let lineStart = 0;
  for (;;) {
    LINE_ENDING.lastIndex = lineStart;
    const ending = LINE_ENDING.exec(text);
    const lineEnd = ending ? ending.index : text.length;
    const line = text.slice(lineStart, lineEnd);
    if (open === null) {
      const run = OPENER.exec(line)?.[1];
      if (run) open = { start: lineStart, char: run.charAt(0), length: run.length };
    } else if (closes(line, open)) {
      blocks.push({ start: open.start, end: lineEnd, closed: true });
      open = null;
    }
    if (!ending) break;
    lineStart = ending.index + ending[0].length;
  }
  if (open !== null) blocks.push({ start: open.start, end: text.length, closed: false });
  return blocks;
}
