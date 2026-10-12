// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Purpose: settle a `]` that nothing can close in O(1) amortized, instead of
 * letting micromark walk back through the whole paragraph to find that out.
 *
 * Two constructs are tried at every `]` in text, and both begin with a
 * backward scan over every event tokenized so far:
 *
 *   - `labelEnd` (micromark-core-commonmark) walks back to the nearest label
 *     start that is not yet balanced;
 *   - `gfmPotentialFootnoteCall` (micromark-extension-gfm-footnote) walks back
 *     to the nearest label image, link or footnote call.
 *
 * When the paragraph has no opener, both walks reach its start and fail — so
 * `a](` repeated n times costs O(n²). Measured at the soak's scale (#1407):
 * 60s to parse, and 276s to serialize, because the serializer's cosmetic pass
 * re-parses its output twice.
 *
 * This construct runs FIRST at `]`. It keeps an incremental index of the label
 * starts in the event list, and consumes the `]` as plain data exactly when no
 * unbalanced `labelLink`/`labelImage` exists. Both stock constructs must then
 * fail:
 *
 *   - `labelEnd` needs an unbalanced label start, by definition.
 *   - The potential footnote call needs a balanced `![` whose label, from the
 *     `![` to this `]`, names a defined footnote. A `![` is balanced only by a
 *     `]` that label-end tried and rejected — an unescaped `]` that is then
 *     INSIDE the label of every later `]`. A footnote definition label cannot
 *     contain an unescaped `]` (gfm's own definition tokenizer ends the label
 *     there), so no later `]` can complete that call. The one `]` that can is
 *     the one that balances the `![` — and at that `]` the `![` is still an
 *     unbalanced opener, so this construct defers.
 *
 * Anything else defers to the stock constructs, which then run exactly as
 * before. So the fast path can only make a parse FASTER; it cannot make one
 * different — `inlineFastPaths.test.ts` diffs the mdast, positions included,
 * against the stock parser over every vendored spec corpus, the spellings the
 * footnote argument has to survive, and a seeded fuzz.
 *
 * Key decisions:
 *   - PROOF, NOT REIMPLEMENTATION. Resources, references, `_inactive` links,
 *     definitions — all of it stays in micromark. Only "can this `]` close
 *     anything at all?" is answered here, and only the NO answer is acted on.
 *   - WATCHES, NOT TRUST. A deferred `]` may let a stock construct succeed and
 *     splice the events from the label start it matched — label-end from the
 *     nearest unbalanced opener, the footnote call from that same `![`. Both
 *     resolvers put a NEW event at that index, so the index records the event
 *     there and re-indexes from it when it changes. Nothing else rewrites
 *     events below the scanned mark during text tokenization; a tail check
 *     backstops that claim by rebuilding from zero rather than trusting it.
 *   - UNKNOWN CONSTRUCTS DEFER. If anything but the two modelled constructs is
 *     registered at `]`, the fast path cannot prove inertness and never fires.
 *
 * Known limitation: when a candidate opener DOES exist, stock `labelEnd`
 * serializes the whole label text to look up a definition — O(label length)
 * per `]`, so `[` × n followed by `]` × n stays quadratic. That cost is the
 * lookup itself, not the scan, and removing it would mean changing which
 * labels can match a definition.
 *
 * @coordinates-with micromarkTypes.ts — the tokenizer API slice used here
 * @coordinates-with remarkInlineFastPaths.ts — registers this construct
 * @module utils/markdownPipeline/parser/fastPaths/labelEndFastPath
 */
import {
  onlyModelledConstructs,
  type Construct,
  type Effects,
  type Event,
  type ParseContext,
  type State,
  type TokenizeContext,
} from "./micromarkTypes";

const RIGHT_SQUARE_BRACKET = 93;
const NAME = "vmarkInertLabelEnd";
const MODELLED: ReadonlySet<string> = new Set([NAME, "labelEnd", "gfmPotentialFootnoteCall"]);

/** Tokens `labelEnd` accepts as an opener (when not `_balanced`). */
const LABEL_STARTS: ReadonlySet<string> = new Set(["labelLink", "labelImage"]);

interface Watch {
  index: number;
  event: Event;
}

/** Incremental index over ONE tokenizer's event list. */
interface OpenerIndex {
  /** Events `[0, scanned)` are reflected in `openers`. */
  scanned: number;
  /** `events[scanned - 1]` when indexed — the backstop's sentinel. */
  tail: Event | undefined;
  /** Ascending enter-event indices of label starts not yet seen balanced. */
  openers: number[];
  /** Where a deferred `]` could have let a stock resolver splice. */
  watches: Watch[];
}

const indexes = new WeakMap<Event[], OpenerIndex>();
const modelledAtBracket = new WeakMap<ParseContext, boolean>();

/** Bring the index up to date with `events`, re-indexing whatever changed. */
function syncIndex(events: Event[]): OpenerIndex {
  let index = indexes.get(events);
  if (!index) {
    index = { scanned: 0, tail: undefined, openers: [], watches: [] };
    indexes.set(events, index);
  }

  let from = index.scanned;
  for (const watch of index.watches) {
    if (events[watch.index] !== watch.event) from = Math.min(from, watch.index);
  }
  index.watches = [];
  const untouched =
    from === index.scanned &&
    (index.scanned === 0 || (index.scanned <= events.length && events[index.scanned - 1] === index.tail));
  if (!untouched && from === index.scanned) from = 0; // backstop: an unexplained rewrite
  from = Math.min(from, events.length);

  if (from < index.scanned) {
    while (index.openers.length > 0 && (index.openers.at(-1) as number) >= from) index.openers.pop();
    index.scanned = from;
  }
  for (let i = index.scanned; i < events.length; i += 1) {
    const [kind, token] = events[i]!;
    if (kind === "enter" && LABEL_STARTS.has(token.type)) index.openers.push(i);
  }
  index.scanned = events.length;
  index.tail = events[events.length - 1];
  return index;
}

function tokenizeInertLabelEnd(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  if (!onlyModelledConstructs(modelledAtBracket, this.parser, RIGHT_SQUARE_BRACKET, MODELLED)) {
    return nok;
  }
  const { events } = this;
  const index = syncIndex(events);

  // A label start that failed to match is marked balanced, permanently.
  while (index.openers.length > 0 && events[index.openers.at(-1) as number]![1]._balanced) {
    index.openers.pop();
  }
  const opener = index.openers.at(-1);
  if (opener !== undefined) {
    index.watches.push({ index: opener, event: events[opener]! });
    return nok;
  }

  return function inertBracket(code) {
    effects.enter("data");
    effects.consume(code);
    effects.exit("data");
    return ok;
  };
}

/** Registered at `]`, ahead of micromark's own constructs. */
export const inertLabelEnd: Construct = {
  name: NAME,
  tokenize: tokenizeInertLabelEnd,
};
