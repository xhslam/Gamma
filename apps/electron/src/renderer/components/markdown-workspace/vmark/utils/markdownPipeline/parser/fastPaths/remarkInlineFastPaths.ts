// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Purpose: register micromark fast paths that make three classes of hostile
 * inline markdown parse in linear time, without changing what any document
 * parses to (#1407).
 *
 * | Fast path | Stock cost it removes |
 * |---|---|
 * | `inertLabelEnd` at `]` | a walk to the paragraph start per `]` that nothing can close |
 * | `inertCodeTextSequence` at a backtick | a scan to the paragraph end per unclosable run |
 * | `attentionWithoutFutileWalks` at `*`/`_` | a walk to the paragraph start per closer with no opener |
 *
 * Each one acts only on a PROOF that micromark's own construct would fail, and
 * otherwise defers to it, so the tree is identical — the equivalence tests diff
 * the mdast, positions included, against a parser without this plugin. The
 * fast paths take the characters micromark would have left as plain data, and
 * nothing else.
 *
 * Why this lives in VMark rather than being waited for upstream: the costs are
 * inside micromark (latest versions at the time of writing), and a document
 * that takes minutes to open is a frozen editor now. The pathological soak had
 * never reached these classes before — an earlier stack overflow ended the run
 * first — so they were never measured, not recently introduced.
 *
 * @coordinates-with labelEndFastPath.ts
 * @coordinates-with codeTextFastPath.ts
 * @coordinates-with attentionFastPath.ts
 * @coordinates-with ../../dialectDescriptors.ts — registers this in every mode
 * @module utils/markdownPipeline/parser/fastPaths/remarkInlineFastPaths
 */
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { attentionWithoutFutileWalks, STOCK_ATTENTION } from "./attentionFastPath";
import { inertCodeTextSequence } from "./codeTextFastPath";
import { inertLabelEnd } from "./labelEndFastPath";
import type { SyntaxExtension } from "./micromarkTypes";

/** The micromark syntax extension this plugin registers. */
const inlineFastPathsExtension: SyntaxExtension = {
  text: {
    42: [attentionWithoutFutileWalks],
    93: [inertLabelEnd],
    95: [attentionWithoutFutileWalks],
    96: [inertCodeTextSequence],
  },
  disable: { null: [STOCK_ATTENTION] },
};

export const remarkInlineFastPaths: Plugin<[], Root> = function remarkInlineFastPaths() {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push(inlineFastPathsExtension);
};
