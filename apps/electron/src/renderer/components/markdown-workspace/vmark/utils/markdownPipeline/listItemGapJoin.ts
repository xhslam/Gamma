// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Item gaps of a loose list, written as the author wrote them.
 *
 * Purpose: an mdast-util-to-markdown `join` that writes no blank line before a
 * list item the source had directly under the previous one, inside a loose
 * list.
 *
 * CommonMark makes a whole list loose when any two of its items are separated
 * by a blank line, or any item holds two blocks with a blank line between
 * them. So `1. a\n2. b\n\n3. c` is ONE loose list, and the blank line between
 * `b` and `c` is the only one it needs. Upstream writes a loose list with a
 * blank line between every pair of items, which rewrote such a list on every
 * save. The parse marks each item the source wrote with no blank line before
 * it (`data.tightBefore`, from the `tightBefore` attribute on the list item);
 * this join honours the mark.
 *
 * Key decisions:
 *   - Looseness wins over spelling. The marks are honoured only while some
 *     other gap still gets its blank line, or some item is itself spread
 *     (its blocks are separated by blank lines). Otherwise an edit that
 *     removed the one blank-separated item would turn the list tight on the
 *     next read; the join then defers and every gap gets the blank line.
 *   - Only a literal `true` is a mark. Anything else defers to the defaults.
 *
 * @coordinates-with serializer.ts — registers this join
 * @coordinates-with mdastBlockConverters.ts — sets the attribute from the parse
 * @coordinates-with pmBlockConverters.ts — copies the attribute into `data`
 * @module utils/markdownPipeline/listItemGapJoin
 */
import type { List, ListItem, Nodes, Parents } from "mdast";

/** Whether the source had no blank line before this item. */
function isTightBefore(item: ListItem): boolean {
  return item.data?.tightBefore === true;
}

/** Whether the list reads back loose with its marked gaps written tight. */
function staysLoose(list: List): boolean {
  return list.children.some(
    (item, index) => item.spread === true || (index > 0 && !isTightBefore(item)),
  );
}

/**
 * Join: no blank line before a marked item of a loose list that stays loose
 * without it; `undefined` (defer to the other joins) otherwise.
 */
export function listItemGapJoin(left: Nodes, right: Nodes, parent: Parents): number | undefined {
  if (parent.type !== "list" || parent.spread !== true) return undefined;
  if (left.type !== "listItem" || right.type !== "listItem") return undefined;
  if (!isTightBefore(right) || !staysLoose(parent)) return undefined;
  return 0;
}
