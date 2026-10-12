// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Purpose: serialize a `details` MDAST node back to HTML — the mdast→markdown
 * direction of `detailsBlock`.
 *
 * Split from the parser when the file crossed 300 lines. Parsing HTML into a
 * node and writing a node back out are opposite directions with no shared
 * state; keeping them together meant every change to one re-read the other.
 *
 * Key decisions:
 *   - A summary is read as inline markdown, so it is WRITTEN as inline
 *     markdown: when the node carries its summary as nodes
 *     (`summaryChildren`, set for a block that comes from the editor) they
 *     are serialized like any other inline content — marks, escapes and all.
 *     Writing only the summary's text turned `**bold**` into `bold`.
 *   - Inside the summary a `<` in TEXT is written `&lt;`, so authored text
 *     can never close the tag early or become markup (serializerText.ts does
 *     this while the `detailsSummary` construct is open). Nothing else is
 *     HTML-escaped: the reader decodes a character reference once, so one
 *     written for a quote or an ampersand that did not need it would be a
 *     rewrite of the author's text.
 *   - A node with only a `summary` string — a tree that did not come from the
 *     editor — is written with that string HTML-escaped, as before.
 *
 * @coordinates-with detailsBlock.ts — registers this as a toMarkdown extension
 * @coordinates-with ../pmDetailsConverter.ts — supplies `summaryChildren`
 * @coordinates-with ../serializerText.ts — escapes `<` in summary text
 * @module utils/markdownPipeline/plugins/detailsSerializer
 */
import type { Details } from "../types";

/** The construct open while a summary's inline content is being written. */
export const DETAILS_SUMMARY_CONSTRUCT = "detailsSummary";

/** State handed to a toMarkdown handler. */
export interface DetailsHandlerState {
  enter: (type: string) => () => void;
  containerFlow: (node: unknown, info: unknown) => string;
  containerPhrasing: (node: unknown, info: { before: string; after: string }) => string;
  createTracker: (info: unknown) => {
    move: (value: string) => string;
    current: () => { before: string; after: string };
  };
}

/** The summary's source: its inline nodes when it has them, else its text. */
function summarySource(node: Details, state: DetailsHandlerState): string {
  const children = node.summaryChildren;
  if (!children || children.length === 0) return escapeHtml(node.summary ?? "Details");

  const exit = state.enter(DETAILS_SUMMARY_CONSTRUCT);
  // `phrasing` is what the text-escaping rules are scoped to.
  const exitPhrasing = state.enter("phrasing");
  const source = state.containerPhrasing(
    { type: "paragraph", children },
    { before: ">", after: "<" },
  );
  exitPhrasing();
  exit();
  return source;
}

export function detailsHandler(
  node: Details,
  _parent: unknown,
  state: DetailsHandlerState,
  info: { before: string; after: string }
): string {
  const exit = state.enter("details");
  const tracker = state.createTracker(info);
  const openAttr = node.open ? " open" : "";

  let value = tracker.move(`<details${openAttr}>`);
  value += tracker.move("\n");
  value += tracker.move(`<summary>${summarySource(node, state)}</summary>`);
  value += tracker.move("\n\n");

  const content = state.containerFlow(node, tracker.current()).trimEnd();
  value += tracker.move(content);
  value += tracker.move("\n");
  value += tracker.move("</details>");

  exit();
  return value;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
