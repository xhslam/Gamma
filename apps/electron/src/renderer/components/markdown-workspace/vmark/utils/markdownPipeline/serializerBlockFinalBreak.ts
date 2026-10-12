// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * A hard break at the end of its block — dropped before serializing.
 *
 * Purpose: markdown cannot write a hard break as the last thing in a
 * paragraph, heading or table cell. A backslash there is a literal backslash,
 * so the text gained one on reload; two trailing spaces are simply dropped;
 * and a heading that contains a break is written in setext form, whose
 * underline is as long as the heading's last line — which, after a final
 * break, is empty, so the heading came back as a paragraph.
 *
 * The editor can hold such a break (Shift+Enter at the end of a block). It
 * shows as nothing once the block ends, and CommonMark reads none there, so
 * the faithful output is the block without it.
 *
 * Key decisions:
 *   - Done on the TREE, before stringifying, not in the `break` handler:
 *     upstream chooses a heading's form by whether the node holds a break, so
 *     the break has to be gone before that choice is made.
 *   - Only the trailing run of breaks goes, and only where the parent is the
 *     block itself. A break that ends an emphasis run in the middle of a
 *     paragraph is not at the end of anything.
 *   - The tree handed in is not changed.
 *
 * @coordinates-with serializer.ts — runs this before stringifying
 * @coordinates-with serializerBreak.ts — writes the breaks that remain
 * @module utils/markdownPipeline/serializerBlockFinalBreak
 */

/** A tree node as far as this pass looks at one. */
interface TreeNode {
  type: string;
  children?: readonly TreeNode[];
}

/** Blocks whose children are inline content. */
const INLINE_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading", "tableCell"]);

/**
 * `node` without the hard breaks that end a paragraph, heading or table cell
 * anywhere below it. Returns `node` itself when nothing changes.
 */
export function dropBlockFinalBreaks<T extends TreeNode>(node: T): T {
  const children = node.children;
  if (!children) return node;

  if (INLINE_BLOCKS.has(node.type)) {
    let end = children.length;
    while (end > 0 && children[end - 1]!.type === "break") end -= 1;
    return end === children.length ? node : { ...node, children: children.slice(0, end) };
  }

  let changed: TreeNode[] | undefined;
  for (let index = 0; index < children.length; index += 1) {
    const replacement = dropBlockFinalBreaks(children[index]!);
    if (replacement !== children[index]) {
      changed ??= children.slice();
      changed[index] = replacement;
    }
  }
  return changed ? { ...node, children: changed } : node;
}
