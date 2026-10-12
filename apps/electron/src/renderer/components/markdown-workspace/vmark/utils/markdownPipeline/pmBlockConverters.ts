// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * ProseMirror Block Node Converters (PM → MDAST)
 *
 * Purpose: Converts block-level ProseMirror nodes (including media and embeds)
 * to MDAST nodes for serialization. Split from proseMirrorToMdast.ts for size.
 *
 * Key decisions:
 *   - Alert blocks are serialized as blockquotes with `[!TYPE]` markers
 *     (GitHub-flavored markdown alert syntax)
 *   - Math blocks use the MATH_BLOCK_LANGUAGE sentinel to distinguish
 *     from regular code blocks (must match mdastBlockConverters.ts)
 *   - Table cell alignment is extracted from header row attrs
 *   - Block images are wrapped in a paragraph (markdown has no standalone image block)
 *   - Block video/audio nodes serialize to image syntax (![](url)) for clean
 *     round-trips, falling back to multi-line HTML when attributes can't be
 *     expressed in image syntax (poster, controls=false, non-default preload)
 *   - Video embed nodes serialize to provider-specific <iframe> HTML
 *   - TOC nodes serialize to `toc` MDAST type (remarkTocBlock handles markdown output)
 *   - A list item is written spread when it holds more than one non-list block,
 *     or a block after a nested list: written tight, that block would join the
 *     nested list's last item on re-parse
 *   - A list item's `tightBefore` attribute travels as `data.tightBefore`, where
 *     listItemGapJoin.ts reads it
 *
 * @coordinates-with mdastBlockConverters.ts — reverse direction (MDAST → PM)
 * @coordinates-with pmInlineConverters.ts — handles inline content within blocks
 * @coordinates-with proseMirrorToMdast.ts — orchestrates the conversion
 * @module utils/markdownPipeline/pmBlockConverters
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type {
  Content,
  BlockContent,
  Blockquote,
  Code,
  Definition,
  Heading,
  Html,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Table,
  TableCell,
  TableRow,
  ThematicBreak,
} from "mdast";
import type { Math } from "mdast-util-math";
import type { Toc, Yaml } from "./types";
export type PmToMdastNode = Content | ListItem;

export interface PmToMdastContext {
  convertNode: (node: PMNode) => PmToMdastNode | PmToMdastNode[] | null;
  convertInlineContent: (node: PMNode) => PhrasingContent[];
}

export function convertParagraph(context: PmToMdastContext, node: PMNode): Paragraph {
  const children = context.convertInlineContent(node);
  return { type: "paragraph", children };
}

export function convertHeading(context: PmToMdastContext, node: PMNode): Heading {
  const level = (node.attrs.level ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
  const children = context.convertInlineContent(node);
  return { type: "heading", depth: level, children };
}

/**
 * Internal sentinel value for math blocks stored as codeBlock.
 * Must match the value in mdastBlockConverters.ts.
 */
const MATH_BLOCK_LANGUAGE = "$$math$$";

export function convertCodeBlock(node: PMNode): Code | Math {
  const lang = (node.attrs.language as string | null) ?? null;
  // Check for sentinel value that identifies math blocks
  if (lang === MATH_BLOCK_LANGUAGE) {
    return {
      type: "math",
      value: node.textContent,
    };
  }

  const meta = (node.attrs.meta as string | null | undefined) ?? null;
  return {
    type: "code",
    lang: lang || undefined,
    // A fence cannot carry meta without a language to precede it.
    ...(lang && meta ? { meta } : {}),
    value: node.textContent,
  };
}

export function convertBlockquote(context: PmToMdastContext, node: PMNode): Blockquote {
  const children: BlockContent[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  });
  return { type: "blockquote", children };
}

export function convertAlertBlock(context: PmToMdastContext, node: PMNode): Blockquote {
  const alertType = String(node.attrs.alertType ?? "NOTE").toUpperCase();
  const children: BlockContent[] = [
    { type: "paragraph", children: [{ type: "text", value: `[!${alertType}]` }] },
  ];

  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  });

  return { type: "blockquote", children };
}

