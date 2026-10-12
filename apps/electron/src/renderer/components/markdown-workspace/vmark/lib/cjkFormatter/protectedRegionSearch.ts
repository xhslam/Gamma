// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * The one containment test the protected-region detectors share.
 *
 * Purpose: every detector guards its match START against the regions claimed
 * before it, which is what keeps a construct nested inside an earlier region
 * (inline code inside a fence, a link URL inside indented code) from being
 * protected twice and emitted twice by segment reconstruction.
 *
 * It lives here because the detectors are split across three modules for the
 * 300-line limit — markdownParser.ts, markdownParserInline.ts and
 * markdownParserBlocks.ts — and a predicate copied into each is a predicate
 * that can be fixed in one and left wrong in the others.
 *
 * It answers from a SNAPSHOT: the regions are sorted and merged once, and each
 * question is a binary search. Asking the growing list directly walked every
 * region per question, so a document with thousands of code spans or links
 * cost their number squared. A snapshot is enough because no detector needs
 * to see its own additions — its matches come in order and never overlap, so
 * a match cannot start inside an earlier match of the same pass.
 *
 * Half-open on purpose: `end` is exclusive, so a region ending at `pos` does
 * not contain it and the next construct may start exactly where the last one
 * finished.
 *
 * @coordinates-with markdownParser.ts — frontmatter, thematic breaks, fences
 * @coordinates-with markdownParserInline.ts — detectors 3-11
 * @coordinates-with markdownParserBlocks.ts — detectors 12-13
 * @coordinates-with formatterTables.ts — table lines inside a protected region
 * @module lib/cjkFormatter/protectedRegionSearch
 */

/** Is this position inside any of the regions the lookup was built from? */
export type RegionLookup = (pos: number) => boolean;

/**
 * A containment test over `regions` as they are NOW; regions added afterwards
 * are not seen. Build one per detector pass.
 */
export function createRegionLookup(
  regions: ReadonlyArray<{ start: number; end: number }>
): RegionLookup {
  if (regions.length === 0) return () => false;

  // Merge into disjoint, ascending intervals so one binary search decides.
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const starts: number[] = [];
  const ends: number[] = [];
  for (const { start, end } of sorted) {
    const last = ends.length - 1;
    if (last >= 0 && start <= ends[last]!) {
      if (end > ends[last]!) ends[last] = end;
    } else {
      starts.push(start);
      ends.push(end);
    }
  }

  return (pos) => {
    // The last interval starting at or before `pos`.
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid]! <= pos) low = mid + 1;
      else high = mid - 1;
    }
    return high >= 0 && pos < ends[high]!;
  };
}
