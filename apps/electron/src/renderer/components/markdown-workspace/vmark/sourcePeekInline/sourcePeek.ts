// 移植自 xiaolai/vmark @ ca71e3e0；ISC 许可见本移植目录根 LICENSE。
/**
 * Source Peek — Markdown ↔ PM Content Bridge
 *
 * Purpose: Provides the content conversion layer for "source peek" — the inline
 * markdown editing overlay that appears in WYSIWYG mode for code blocks, math, etc.
 *
 * Key decisions:
 *   - Converts PM selection to markdown for source peek display, and parses
 *     edited markdown back to PM content for replacement
 *   - A range is serialized by `serializeSlice`, the same function copy as
 *     markdown uses, so the two cannot drift apart again
 *   - ensureBlockContent wraps inline fragments in paragraphs to satisfy
 *     PM schema constraints (doc requires block children)
 *   - Uses ReplaceStep for surgical content replacement to preserve undo history
 *
 * @coordinates-with sourcePeekStore.ts — stores peek state (range, content)
 * @coordinates-with sourcePeekInline/tiptap.ts — renders the inline peek editor
 * @coordinates-with markdownPipeline/ — markdown ↔ PM conversion
 * @coordinates-with markdownPipeline/docFromSlice.ts — serializeSlice, ensureBlockContent
 * @module services/editor/sourcePeek
 */

import { NodeSelection, Selection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Slice, type Schema } from "@tiptap/pm/model";
import { parseMarkdown } from "../utils/markdownPipeline/adapter";
import { ensureBlockContent, serializeSlice } from "../utils/markdownPipeline/docFromSlice";
import { sourcePeekError } from "../utils/debug";
import type { MarkdownPipelineOptions } from "../utils/markdownPipeline/types";
export interface SourcePeekRange { from: number; to: number }

/**
 * Block types that should be edited as a complete unit.
 * When cursor is inside one of these, expand to include the entire block.
 */
const COMPOUND_BLOCK_TYPES = new Set([
  "table",
  "bulletList",
  "orderedList",
  "blockquote",
  "detailsBlock",
  "taskList",
]);

/**
 * Get expanded range for Source Peek that includes compound blocks.
 * When cursor is inside a table, list, blockquote, etc., returns the
 * entire structure rather than just the immediate block.
 *
 * @returns Range expanded to include compound block ancestors
 */
export function getExpandedSourcePeekRange(state: EditorState): SourcePeekRange {
  const { selection } = state;
  const { $from, $to } = selection;

  // For node selections, use the node directly
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return { from: selection.from, to: selection.to };
  }

  // Find the topmost compound block ancestor that should be edited as a unit
  let targetDepth = 1;

  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (COMPOUND_BLOCK_TYPES.has(node.type.name)) {
      targetDepth = d;
      break; // Stop at first compound block (outermost)
    }
  }

  // Ensure we have valid depth
  if ($from.depth < targetDepth || $to.depth < targetDepth) {
    targetDepth = Math.min($from.depth, $to.depth);
  }

  if (targetDepth < 1) {
    return { from: selection.from, to: selection.to };
  }

  return {
    from: $from.before(targetDepth),
    to: $to.after(targetDepth),
  };
}

/** Serialize a ProseMirror document range to markdown for source peek editing. */
export function serializeSourcePeekRange(
  state: EditorState,
  range: SourcePeekRange,
  options: MarkdownPipelineOptions = {}
): string {
  return serializeSlice(state.schema, state.doc.slice(range.from, range.to), options);
}

/** Parse markdown into a ProseMirror Slice suitable for replacing a source peek range. */
export function createSourcePeekSlice(
  schema: Schema,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Slice {
  const parsed = parseMarkdown(schema, markdown, options);
  const content = ensureBlockContent(parsed.content, schema.nodes.paragraph);
  return new Slice(content, 0, 0);
}

/** Replace a document range with parsed markdown and update the selection. Returns false on error. */
export function applySourcePeekMarkdown(
  view: EditorView,
  range: SourcePeekRange,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): boolean {
  try {
    const slice = createSourcePeekSlice(view.state.schema, markdown, options);
    const tr = view.state.tr.replaceRange(range.from, range.to, slice);
    // Use transaction mapping to find correct cursor position after replacement
    const mappedPos = tr.mapping.map(range.from);
    const safePos = Math.min(mappedPos, tr.doc.content.size);
    tr.setSelection(Selection.near(tr.doc.resolve(safePos)));
    view.dispatch(tr.scrollIntoView());
    return true;
  } catch (error) {
    sourcePeekError("Failed to apply markdown:", error);
    return false;
  }
}
