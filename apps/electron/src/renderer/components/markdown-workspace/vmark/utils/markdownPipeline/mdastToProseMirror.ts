// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * MDAST to ProseMirror Conversion — Orchestrator
 *
 * Purpose: Converts a complete MDAST tree to a ProseMirror document by resolving
 * each node through registry 2.
 *
 * Pipeline: MDAST root → MdastToPMConverter.convertRoot() → PM doc node
 *
 * Key decisions:
 *   - Node dispatch lives in registry 2 (mdastConverters.registry.ts), NOT in a
 *     switch here (ADR-015 D2). The 34-arm switch was deleted in Phase 2.
 *   - Attribute-level competition (a `paragraph` becoming block_image /
 *     block_video / block_audio, an `html` becoming any of four things) is NOT
 *     in the dispatch — it lives inside convertParagraph and convertHtml in
 *     mdastMediaConverters.ts. That is where the claim protocol
 *     (lib/extensions/claim.ts) applies, not here.
 *   - Uses a class (MdastToPMConverter) to hold per-document state like usedSlugs
 *     for heading ID uniqueness, but converter functions are pure/stateless
 *   - Inline HTML pairs like `<kbd>...</kbd>` are merged into a single
 *     html_inline node where the merged source reads back as the same content
 *     (inlineHtmlMerge.ts)
 *   - Schema is passed in (not imported) to keep this layer framework-free
 *
 * @coordinates-with mdastConverters.registry.ts — registry 2, which owns dispatch
 * @coordinates-with mdastBlockConverters.ts — block node conversion functions
 * @coordinates-with mdastInlineConverters.ts — inline node conversion functions
 * @coordinates-with proseMirrorToMdast.ts — reverse direction
 * @coordinates-with inlineHtmlMerge.ts — merges inline HTML pairs
 * @module utils/markdownPipeline/mdastToProseMirror
 */

import type { Schema, Node as PMNode, Mark } from "@tiptap/pm/model";
import type { Root, Content } from "mdast";
import { perfStart, perfEnd } from "../perfLog";
import {
  type ContentContext,
  type MdastToPmContext,
} from "./mdastBlockConverters";
import { generateSlug, makeUniqueSlug } from "../headingSlug";
import { mdPipelineWarn } from "../debug";
import {
  createMdastRegistry,
  tryMdastRegistry,
  type MdastRegistry,
} from "./mdastConverters.registry";
import { convertTopLevelWithBlankLines } from "./blankLineCapture";
import { mergeInlineHtmlTags } from "./inlineHtmlMerge";

/**
 * Convert MDAST root to ProseMirror document.
 *
 * @param schema - The ProseMirror schema to use for creating nodes
 * @param mdast - The MDAST root node
 * @returns A ProseMirror document node
 *
 * @example
 * const mdast = parseMarkdownToMdast("# Hello");
 * const doc = mdastToProseMirror(schema, mdast);
 */
export function mdastToProseMirror(schema: Schema, mdast: Root): PMNode {
  const converter = new MdastToPMConverter(schema);
  return converter.convertRoot(mdast);
}

/**
 * Internal converter class that maintains schema context.
 */
class MdastToPMConverter {
  private context: MdastToPmContext;
  private usedSlugs = new Set<string>();

  /** Registry 2, mdast → PM direction (ADR-015 D2). Owns all node dispatch. */
  private readonly registry: MdastRegistry = createMdastRegistry();

  constructor(private schema: Schema) {
    this.context = {
      schema,
      convertChildren: this.convertChildren.bind(this),
      generateHeadingId: this.generateHeadingId.bind(this),
    };
  }

  /**
   * Generate a unique heading ID from text.
   * Tracks used slugs to ensure uniqueness within the document.
   */
  private generateHeadingId(text: string): string | null {
    const baseSlug = generateSlug(text);
    if (!baseSlug) return null;
    const uniqueSlug = makeUniqueSlug(baseSlug, this.usedSlugs);
    this.usedSlugs.add(uniqueSlug);
    return uniqueSlug;
  }

  /** Convert root to a PM doc; top-level conversion also captures inter-block
   *  blank-line runs into blankLinesBefore (see blankLineCapture.ts). */
  convertRoot(root: Root): PMNode {
    perfStart("convertRoot:convertChildren");
    const topChildren = convertTopLevelWithBlankLines(root, (c) => this.convertNode(c, [], "block"));
    perfEnd("convertRoot:convertChildren", { childCount: topChildren.length });

    perfStart("convertRoot:createDoc");
    const doc = this.schema.topNodeType.create(null, topChildren);
    perfEnd("convertRoot:createDoc", { docSize: doc.content.size });
    return doc;
  }

  /**
   * Convert array of MDAST children to ProseMirror nodes.
   * Accepts Content[] or PhrasingContent[] (inline content).
   */
  convertChildren(
    children: readonly Content[],
    marks: Mark[],
    context: ContentContext
  ): PMNode[] {
    const result: PMNode[] = [];
    const normalizedChildren = context === "inline" ? mergeInlineHtmlTags(children) : children;
    for (const child of normalizedChildren) {
      const converted = this.convertNode(child, marks, context);
      if (converted) {
        if (Array.isArray(converted)) {
          result.push(...converted);
        } else {
          result.push(converted);
        }
      }
    }
    return result;
  }

  /**
   * Convert a single MDAST node to ProseMirror node(s).
   */
  private convertNode(
    node: Content,
    marks: Mark[],
    context: "block" | "inline"
  ): PMNode | PMNode[] | null {
    // Use type assertion for node.type to handle custom types not in base Content union
    const nodeType = node.type as string;
    const convertInlineChildren = (children: readonly Content[], nextMarks: Mark[]) =>
      this.convertChildren(children, nextMarks, "inline");

    const viaRegistry = tryMdastRegistry(this.registry, {
      node,
      marks,
      position: context,
      schema: this.schema,
      ctx: this.context,
      convertInlineChildren,
    });
    if (viaRegistry.handled) return viaRegistry.result;

    mdPipelineWarn(`[MdastToPM] Unknown node type: ${nodeType}`);
    return null;
  }
}
