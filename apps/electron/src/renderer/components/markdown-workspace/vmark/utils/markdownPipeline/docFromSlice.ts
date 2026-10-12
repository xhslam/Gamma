// 移植自 xiaolai/vmark @ ca71e3e0；ISC 许可见本移植目录根 LICENSE。
/**
 * A ProseMirror slice as a document, and as markdown.
 *
 * Purpose: the one way a SELECTION is turned into markdown. Copy-as-markdown
 * (plugins/markdownCopy) and Source Peek (services/editor/sourcePeek) both
 * need it, and each kept its own copy of these helpers. The copies drifted:
 * the copy path stopped passing the document's hard-break style and then
 * post-processed the result in ways that changed its meaning.
 *
 * Key decisions:
 *   - Pure, and settings arrive as arguments. Plugins may not reach the
 *     app's services or stores, and utilities may not either, so the caller
 *     resolves the options and passes them in.
 *   - The output is the serializer's output, unchanged. Everything it
 *     escapes, it escapes because the text would read back as something else
 *     without it; anything it could safely leave unescaped it already has
 *     (serializerCosmetics.ts). A caller that strips more changes what is
 *     pasted.
 *
 * @coordinates-with adapter.ts — serializeMarkdown
 * @coordinates-with plugins/markdownCopy/tiptap.ts — copy as markdown
 * @coordinates-with services/editor/sourcePeek.ts — Source Peek
 * @module utils/markdownPipeline/docFromSlice
 */

import { Fragment, type Node as PMNode, type NodeType, type Schema, type Slice } from "@tiptap/pm/model";
import { serializeMarkdown } from "./adapter";
import type { MarkdownPipelineOptions } from "./types";

/**
 * `content` with at least one block: empty content becomes one empty
 * paragraph, and inline content is wrapped in a paragraph.
 */
export function ensureBlockContent(content: Fragment, paragraphType: NodeType | undefined): Fragment {
  if (content.childCount === 0 && paragraphType) {
    return Fragment.from(paragraphType.create());
  }
  const firstChild = content.firstChild;
  if (firstChild && !firstChild.isBlock && paragraphType) {
    return Fragment.from(paragraphType.create(null, content));
  }
  return content;
}

/**
 * A document holding `slice`'s content.
 *
 * Built with `create`, which does not check the content against the schema:
 * a selection is serialized as far as the converters understand it, rather
 * than refused. (Both former copies wrapped this in a try/catch with a
 * fallback document; `create` has no content check to fail, so the fallback
 * could never run.)
 */
export function createDocFromSlice(schema: Schema, slice: Slice): PMNode {
  return schema.topNodeType.create(null, ensureBlockContent(slice.content, schema.nodes.paragraph));
}

/** `slice` as markdown, with the given serializer options. */
export function serializeSlice(
  schema: Schema,
  slice: Slice,
  options: MarkdownPipelineOptions = {},
): string {
  return serializeMarkdown(schema, createDocFromSlice(schema, slice), options);
}
