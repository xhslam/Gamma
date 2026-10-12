// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Purpose: resolve `*`/`_` emphasis without walking every closer back to the
 * start of the paragraph.
 *
 * micromark resolves attention in one `resolveAll` pass: for every sequence
 * that can close, it walks back EVENT BY EVENT to the nearest sequence that can
 * open with the same marker (and passes the rule of three). A closer with
 * nothing to find walks all the way, so the cost is O(closers × events):
 *
 *   - `a_ ` × 24000, where every `_` closes and none opens: 27s to parse and
 *     44s to serialize at the soak's scale (#1407);
 *   - `*_` × 12000 `x` `_*` × 12000, where earlier matches CONSUME the only
 *     candidate openers, so two of every three closers walk to the start:
 *     117s to parse.
 *
 * This is micromark-core-commonmark 2.0.3's `resolveAllAttention`, ported with
 * one change: the walk. Instead of every event, a closer scans a per-marker
 * list of the opener sequences still present before it — exactly the events
 * the walk would stop at — nearest first, applying the stock test to each.
 * The match it finds, and everything done with it (the tokens, the points, the
 * inner span resolved through `insideSpan`, the splice, where the loop resumes)
 * is the stock code, line for line.
 *
 * Why the list is exact: an opener enters the list when the loop passes its
 * exit event, which it does for every event before a closer. A match removes
 * the opener if fully used and every list entry inside the matched span — the
 * span's sequences become data, and the stock walk would skip them. Entries
 * below the opener keep their indices: the splice starts at the opener.
 *
 * Mechanism: `attention` is disabled by name and this wrapper takes its place
 * at `*` and `_`. It tokenizes with micromark's own `attention` tokenizer,
 * looked up from the parser rather than imported. Link text inside a label is
 * still resolved by the stock resolver through `insideSpan`, as before.
 *
 * PLACE matters, unlike for the `]` and backtick fast paths: this wrapper
 * SUCCEEDS, so whichever construct micromark tries first at `_` wins. GFM's
 * email autolink is registered ahead of `attention` there, and a wrapper added
 * in front of both turned `(_A_@_.A` from a link into emphasis — the
 * equivalence test (`inlineFastPaths.test.ts`) caught exactly that. So the
 * wrapper is added AFTER, and refuses loudly to run anywhere but directly
 * behind the disabled stock construct, where the order of everything
 * micromark tries is unchanged.
 *
 * Known limitations: every match still re-resolves its inner span and splices
 * the event list, as stock does, so deeply NESTED matched emphasis stays
 * quadratic in its depth; and openers the rule of three skips are re-scanned by
 * each later closer, where cmark keeps a per-class floor.
 *
 * @coordinates-with micromarkTypes.ts — the tokenizer API slice used here
 * @coordinates-with remarkInlineFastPaths.ts — registers this construct
 * @module utils/markdownPipeline/parser/fastPaths/attentionFastPath
 */
import type {
  Construct,
  Effects,
  Event,
  ParseContext,
  Point,
  Resolver,
  State,
  Token,
  TokenizeContext,
} from "./micromarkTypes";

const ASTERISK = 42;
const UNDERSCORE = 95;
export const STOCK_ATTENTION = "attention";
const NAME = "vmarkAttention";
/** micromark-util-chunked's bound on arguments passed to one native splice. */
const SPLICE_CHUNK = 10_000;

const placementChecked = new WeakSet<ParseContext>();

/** Everything micromark registered at `code`, disabled or not, in try order. */
function registeredAt(parser: ParseContext, code: number): Construct[] {
  const registered = parser.constructs.text[code];
  return Array.isArray(registered) ? registered : registered ? [registered] : [];
}

/**
 * micromark's own `attention` construct, found by name in the parser — after
 * confirming, once per parser, that the wrapper sits in its place.
 *
 * Returns undefined when there is no stock construct to wrap: then nothing was
 * disabled by that name either, and declining is exactly the stock behaviour.
 */
function stockAttention(parser: ParseContext): Construct | undefined {
  const stock = registeredAt(parser, ASTERISK).find((c) => c.name === STOCK_ATTENTION);
  if (!stock || placementChecked.has(parser)) return stock;
  const disabled = parser.constructs.disable.null ?? [];
  for (const code of [ASTERISK, UNDERSCORE]) {
    const list = registeredAt(parser, code);
    const from = list.indexOf(stock);
    const to = list.findIndex((c) => c.name === NAME);
    const between = list.slice(from + 1, to);
    if (from < 0 || to < from || between.some((c) => !(c.name && disabled.includes(c.name)))) {
      throw new Error(
        `[MarkdownPipeline] ${NAME} is not directly behind micromark's attention at ` +
          `character ${code}; it would change which construct wins there. Register ` +
          `remarkInlineFastPaths before any plugin that appends constructs at * or _.`,
      );
    }
  }
  placementChecked.add(parser);
  return stock;
}

function tokenizeAttention(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const stock = stockAttention(this.parser);
  if (!stock) return nok;
  return stock.tokenize.call(this, effects, ok, nok);
}