export function convertList(context: PmToMdastContext, node: PMNode, ordered: boolean): List {
  const children: ListItem[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted && !Array.isArray(converted) && converted.type === "listItem") {
      children.push(converted as ListItem);
    }
  });

  // Loose when the list was loose (where the schema records it) or any item
  // holds more than one block.
  const spread = node.attrs.spread === true || children.some((item) => item.spread === true);
  const list: List = {
    type: "list",
    ordered,
    spread,
    children,
  };

  if (ordered) {
    list.start = (node.attrs.start as number) ?? 1;
  }

  return list;
}

export function convertListItem(context: PmToMdastContext, node: PMNode): ListItem {
  const children: BlockContent[] = [];
  node.forEach((child) => {
    const converted = context.convertNode(child);
    if (converted) {
      if (Array.isArray(converted)) {
        children.push(...(converted as BlockContent[]));
      } else {
        children.push(converted as BlockContent);
      }
    }
  });

  // Guard: remark-stringify corrupts output (e.g., produces "##") when a
  // listItem has zero children. Fall back to an empty paragraph.
  const safeChildren: BlockContent[] =
    children.length > 0 ? children : [{ type: "paragraph", children: [] }];

  // Spread: true if the item has multiple non-list block children (e.g.,
  // multi-paragraph items), or a block AFTER a nested list — written tight, a
  // paragraph there is a lazy continuation of the nested list's last item.
  // Single paragraph + nested list = tight.
  const nonListChildren = safeChildren.filter((c) => c.type !== "list");
  const blockAfterList = safeChildren.some(
    (child, index) => index > 0 && child.type !== "list" && safeChildren[index - 1]!.type === "list",
  );
  const listItem: ListItem = {
    type: "listItem",
    spread: node.attrs.spread === true || nonListChildren.length > 1 || blockAfterList,
    children: safeChildren,
  };
  const checked = node.attrs.checked;
  if (checked === true || checked === false) {
    listItem.checked = checked;
  }
  if (node.attrs.tightBefore === true) {
    listItem.data = { tightBefore: true };
  }

  return listItem;
}

export function convertHorizontalRule(): ThematicBreak {
  return { type: "thematicBreak" };
}

export function convertTable(context: PmToMdastContext, node: PMNode): Table {
  const rows: TableRow[] = [];
  let align: Array<"left" | "center" | "right" | null> = [];

  node.forEach((row, rowIndex) => {
    if (row.type.name !== "tableRow") return;
    const cells: TableCell[] = [];

    row.forEach((cell, cellIndex) => {
      const children = convertTableCellContent(context, cell);
      cells.push({ type: "tableCell", children });

      if (rowIndex === 0) {
        const alignment = normalizeAlignment(cell.attrs.alignment);
        /* v8 ignore start -- align grows monotonically with cellIndex; else branch structurally unreachable */
        if (align.length <= cellIndex) {
          align = [...align, alignment];
        } else {
          align[cellIndex] = alignment;
        }
        /* v8 ignore stop */
      }
    });

    rows.push({ type: "tableRow", children: cells });
  });

  return { type: "table", align, children: rows };
}

function convertTableCellContent(context: PmToMdastContext, node: PMNode): PhrasingContent[] {
  const children: PhrasingContent[] = [];

  node.forEach((child) => {
    if (child.type.name === "paragraph") {
      if (children.length > 0) {
        children.push({ type: "break" });
      }
      children.push(...context.convertInlineContent(child));
    }
  });

  return children;
}

// Media serialization (block image/video/audio, video embeds) lives in
// pmMediaConverters.ts; re-exported here so the registry keeps one import hub.
export {
  convertBlockImage,
  convertBlockVideo,
  convertBlockAudio,
  convertVideoEmbed,
} from "./pmMediaConverters";

export function convertFrontmatter(node: PMNode): Yaml {
  return { type: "yaml", value: String(node.attrs.value ?? "") };
}

export function convertDefinition(node: PMNode): Definition {
  return {
    type: "definition",
    identifier: String(node.attrs.identifier ?? ""),
    label: node.attrs.label ? String(node.attrs.label) : undefined,
    url: String(node.attrs.url ?? ""),
    title: node.attrs.title ? String(node.attrs.title) : undefined,
  };
}

export function convertHtmlBlock(node: PMNode): Html {
  return { type: "html", value: String(node.attrs.value ?? "") };
}

export function convertToc(): Toc {
  return { type: "toc" };
}

function normalizeAlignment(value: unknown): "left" | "center" | "right" | null {
  if (value === "left" || value === "center" || value === "right") return value;
  return null;
}
