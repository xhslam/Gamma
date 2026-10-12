// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * ProseMirror details block → MDAST details.
 *
 * Purpose: convert a `detailsBlock` node — its summary and its body — for
 * serialization. Split from pmBlockConverters.ts for size.
 *
 * Key decisions:
 *   - The summary is converted as INLINE CONTENT, marks included, and handed
 *     to the serializer as nodes (`summaryChildren`). Taking its text alone
 *     wrote `**bold**` back as `bold`.
 *   - A hard break that ends the summary is dropped: nothing can follow it
 *     before `</summary>`, and a backslash there would be read as text.
 *   - `summary` still carries the plain text, for a consumer that only wants
 *     a title.
 *
 * @coordinates-with plugins/detailsSerializer.ts — writes `summaryChildren`
 * @coordinates-with mdastContainerConverters.ts — reverse direction (MDAST → PM)
 * @module utils/markdownPipeline/pmDetailsConverter
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { BlockContent, PhrasingContent } from "mdast";
import type { Details } from "./types";
import type { PmToMdastContext } from "./pmBlockConverters";

/** `inline` without the hard breaks that end it. */
function withoutFinalBreaks(inline: PhrasingContent[]): PhrasingContent[] {
  let end = inline.length;
  while (end > 0 && inline[end - 1]!.type === "break") end -= 1;
  return end === inline.length ? inline : inline.slice(0, end);
}

export function convertDetailsBlock(context: PmToMdastContext, node: PMNode): Details {
  const firstChild = node.firstChild;
  const summaryNode = firstChild?.type.name === "detailsSummary" ? firstChild : null;
  // Start from index 1 only if first child is summary; otherwise start from 0
  const startIndex = summaryNode ? 1 : 0;

  const children: BlockContent[] = [];
  for (let i = startIndex; i < node.childCount; i += 1) {
    const converted = context.convertNode(node.child(i));
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  }

  const summaryChildren = summaryNode
    ? withoutFinalBreaks(context.convertInlineContent(summaryNode))
    : [];

  return {
    type: "details",
    open: Boolean(node.attrs.open),
    summary: summaryNode ? summaryNode.textContent : "Details",
    ...(summaryChildren.length > 0 ? { summaryChildren } : {}),
    children,
  };
}
