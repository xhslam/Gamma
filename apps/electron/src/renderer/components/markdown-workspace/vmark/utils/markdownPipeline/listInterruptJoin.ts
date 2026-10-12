// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Blank line before a list that cannot interrupt a paragraph.
 *
 * Purpose: an mdast-util-to-markdown `join` that keeps a list from being read
 * back as the text of the paragraph above it.
 *
 * CommonMark §5.2: a list whose first item would start on a paragraph
 * continuation line may interrupt that paragraph only if the item does not
 * start with a blank line and, when ordered, starts at 1. Upstream joins the
 * children of a tight list item with no blank line, so a nested empty item
 * (`1. **b**\n   1.`) or a `3.` start became paragraph text on reparse — the
 * soak's editing fuzz lost an empty nested ordered item that way (#1407,
 * seed 3). Bullets obey the same rule: micromark tolerates `- b\n  -`, but a
 * CommonMark parser reads the `-` as a setext underline.
 *
 * Key decisions:
 *   - Narrow by construction: the join says nothing unless the pair would
 *     break, so every list that can interrupt keeps its tight spelling.
 *   - An EMPTY paragraph writes no text and has nothing to interrupt.
 *   - A captured blank-line run (blankLinesJoin, ADR-1a) is honoured when it is
 *     at least one line; a captured 0 is raised to the 1 the list needs.
 *
 * @coordinates-with serializer.ts — registers this join after blankLinesJoin,
 *   so it is consulted first
 * @coordinates-with serializerHandlers.ts — blankLinesJoin, whose count it keeps
 * @module utils/markdownPipeline/listInterruptJoin
 */
import type { List, Nodes } from "mdast";
import { blankLinesJoin } from "./serializerHandlers";

/** Whether a list item's first line is blank: no content, or an empty paragraph. */
function startsWithBlankLine(item: Nodes | undefined): boolean {
  if (!item || item.type !== "listItem") return false;
  const first = item.children[0];
  return first === undefined || (first.type === "paragraph" && first.children.length === 0);
}

/** Whether CommonMark forbids `list` from interrupting a paragraph. */
function cannotInterruptParagraph(list: List): boolean {
  if (list.ordered && (list.start ?? 1) !== 1) return true;
  return startsWithBlankLine(list.children[0]);
}

/**
 * Join: at least one blank line between a non-empty paragraph and a list that
 * could not interrupt it; `undefined` (defer to the other joins) otherwise.
 */
export function listInterruptJoin(left: Nodes, right: Nodes): number | undefined {
  if (left.type !== "paragraph" || left.children.length === 0) return undefined;
  if (right.type !== "list" || !cannotInterruptParagraph(right)) return undefined;
  const captured = blankLinesJoin(left, right);
  return captured !== undefined && captured >= 1 ? captured : 1;
}
