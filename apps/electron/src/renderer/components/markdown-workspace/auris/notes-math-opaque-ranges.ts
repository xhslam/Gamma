// 移植自 Auris 1.0.17 @ 5d972ccd；兼容定界符和渲染副本归一化，原始草稿不在展示时改写。
/**
 * Markdown-authoritative opaque ranges, adapted from VMark mathProbe.ts.
 * Upstream: fa785a7008999bc2077889a9faaca0175f122cee (ISC).
 * License: docs/vmark-port/UPSTREAM-LICENSE.txt.
 * Auris uses its existing fast paths/GFM dialect and a math-disabled probe;
 * existing dollar math must remain available to compatibility repair.
 */
import type { Node, Parent, Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { remarkInlineFastPaths } from "../vmark/utils/markdownPipeline/parser/fastPaths/remarkInlineFastPaths";

const probe = unified().use(remarkParse).use(remarkInlineFastPaths)
  .use(remarkFrontmatter, ["yaml"]).use(remarkGfm).freeze();
function probeParseWithoutMath(text: string): Root {
  return probe.parse(text) as Root;
}

interface Positioned {
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function spanOf(node: Node): [number, number] | null {
  const pos = (node as Positioned).position;
  const start = pos?.start.offset;
  const end = pos?.end.offset;
  return typeof start === "number" && typeof end === "number"
    ? [start, end]
    : null;
}

function visit(node: Node, fn: (node: Node) => void): void {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    fn(current);
    const children = (current as Parent).children;
    if (Array.isArray(children)) stack.push(...children);
  }
}

/** Node types whose entire span is opaque to source rewrites.
 *  Existing math nodes are deliberately NOT opaque: a `\[ … \]` span
 *  whose content merely LOOKS like `$$` math would otherwise be
 *  half-claimed by the probe and never convert. Literal `\(`/`\[`
 *  inside real dollar-math is invalid LaTeX to begin with, and the
 *  escape-parity rule still protects `\\[4pt]` row spacing. */
const OPAQUE_TYPES = new Set([
  "code",
  "inlineCode",
  "html",
  "yaml",
  "definition",
]);

/** Link-ish parents whose destination tail (after the label) is opaque. */
const LINKISH_TYPES = new Set(["link", "image", "linkReference", "imageReference"]);

/**
 * Per-offset mask (UTF-16 indexing, same as String) of regions the
 * math source guards must not rewrite, derived from the probe parse
 * rather than regex approximations.
 */
export function buildProbeOpaqueMask(
  text: string,
  tree: Root = probeParseWithoutMath(text),
): Uint8Array {
  const mask = new Uint8Array(text.length);
  const cover = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(text.length, to); i++) {
      mask[i] = 1;
    }
  };

  visit(tree, (node) => {
    const span = spanOf(node);
    if (!span) return;
    if (OPAQUE_TYPES.has(node.type)) {
      cover(span[0], span[1]);
      return;
    }
    if (LINKISH_TYPES.has(node.type)) {
      // An authored `[label](dest)` link: the label may contain
      // convertible math; the tail (destination, title, reference) may
      // not — mask from the last child's end. But an AUTOLINK's child
      // span IS the URL (`https://…` or `<https://…>`), so tail-only
      // masking leaves the URL exposed. Geometric discriminator: an
      // authored link carries ≥4 syntax chars outside its children
      // (`[](…)`), an autolink at most 2 (the angle brackets) — mask
      // the whole node when the overhead is that small.
      const children = (node as Parent).children;
      const lastChild = Array.isArray(children)
        ? children[children.length - 1]
        : undefined;
      const lastSpan = lastChild ? spanOf(lastChild) : null;
      const firstSpan =
        Array.isArray(children) && children[0] ? spanOf(children[0]) : null;
      const overhead =
        firstSpan && lastSpan
          ? firstSpan[0] - span[0] + (span[1] - lastSpan[1])
          : Number.POSITIVE_INFINITY;
      // Only `link` nodes can be autolinks. Reference labels are
      // authored prose and stay convertible for FULL references only
      // (`[label][id]` — the separate id does the matching). SHORTCUT
      // (`[label]`) and COLLAPSED (`[label][]`) references use the
      // label itself as the identifier: converting it would break the
      // match to the definition, so mask those nodes whole.
      const refType = (node as { referenceType?: string }).referenceType;
      const labelIsId = refType === "shortcut" || refType === "collapsed";
      if ((node.type === "link" && overhead <= 2) || labelIsId) {
        cover(span[0], span[1]);
        return;
      }
      cover(lastSpan ? lastSpan[1] : span[0], span[1]);
    }
  });

  return mask;
}
