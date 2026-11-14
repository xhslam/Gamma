/** Focus layout preferences only; never store Shell input or terminal output. */
export const TERMINAL_FOCUS_SCOPE = "auris:terminal-focus";
export const TERMINAL_FOCUS_LIMIT = 8;
export const TERMINAL_FOCUS_GAP = 8;
export const TERMINAL_FOCUS_LAYOUT_KEY = "auris.terminal-focus.layout.v1";

export type FocusLayout = {
  columns: number;
  columnWeights: number[];
  rowWeights: number[];
  sidebarCollapsed?: boolean;
};
export const DEFAULT_FOCUS_LAYOUT: FocusLayout = {
  columns: 2,
  columnWeights: [],
  rowWeights: [],
  sidebarCollapsed: false,
};

export function normalizeWeights(values: unknown, count: number): number[] {
  if (!count) return [];
  if (!Array.isArray(values) || values.length !== count || values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0.04 || v > 1)) {
    return Array.from({ length: count }, () => 1 / count);
  }
  const total = values.reduce((sum: number, value: number) => sum + value, 0);
  return values.map((value: number) => value / total);
}

export function normalizeFocusLayout(value: unknown): FocusLayout {
  if (!value || typeof value !== "object") return { ...DEFAULT_FOCUS_LAYOUT };
  const raw = value as Partial<FocusLayout>;
  const columns = Number.isInteger(raw.columns) && raw.columns! >= 1 && raw.columns! <= 4 ? raw.columns! : 2;
  const sidebarCollapsed = typeof raw.sidebarCollapsed === "boolean" ? raw.sidebarCollapsed : false;
  return {
    columns,
    columnWeights: normalizeWeights(raw.columnWeights, columns),
    rowWeights: Array.isArray(raw.rowWeights) && raw.rowWeights.length <= 8 ? normalizeWeights(raw.rowWeights, raw.rowWeights.length) : [],
    sidebarCollapsed,
  };
}

/** Change only the two tracks adjacent to a separator, preserving the total. */
export function resizeTracks(weights: number[], index: number, delta: number): number[] {
  if (index < 0 || index >= weights.length - 1 || !Number.isFinite(delta)) return weights;
  const w1 = weights[index];
  const w2 = weights[index + 1];
  if (w1 === undefined || w2 === undefined) return weights;
  const pair = w1 + w2;
  const minimum = Math.min(0.08, pair / 3);
  const next = Math.max(minimum, Math.min(pair - minimum, w1 + delta));
  return weights.map((weight, i) => i === index ? next : i === index + 1 ? pair - next : weight);
}