/** micromark-util-chunked `splice`: the same result, chunked for huge inserts. */
function spliceEvents(list: Event[], start: number, remove: number, items: Event[]): void {
  if (items.length < SPLICE_CHUNK) {
    list.splice(start, remove, ...items);
    return;
  }
  if (remove) list.splice(start, remove);
  for (let chunk = 0; chunk < items.length; chunk += SPLICE_CHUNK) {
    list.splice(start + chunk, 0, ...items.slice(chunk, chunk + SPLICE_CHUNK));
  }
}

/** micromark-util-resolve-all: each distinct resolver once, in order. */
function resolveAllOnce(constructs: ReadonlyArray<{ resolveAll?: Resolver }>, events: Event[], context: TokenizeContext): Event[] {
  const called: Resolver[] = [];
  let result = events;
  for (const construct of constructs) {
    const resolve = construct.resolveAll;
    if (resolve && !called.includes(resolve)) {
      result = resolve(result, context);
      called.push(resolve);
    }
  }
  return result;
}

function movePoint(point: Point, offset: number): void {
  point.column += offset;
  point.offset += offset;
  point._bufferIndex += offset;
}

const size = (token: Token): number => token.end.offset - token.start.offset;

function resolveAllAttention(events: Event[], context: TokenizeContext): Event[] {
  /** Marker code → ascending exit-event indices of sequences that can open. */
  const openers = new Map<number, number[]>();
  const markers = new WeakMap<Token, number>();
  const markerOf = (token: Token): number => {
    let marker = markers.get(token);
    if (marker === undefined) {
      marker = context.sliceSerialize(token).charCodeAt(0);
      markers.set(token, marker);
    }
    return marker;
  };

  let index = -1;
  while (++index < events.length) {
    const [kind, closer] = events[index]!;
    if (closer.type !== "attentionSequence") continue;
    if (kind === "exit") {
      if (closer._open) {
        const list = openers.get(markerOf(closer));
        if (list) list.push(index);
        else openers.set(markerOf(closer), [index]);
      }
      continue;
    }
    if (!closer._close) continue;
    const candidates = openers.get(markerOf(closer));
    if (!candidates) continue;

    for (let k = candidates.length - 1; k >= 0; k -= 1) {
      const open = candidates[k]!;
      const opener = events[open]![1];
      // Stock's walk stops only at these; a stale entry is skipped the same way.
      if (events[open]![0] !== "exit" || opener.type !== "attentionSequence" || !opener._open) continue;
      if ((opener._close || closer._open) && size(closer) % 3 && !((size(opener) + size(closer)) % 3)) {
        continue;
      }

      // From here to the splice: micromark's resolver, unchanged.
      const use = size(opener) > 1 && size(closer) > 1 ? 2 : 1;
      const start = { ...opener.end };
      const end = { ...closer.start };
      movePoint(start, -use);
      movePoint(end, use);
      const openingSequence: Token = { type: use > 1 ? "strongSequence" : "emphasisSequence", start, end: { ...opener.end } };
      const closingSequence: Token = { type: use > 1 ? "strongSequence" : "emphasisSequence", start: { ...closer.start }, end };
      const text: Token = { type: use > 1 ? "strongText" : "emphasisText", start: { ...opener.end }, end: { ...closer.start } };
      const group: Token = { type: use > 1 ? "strong" : "emphasis", start: { ...openingSequence.start }, end: { ...closingSequence.end } };
      opener.end = { ...openingSequence.start };
      closer.start = { ...closingSequence.end };

      let nextEvents: Event[] = [];
      if (size(opener)) nextEvents.push(["enter", opener, context], ["exit", opener, context]);
      nextEvents.push(["enter", group, context], ["enter", openingSequence, context], ["exit", openingSequence, context], ["enter", text, context]);
      nextEvents = nextEvents.concat(resolveAllOnce(context.parser.constructs.insideSpan.null, events.slice(open + 1, index), context));
      nextEvents.push(["exit", text, context], ["enter", closingSequence, context], ["exit", closingSequence, context], ["exit", group, context]);
      const offset = size(closer) ? 2 : 0;
      if (offset) nextEvents.push(["enter", closer, context], ["exit", closer, context]);

      // Every list, not just this marker's: the splice rewrites everything
      // after the opener, so an entry past it names an event inside the span
      // — now data — and, left in place, could alias a later sequence at a
      // shifted index out of order. A spent opener leaves too.
      for (const list of openers.values()) {
        while (list.length > 0 && (list.at(-1) as number) > open) list.pop();
      }
      if (!size(opener)) candidates.pop();

      spliceEvents(events, open - 1, index - open + 3, nextEvents);
      index = open + nextEvents.length - offset - 2;
      break;
    }
  }

  // Remove remaining sequences.
  for (const [, token] of events) {
    if (token.type === "attentionSequence") token.type = "data";
  }
  return events;
}

/** Takes `attention`'s place at `*` and `_`; see the header. */
export const attentionWithoutFutileWalks: Construct = {
  name: NAME,
  add: "after",
  tokenize: tokenizeAttention,
  resolveAll(events, context) {
    return stockAttention(context.parser) ? resolveAllAttention(events, context) : events;
  },
};
