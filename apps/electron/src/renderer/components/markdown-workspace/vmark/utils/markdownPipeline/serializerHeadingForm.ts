// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * A heading whose only line endings are inside inline code or math — those
 * flattened before serializing.
 *
 * Purpose: upstream chooses a heading's form from the tree: setext when any
 * node inside it holds a line ending, ATX otherwise. The inline code and
 * inline math handlers then write a line ending as a space wherever the next
 * character could start a block, so such a heading came out in setext form
 * with its content on one line; read back, the content held no line ending,
 * and the next save wrote it ATX. One heading, two spellings on consecutive
 * saves.
 *
 * Key decisions:
 *   - Done on the TREE, before stringifying: the form is chosen from the tree.
 *   - A line ending inside a code span renders as a space (CommonMark §6.1),
 *     and TeX reads one as whitespace, so writing it as a space changes no
 *     rendered heading.
 *   - Only when nothing else in the heading needs a second line: a text or
 *     HTML node with a line ending, or a hard break, is written as a line
 *     ending, and the heading stays setext with its spans untouched.
 *   - Only setext-eligible headings (depth 1 and 2); deeper ones are ATX
 *     whatever they hold.
 *   - The tree handed in is not changed.
 *
 * @coordinates-with serializer.ts — runs this before stringifying
 * @coordinates-with serializerBlockFinalBreak.ts — the other pass that settles a heading's form
 * @module utils/markdownPipeline/serializerHeadingForm
 */

/** A tree node as far as this pass looks at one. */
interface TreeNode {
  type: string;
  depth?: number;
  value?: string;
  children?: readonly TreeNode[];
}

const LINE_ENDINGS = /\r\n|\r|\n/g;
const hasLineEnding = (value: string | undefined): boolean => value !== undefined && /[\r\n]/.test(value);

/** Inline nodes whose line endings the output writes as spaces. */
const SPANS: ReadonlySet<string> = new Set(["inlineCode", "inlineMath"]);

/** Whether a node other than a span forces a second line. */
function needsSecondLine(node: TreeNode): boolean {
  if (node.type === "break") return true;
  if (!SPANS.has(node.type) && hasLineEnding(node.value)) return true;
  return (node.children ?? []).some(needsSecondLine);
}

/** Whether a span below `node` holds a line ending. */
function spanHasLineEnding(node: TreeNode): boolean {
  if (SPANS.has(node.type)) return hasLineEnding(node.value);
  return (node.children ?? []).some(spanHasLineEnding);
}

/** `node` with the line endings in its spans written as spaces. */
function flattenSpans<T extends TreeNode>(node: T): T {
  if (SPANS.has(node.type) && node.value !== undefined) {
    return { ...node, value: node.value.replace(LINE_ENDINGS, " ") };
  }
  const children = node.children;
  return children ? { ...node, children: children.map(flattenSpans) } : node;
}

/**
 * `node` with every depth-1/2 heading whose only line endings are inside
 * inline code or math flattened, so it is written ATX. Returns `node` itself
 * when nothing changes.
 */
export function flattenHeadingSpanLineEndings<T extends TreeNode>(node: T): T {
  if (node.type === "heading") {
    const setextEligible = (node.depth ?? 1) < 3;
    if (!setextEligible || needsSecondLine(node) || !spanHasLineEnding(node)) return node;
    return flattenSpans(node);
  }
  const children = node.children;
  if (!children) return node;
  let changed: TreeNode[] | undefined;
  for (let index = 0; index < children.length; index += 1) {
    const replacement = flattenHeadingSpanLineEndings(children[index]!);
    if (replacement !== children[index]) {
      changed ??= children.slice();
      changed[index] = replacement;
    }
  }
  return changed ? { ...node, children: changed } : node;
}
