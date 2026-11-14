/**
 * Adapted from VMark v0.9.94 fontStacks.ts / terminalKeyHandler.ts,
 * commit 00ad428592dc5e80aab5afc8878a3f8c3bd27930 (ISC).
 * Copyright (c) 2026 Xiaolai Li
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import { DEFAULT_NOTES_TYPOGRAPHY } from "./notes-typography";

export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const TERMINAL_FONT_SIZE_STORAGE = "auris.notes.terminal.font-size";

export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.4;
export const TERMINAL_LINE_HEIGHT_STORAGE = "auris.notes.terminal.line-height";
export const TERMINAL_LINE_HEIGHT_OPTIONS = [1.2, 1.3, 1.4, 1.5, 1.6] as const;

export const DEFAULT_TERMINAL_WEBGL = true;
export const TERMINAL_WEBGL_STORAGE = "auris.notes.terminal.webgl";
export const TERMINAL_SETTINGS_EVENT = "auris:notes-terminal-settings";

export type TerminalPlatform = "windows" | "macos" | "linux";

export function getTerminalPlatform(): TerminalPlatform {
  if (typeof navigator === "undefined") return "windows";
  if (/Mac/i.test(navigator.platform)) return "macos";
  if (/Linux/i.test(navigator.platform)) return "linux";
  return "windows";
}

export function broadcastTerminalSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TERMINAL_SETTINGS_EVENT));
}

export function getPlatformTerminalFontFallback(platform: TerminalPlatform = getTerminalPlatform()): string {
  switch (platform) {
    case "macos":
      return 'ui-monospace, "SF Mono", Menlo, "PingFang SC", "Hiragino Sans GB"';
    case "windows":
      return '"Cascadia Mono", Consolas, "Microsoft YaHei UI"';
    case "linux":
      return 'monospace, "Noto Sans Mono CJK SC"';
  }
}

export function preferredTerminalFontStack(preferred: string, platform = getTerminalPlatform()) {
  const fallback = getPlatformTerminalFontFallback(platform);
  const trimmed = preferred.trim();
  if (!trimmed || trimmed === DEFAULT_NOTES_TYPOGRAPHY.fontMono) {
    return fallback;
  }
  if (trimmed.includes(fallback)) {
    return trimmed;
  }
  const cleanPreferred = trimmed.replace(/,\s*monospace\s*$/i, "").trim();
  return cleanPreferred ? `${cleanPreferred}, ${fallback}` : fallback;
}

export function clampTerminalFontSize(value: number) {
  return Number.isFinite(value) ? Math.min(32, Math.max(8, Math.round(value))) : DEFAULT_TERMINAL_FONT_SIZE;
}

export function loadTerminalFontSize() {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_FONT_SIZE;
  try {
    const saved = window.localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE);
    return saved === null ? DEFAULT_TERMINAL_FONT_SIZE : clampTerminalFontSize(Number(saved));
  } catch {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
}

export function clampTerminalLineHeight(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_LINE_HEIGHT;
  const rounded = Math.round(value * 10) / 10;
  return Math.min(1.6, Math.max(1.2, rounded));
}

export function loadTerminalLineHeight(): number {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_LINE_HEIGHT;
  try {
    const saved = window.localStorage.getItem(TERMINAL_LINE_HEIGHT_STORAGE);
    return saved === null ? DEFAULT_TERMINAL_LINE_HEIGHT : clampTerminalLineHeight(Number(saved));
  } catch {
    return DEFAULT_TERMINAL_LINE_HEIGHT;
  }
}

export function saveTerminalLineHeight(value: number): void {
  if (typeof window === "undefined") return;
  const clamped = clampTerminalLineHeight(value);
  try {
    window.localStorage.setItem(TERMINAL_LINE_HEIGHT_STORAGE, String(clamped));
  } catch {}
  broadcastTerminalSettings();
}

export function terminalLineHeightIndex(lineHeight: number): number {
  const clamped = clampTerminalLineHeight(lineHeight);
  const idx = TERMINAL_LINE_HEIGHT_OPTIONS.findIndex((val) => Math.abs(val - clamped) < 0.05);
  return idx >= 0 ? idx : 2;
}

export function terminalLineHeightFromIndex(index: number): number {
  if (index < 0 || index >= TERMINAL_LINE_HEIGHT_OPTIONS.length) return DEFAULT_TERMINAL_LINE_HEIGHT;
  return TERMINAL_LINE_HEIGHT_OPTIONS[index] ?? DEFAULT_TERMINAL_LINE_HEIGHT;
}

export function loadTerminalWebglEnabled(): boolean {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_WEBGL;
  try {
    const saved = window.localStorage.getItem(TERMINAL_WEBGL_STORAGE);
    return saved === null ? DEFAULT_TERMINAL_WEBGL : saved === "true";
  } catch {
    return DEFAULT_TERMINAL_WEBGL;
  }
}

export function saveTerminalWebglEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TERMINAL_WEBGL_STORAGE, enabled ? "true" : "false");
  } catch {}
  broadcastTerminalSettings();
}

export const DEFAULT_TERMINAL_READER_FONT_SIZE = 15;
export const TERMINAL_READER_FONT_SIZE_STORAGE = "auris.notes.terminal.reader-font-size";
export const TERMINAL_READER_FONT_SIZE_OPTIONS = [14, 15, 16, 17, 18, 19, 20] as const;

export function clampTerminalReaderFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_READER_FONT_SIZE;
  const rounded = Math.round(value);
  return Math.min(20, Math.max(14, rounded));
}

export function loadTerminalReaderFontSize(): number {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_READER_FONT_SIZE;
  try {
    const saved = window.localStorage.getItem(TERMINAL_READER_FONT_SIZE_STORAGE);
    return saved === null ? DEFAULT_TERMINAL_READER_FONT_SIZE : clampTerminalReaderFontSize(Number(saved));
  } catch {
    return DEFAULT_TERMINAL_READER_FONT_SIZE;
  }
}

export function saveTerminalReaderFontSize(value: number): void {
  if (typeof window === "undefined") return;
  const clamped = clampTerminalReaderFontSize(value);
  try {
    window.localStorage.setItem(TERMINAL_READER_FONT_SIZE_STORAGE, String(clamped));
  } catch {}
  broadcastTerminalSettings();
}

export function terminalReaderFontSizeIndex(fontSize: number): number {
  const clamped = clampTerminalReaderFontSize(fontSize);
  const idx = TERMINAL_READER_FONT_SIZE_OPTIONS.indexOf(clamped as (typeof TERMINAL_READER_FONT_SIZE_OPTIONS)[number]);
  return idx >= 0 ? idx : 1;
}

export function terminalReaderFontSizeFromIndex(index: number): number {
  if (index < 0 || index >= TERMINAL_READER_FONT_SIZE_OPTIONS.length) return DEFAULT_TERMINAL_READER_FONT_SIZE;
  return TERMINAL_READER_FONT_SIZE_OPTIONS[index] ?? DEFAULT_TERMINAL_READER_FONT_SIZE;
}

type KeyActions = {
  copy: () => void;
  paste: () => void;
  clear: () => void;
  selectAll: () => void;
  search: () => void;
  zoom: (delta: number | null) => void;
  selectSession: (index: number) => void;
  hasSelection: () => boolean;
  toggleReadingMode?: () => void;
  sessionShortcutCount?: number;
};

/** Terminal-local shortcuts. Do not copy VMark's IME gate without its paired
 * input owner: Auris leaves composition to xterm and never fires UI shortcuts
 * on composing/229 events. No arbitrary Shell/IPC behavior is added here. */
