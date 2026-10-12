// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Purpose: settle a backtick run that no later run can close in O(run length),
 * instead of letting micromark scan to the end of the paragraph to find that
 * out.
 *
 * micromark's `codeText` starts at a run of k backticks and consumes forward
 * until a run of EXACTLY k backticks, or the end of the paragraph. When no such
 * run exists it fails — and every other unmatched opener pays the same scan.
 * Runs of distinct lengths therefore cost O(openers × paragraph), which for
 * the soak's `backtick-runs` class is cubic in the number of runs: it had not
 * finished after twelve minutes at soak scale (#1407). cmark fixed the same
 * class by remembering, per run length, where the last such run was.
 *
 * So does this construct, registered ahead of `codeText`:
 *
 *   1. Until a memo exists, an opener scans exactly as far as `codeText` will:
 *      to its first closing run, or to the end of the paragraph. It records
 *      the start offset of the last run of each length on the way, and then
 *      defers, so `codeText` runs exactly as before. Only a scan that reached
 *      the end leaves its record behind as the memo.
 *   2. Every LATER opener of length k looks up the last run of length k. If it
 *      starts after the opener, `codeText` will close on some run of length k,
 *      so this defers. If not, `codeText` must fail, so the run is consumed as
 *      plain data — which is what the text tokenizer does with it anyway once
 *      `codeText` fails.
 *
 * Why never read further than `codeText`: a lookahead that crosses a line
 * ending reaches a chunk the subtokenizer has not written yet, and the
 * container skip it defines on the next line is then applied to the lookahead's
 * point instead of the real one. That moved a text node's end by a column in a
 * list continuation (audit counterexample: `*<TAB>` then two lines of code spans).
 * The skipped scans in step 2 cannot do the same: a memo exists only after a
 * scan reached the end, and by then every chunk and every skip is in place.
 *
 * Why the memo is exact: `codeText` closes on the first MAXIMAL run of exactly
 * the opener's length after the opener, and nothing inside a code span can end
 * it early. Runs after the opener are delimited by non-backtick characters, so
 * a scan from any earlier point segments them identically. The one run whose
 * segmentation can differ is the opener's own (after an escaped backtick), and
 * `start > opener` excludes it.
 *
 * `previous` is copied from `codeText` so this construct never changes which
 * characters the text tokenizer treats as a break. `inlineFastPaths.test.ts`
 * diffs the mdast, positions included, against the stock parser.
 *
 * @coordinates-with micromarkTypes.ts — the tokenizer API slice used here
 * @coordinates-with remarkInlineFastPaths.ts — registers this construct
 * @module utils/markdownPipeline/parser/fastPaths/codeTextFastPath
 */
import {
  onlyModelledConstructs,
  type Code,
  type Construct,
  type Effects,
  type Event,
  type ParseContext,
  type State,
  type TokenizeContext,
} from "./micromarkTypes";

const GRAVE_ACCENT = 96;
const NAME = "vmarkInertCodeTextSequence";
const CODE_TEXT = "codeText";
const MODELLED: ReadonlySet<string> = new Set([NAME, CODE_TEXT]);

/** Backtick runs after the paragraph's first opener, by length. */
interface RunMemo {
  /** Offset of the opener whose scan built this memo. */
  from: number;
  /** Run length → start offset of the LAST run of that length. */
  lastStart: Map<number, number>;
}

const memos = new WeakMap<Event[], RunMemo>();
const modelledAtGrave = new WeakMap<ParseContext, boolean>();

/** `codeText`'s own `previous`: a run starts where the previous character is
 *  not a backtick, or where that backtick was escaped. */
function previousAllowsCodeText(this: TokenizeContext, code: Code): boolean {
  return code !== GRAVE_ACCENT || this.events[this.events.length - 1]![1].type === "characterEscape";
}

function tokenizeInertCodeTextSequence(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  if (!onlyModelledConstructs(modelledAtGrave, this.parser, GRAVE_ACCENT, MODELLED)) return nok;

  // `now` is a closure over the tokenizer, not a method, so it needs no `this`.
  const { events, now } = this;
  const opener = now().offset;
  const known = memos.get(events);
  const memo = known && known.from <= opener ? known : undefined;
  const recording: RunMemo = { from: opener, lastStart: new Map() };
  let size = 0;
  let runStart = 0;
  let runSize = 0;
  return openingRun;

  function openingRun(code: Code): State | undefined {
    if (code === GRAVE_ACCENT) {
      if (size === 0) effects.enter("data");
      effects.consume(code);
      size += 1;
      return openingRun;
    }
    if (!memo) return scanBetween(code);
    const last = memo.lastStart.get(size);
    if (last !== undefined && last > opener) return nok(code); // codeText will close
    effects.exit("data");
    return ok(code);
  }

  /** Record every later run to the end of the paragraph, then defer. */
  function scanBetween(code: Code): State | undefined {
    if (code === null) {
      memos.set(events, recording);
      return nok(code);
    }
    if (code === GRAVE_ACCENT) {
      runStart = now().offset;
      runSize = 0;
      return scanRun(code);
    }
    effects.consume(code);
    return scanBetween;
  }

  function scanRun(code: Code): State | undefined {
    if (code === GRAVE_ACCENT) {
      effects.consume(code);
      runSize += 1;
      return scanRun;
    }
    // A closing run: `codeText` will stop here, so stop here too, and leave no
    // memo — a scan must never read further than `codeText`'s own would.
    if (runSize === size) return nok(code);
    recording.lastStart.set(runSize, runStart);
    return scanBetween(code);
  }
}

/** Registered at a backtick, ahead of micromark's `codeText`. */
export const inertCodeTextSequence: Construct = {
  name: NAME,
  previous: previousAllowsCodeText,
  tokenize: tokenizeInertCodeTextSequence,
};
