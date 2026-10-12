// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Purpose: the slice of micromark's tokenizer API the inline fast paths touch,
 * declared locally, plus the one lookup they all need — "which constructs
 * would micromark try at this character?"
 *
 * Local rather than imported from `micromark-util-types`: that package is a
 * transitive dependency, and adding it to reach six interfaces would put a
 * version pin on the parser's internals for no runtime gain. These are
 * STRUCTURAL: a field micromark renames shows up as a fast path that stops
 * firing — which the scaling test catches — or one that fires wrongly — which
 * the equivalence test catches.
 *
 * @coordinates-with labelEndFastPath.ts
 * @coordinates-with codeTextFastPath.ts
 * @coordinates-with attentionFastPath.ts
 * @module utils/markdownPipeline/parser/fastPaths/micromarkTypes
 */

/** A character code: a UTF-16 unit, a negative virtual code, or null (EOF). */
export type Code = number | null;

export interface Point {
  line: number;
  column: number;
  offset: number;
  _index: number;
  _bufferIndex: number;
}

export interface Token {
  type: string;
  start: Point;
  end: Point;
  _open?: boolean;
  _close?: boolean;
  _balanced?: boolean;
}

export type Event = [kind: "enter" | "exit", token: Token, context: TokenizeContext];

export type State = (code: Code) => State | undefined;

export type Resolver = (events: Event[], context: TokenizeContext) => Event[];

export interface Effects {
  enter: (type: string) => Token;
  exit: (type: string) => Token;
  consume: (code: Code) => void;
}

export interface Construct {
  name?: string;
  add?: "before" | "after";
  previous?: (this: TokenizeContext, code: Code) => boolean;
  tokenize: (this: TokenizeContext, effects: Effects, ok: State, nok: State) => State;
  resolveAll?: Resolver;
}

export interface ParseContext {
  constructs: {
    /** By character code, plus `null`: constructs tried at EVERY code. */
    text: Record<number | "null", Construct | Construct[] | undefined>;
    disable: { null?: string[] };
    /** Resolvers micromark runs over the text inside a matched span. */
    insideSpan: { null: ReadonlyArray<{ resolveAll?: Resolver }> };
  };
}

export interface TokenizeContext {
  events: Event[];
  parser: ParseContext;
  previous: Code;
  now: () => Point;
  sliceSerialize: (token: Pick<Token, "start" | "end">) => string;
}

/** A micromark syntax extension: constructs keyed by character code. */
export interface SyntaxExtension {
  text?: Record<number, Construct[]>;
  disable?: { null: string[] };
}

const asList = (entry: Construct | Construct[] | undefined): Construct[] =>
  Array.isArray(entry) ? entry : entry ? [entry] : [];

/**
 * Constructs micromark would TRY at `code` in text: the code's own list, then
 * the `null` list it tries at every code — minus anything disabled.
 */
function activeTextConstructs(parser: ParseContext, code: number): Construct[] {
  const { text, disable } = parser.constructs;
  const disabled = disable.null ?? [];
  return [...asList(text[code]), ...asList(text.null)].filter((c) => !(c.name && disabled.includes(c.name)));
}

/**
 * Whether every construct micromark would try at `code` is one a fast path
 * models. An unmodelled construct means a fast path cannot prove the character
 * is inert, so it must defer — which is always correct, only slower.
 *
 * Cached per parser: the construct table is fixed once a parser exists.
 */
export function onlyModelledConstructs(
  cache: WeakMap<ParseContext, boolean>,
  parser: ParseContext,
  code: number,
  modelled: ReadonlySet<string>,
): boolean {
  let answer = cache.get(parser);
  if (answer === undefined) {
    answer = activeTextConstructs(parser, code).every((c) => c.name !== undefined && modelled.has(c.name));
    cache.set(parser, answer);
  }
  return answer;
}
