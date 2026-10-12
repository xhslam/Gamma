// 移植自 xiaolai/vmark @ 07c40609；Copyright (c) 2026 Xiaolai Li，ISC 许可见 vmark/LICENSE。
/**
 * KaTeX loader — imports the KaTeX module lazily, once, and caches it; a
 * failed chunk load is not cached, so the next render retries.
 *
 * @module plugins/shared/katexLoader
 */

import type { KatexOptions } from "katex";

export type KatexModule = typeof import("katex");
export type { KatexOptions };

let katexModule: KatexModule | null = null;
let katexLoadPromise: Promise<KatexModule> | null = null;

export async function loadKatex(): Promise<KatexModule> {
  if (katexModule) return katexModule;
  if (katexLoadPromise) return katexLoadPromise;

  // A rejected chunk load must not be cached: clearing the promise lets the
  // next render retry, so one transient failure does not disable math until
  // reload.
  katexLoadPromise = import("katex").then(
    (mod) => {
      katexModule = mod;
      return mod;
    },
    (error: unknown) => {
      katexLoadPromise = null;
      throw error;
    },
  );

  return katexLoadPromise;
}

export function getKatexModule(): KatexModule | null {
  return katexModule;
}

/**
 * Check if KaTeX module has been loaded.
 */
export function isKatexLoaded(): boolean {
  return katexModule !== null;
}