export function createNotesTerminalKeyHandler(actions: KeyActions, platform = getTerminalPlatform()) {
  return (event: KeyboardEvent) => {
    if (event.type !== "keydown" || event.isComposing || event.keyCode === 229) return true;
    const key = event.key.toLowerCase();
    const consume = (action: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      action();
      return false;
    };
    // Mod+Alt+R: toggle terminal reading mode (avoids CmdOrCtrl+Shift+R which collides with Electron forceReload role)
    if (
      key === "r" &&
      event.altKey &&
      !event.shiftKey &&
      (platform === "macos" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
    ) {
      if (actions.toggleReadingMode) return consume(actions.toggleReadingMode);
    }
    if (event.altKey) return true;
    if (key === "insert" && !event.metaKey && event.ctrlKey !== event.shiftKey) {
      if (event.shiftKey) return consume(actions.paste);
      if (platform === "linux") return consume(actions.copy);
    }
    if (platform === "macos" && event.ctrlKey && !event.metaKey) return true;
    if (!event.ctrlKey && !event.metaKey) return true;
    if (platform === "linux" && event.ctrlKey && !event.metaKey && !event.shiftKey && /^[abd-uw-z]$/i.test(key)) return true;
    switch (key) {
      case "c":
        if (actions.hasSelection()) return consume(actions.copy);
        // Linux's UI copy chord must never interrupt a process without selection.
        return platform === "linux" && event.ctrlKey && event.shiftKey ? consume(() => {}) : true;
      case "v": return consume(actions.paste);
      case "k": return consume(actions.clear);
      case "a": return consume(actions.selectAll);
      case "f": return event.shiftKey && platform !== "linux" ? true : consume(actions.search);
      case "r": return true;
      case "+":
      case "=": return consume(() => actions.zoom(2));
      case "-": return consume(() => actions.zoom(-2));
      case "0": return consume(() => actions.zoom(null));
      default:
        return /^[1-8]$/.test(key) && Number(key) <= (actions.sessionShortcutCount ?? 5) ? consume(() => actions.selectSession(Number(key) - 1)) : true;
    }
  };
}

export function terminalTabGlyph(label: string, programTitle?: string | null) {
  if (!programTitle) return label.match(/^Terminal (\d+)$/)?.[1] ?? label.slice(0, 1).toUpperCase();
  const name = programTitle.trim();
  const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)[Symbol.iterator]().next().value;
  return first?.segment.toUpperCase() || "?";
}
