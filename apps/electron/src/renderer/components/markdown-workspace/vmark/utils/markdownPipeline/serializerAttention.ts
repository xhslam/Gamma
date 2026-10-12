// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Attention delimiters — `*emphasis*`, `**strong**` and `~~strikethrough~~`.
 *
 * Purpose: emit every attention delimiter where VMark's parser (micromark) will
 * read it back as the same mark. One module owns all three because they share
 * one rule set: a run of `*`, `_` or `~` opens or closes depending only on the
 * characters on either side of the RUN, so a decision made for one mark is
 * wrong whenever a neighbour changes what those characters are.
 *
 * Key decisions:
 *   - Flanking is fixed the way mdast-util-to-markdown fixes it: a character
 *     beside a delimiter that stops it flanking is written as a character
 *     reference, which is punctuation to the parser and decodes back to the
 *     same text. The decision table (`encodeSides`) is upstream's `encodeInfo`.
 *   - Characters are classified exactly as micromark does (`classify`): Unicode
 *     P and S categories count as punctuation, per UTF-16 code unit. The old
 *     `delete` handler tested ASCII punctuation only, so `文字~~。word~~` came
 *     back as literal tildes.
 *   - Emphasis beside a `strong` sibling is written with `_`. Flush `*`
 *     delimiters merge into one run — `**a***b*` — whose flanking is decided by
 *     characters neither node looked at, and italic typed next to bold was lost
 *     on save (found by the #1407 soak). `_` and `*` never merge.
 *     Everywhere else emphasis stays `*`, the house style; a parent/child edge
 *     such as `***x***` is fine as it is and keeps its spelling.
 *   - A character reference always covers a whole CODE POINT. Encoding one half
 *     of a surrogate pair destroys the character.
 *
 * Why these are VMark's handlers rather than upstream's: upstream's emphasis
 * marker is one global option, and `delete` (mdast-util-gfm-strikethrough) does
 * no flanking at all. Neighbour encoding itself still happens in upstream's
 * `containerPhrasing`, driven by `attentionEncodeSurroundingInfo`, which VMark
 * patches to encode whole code points too (patches/mdast-util-to-markdown).
 *
 * @coordinates-with serializer.ts — installs these handlers
 * @coordinates-with markEdgeWhitespace.ts — moves edge whitespace out of `~~`,
 *   which cannot close after a space
 * @module utils/markdownPipeline/serializerAttention
 */

/** The slice of mdast-util-to-markdown's `State` these handlers use. */
interface AttentionState {
  enter: (construct: string) => () => void;
  createTracker: (info: AttentionInfo) => {
    move: (value: string) => string;
    /** Position bookkeeping — `{ now, lineShift }`, NOT before/after. */
    current: () => { now: { line: number; column: number }; lineShift: number };
  };
  containerPhrasing: (node: unknown, info: { before: string; after: string }) => string;
  /** Index of the child being serialized, per open container. */
  indexStack: number[];
  /** Read by `containerPhrasing` to encode the character on either side. */
  attentionEncodeSurroundingInfo?: { before: boolean; after: boolean };
}

/** The characters around the node being serialized. */
interface AttentionInfo {
  before: string;
  after: string;
}

interface PhrasingParent {
  children?: ReadonlyArray<{ type: string }>;
}

const WHITESPACE = 1;
const PUNCTUATION = 2;
type CharacterClass = typeof WHITESPACE | typeof PUNCTUATION | undefined;

/**
 * micromark's `classifyCharacter` for one UTF-16 code unit: whitespace,
 * punctuation (Unicode P or S), or anything else. NaN — an empty neighbour —
 * counts as "anything else", as upstream's does.
 */
function classify(code: number): CharacterClass {
  if (Number.isNaN(code)) return undefined;
  const char = String.fromCharCode(code);
  if (/\s/.test(char)) return WHITESPACE;
  if (/\p{P}|\p{S}/u.test(char)) return PUNCTUATION;
  return undefined;
}

/**
 * Which side of one delimiter run must be character-referenced for it to form:
 * mdast-util-to-markdown's `encodeInfo` table. `_` is stricter than `*` and `~`
 * between two letters, where it cannot form at all.
 */
function encodeSides(outside: number, inside: number, marker: string): { inside: boolean; outside: boolean } {
  const outsideClass = classify(outside);
  const insideClass = classify(inside);
  if (outsideClass === undefined) {
    if (insideClass === undefined) {
      return marker === "_" ? { inside: true, outside: true } : { inside: false, outside: false };
    }
    return { inside: insideClass === WHITESPACE, outside: true };
  }
  if (outsideClass === WHITESPACE) {
    return insideClass === WHITESPACE ? { inside: true, outside: true } : { inside: false, outside: false };
  }
  return { inside: insideClass === WHITESPACE, outside: false };
}

const reference = (codePoint: number): string => `&#x${codePoint.toString(16).toUpperCase()};`;

/** `value` with its first code point written as a character reference. */
function encodeFirstCodePoint(value: string): string {
  const codePoint = value.codePointAt(0) ?? 0;
  return reference(codePoint) + value.slice(codePoint > 0xffff ? 2 : 1);
}

/** `value` with its last code point written as a character reference. */
function encodeLastCodePoint(value: string): string {
  const low = value.charCodeAt(value.length - 1);
  const high = value.charCodeAt(value.length - 2);
  const width = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? 2 : 1;
  return value.slice(0, -width) + reference(value.codePointAt(value.length - width) ?? 0);
}

/** Serialize one attention node wrapped in `delimiter`. */
function serializeAttention(
  node: unknown,
  state: AttentionState,
  info: AttentionInfo,
  construct: string,
  delimiter: string,
): string {
  const marker = delimiter.charAt(0);
  const exit = state.enter(construct);
  const tracker = state.createTracker(info);
  const before = tracker.move(delimiter);
  let between = tracker.move(
    state.containerPhrasing(node, { after: marker, before, ...tracker.current() }),
  );

  const open = encodeSides(info.before.charCodeAt(info.before.length - 1), between.charCodeAt(0), marker);
  if (open.inside) between = encodeFirstCodePoint(between);
  const close = encodeSides(info.after.charCodeAt(0), between.charCodeAt(between.length - 1), marker);
  if (close.inside) between = encodeLastCodePoint(between);

  const after = tracker.move(delimiter);
  exit();
  state.attentionEncodeSurroundingInfo = { before: open.outside, after: close.outside };
  return before + between + after;
}

/**
 * The node types `serializeAttention` writes — the ones whose closing
 * delimiter can ask for the character after it to be encoded. A handler for
 * the node that follows needs to know (serializerBreak.ts); a type added to
 * the handlers below belongs here too.
 */
export const ATTENTION_NODE_TYPES: ReadonlySet<string> = new Set(["emphasis", "strong", "delete"]);

/**
 * The position of `node` among its siblings. `containerPhrasing` records the
 * current child in `indexStack` — the node itself when handling it, the node
 * before it when peeking — so the common case is O(1).
 *
 * Exported for the other handlers that decide by a node's neighbours
 * (serializerBreak.ts); a search from the front in each would make a
 * paragraph of n such nodes cost n².
 */
export function siblingIndex(
  node: unknown,
  parent: PhrasingParent | undefined,
  state: Pick<AttentionState, "indexStack">,
): number {
  const siblings = parent?.children ?? [];
  const current = state.indexStack[state.indexStack.length - 1] ?? -1;
  if (siblings[current] === node) return current;
  if (siblings[current + 1] === node) return current + 1;
  return siblings.indexOf(node as { type: string });
}

/** `_` when a sibling `**` would otherwise sit flush against this emphasis. */
function emphasisMarker(node: unknown, parent: PhrasingParent | undefined, state: AttentionState): "*" | "_" {
  const index = siblingIndex(node, parent, state);
  if (index < 0) return "*";
  const siblings = parent?.children ?? [];
  return siblings[index - 1]?.type === "strong" || siblings[index + 1]?.type === "strong" ? "_" : "*";
}

/** `emphasis` handler; `peek` reports the marker `containerPhrasing` will see. */
export const handleEmphasis = Object.assign(
  (node: unknown, parent: PhrasingParent | undefined, state: AttentionState, info: AttentionInfo): string =>
    serializeAttention(node, state, info, "emphasis", emphasisMarker(node, parent, state)),
  {
    peek: (node: unknown, parent: PhrasingParent | undefined, state: AttentionState): string =>
      emphasisMarker(node, parent, state),
  },
);

/** `strong` handler. */
export const handleStrong = Object.assign(
  (node: unknown, _parent: unknown, state: AttentionState, info: AttentionInfo): string =>
    serializeAttention(node, state, info, "strong", "**"),
  { peek: (): string => "*" },
);

/**
 * `delete` handler. GFM gives `~~` the same flanking test as `*`
 * (micromark-extension-gfm-strikethrough), so it takes the same table.
 */
export const handleDelete = Object.assign(
  (node: unknown, _parent: unknown, state: AttentionState, info: AttentionInfo): string =>
    serializeAttention(node, state, info, "strikethrough", "~~"),
  { peek: (): string => "~" },
);
