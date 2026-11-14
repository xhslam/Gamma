/**
 * Adapted from VMark v0.9.94, commit
 * 00ad428592dc5e80aab5afc8878a3f8c3bd27930:
 * src/theme/buildXtermTheme.ts and src/theme/themes/*.ts.
 * Only terminal ANSI/selection tokens and the pure color mapper are retained;
 * Auris supplies its own application background/foreground via scoped tokens.
 *
 * ISC License
 *
 * Copyright (c) 2026 Xiaolai Li
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
import type { ITheme } from "@xterm/xterm";
import type { AppThemeId } from "./app-theme";

const terminalPalettes = {
  white: {
    selection: "rgba(0, 102, 204, 0.2)",
    ansi: {
      black: "#2e3436", red: "#cc0000", green: "#3d7a04", yellow: "#8a7000",
      blue: "#3465a4", magenta: "#75507b", cyan: "#047a7c", white: "#767676",
      brightBlack: "#555753", brightRed: "#d42020", brightGreen: "#4b8316", brightYellow: "#796300",
      brightBlue: "#4471ab", brightMagenta: "#885088", brightCyan: "#168385", brightWhite: "#656565",
    },
  },
  paper: {
    selection: "rgba(0, 102, 204, 0.2)",
    ansi: {
      black: "#2e3436", red: "#c33820", green: "#387204", yellow: "#806800",
      blue: "#2f5a92", magenta: "#7b4d82", cyan: "#086e6e", white: "#595959",
      brightBlack: "#5c5c5a", brightRed: "#b3341d", brightGreen: "#306203", brightYellow: "#6f5a00",
      brightBlue: "#40679b", brightMagenta: "#6c4472", brightCyan: "#075e5e", brightWhite: "#6a6a6a",
    },
  },
  mint: {
    selection: "rgba(26, 107, 74, 0.2)",
    ansi: {
      black: "#2a3832", red: "#9e3020", green: "#246428", yellow: "#7a5c00",
      blue: "#155878", magenta: "#7b4a8a", cyan: "#0a6571", white: "#3d5240",
      brightBlack: "#4d6054", brightRed: "#a53e30", brightGreen: "#1e5422", brightYellow: "#6a5000",
      brightBlue: "#1a6896", brightMagenta: "#6c4179", brightCyan: "#095761", brightWhite: "#4d604f",
    },
  },
  sepia: {
    selection: "rgba(139, 69, 19, 0.2)",
    ansi: {
      black: "#3e3328", red: "#b5421a", green: "#4a6818", yellow: "#7a5c00",
      blue: "#4a6a8a", magenta: "#8a5470", cyan: "#1e645e", white: "#5e5345",
      brightBlack: "#6b5d4f", brightRed: "#a53c18", brightGreen: "#577328", brightYellow: "#836712",
      brightBlue: "#415d79", brightMagenta: "#794a63", brightCyan: "#267a6e", brightWhite: "#6c6256",
    },
  },
  night: {
    selection: "rgba(90, 168, 255, 0.22)",
    ansi: {
      black: "#1a1d22", red: "#f85149", green: "#3fb950", yellow: "#d29922",
      blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
      brightBlack: "#484f58", brightRed: "#ff7b72", brightGreen: "#56d364", brightYellow: "#e3b341",
      brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
    },
  },
  solarized: {
    selection: "rgba(38, 139, 210, 0.16)",
    ansi: {
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
} satisfies Record<AppThemeId, { selection: string; ansi: ITheme }>;

/** VMark's pure rgba/hex alpha mapper. */
export function withAlpha(color: string, alpha: number): string {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(color.trim());
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex && hex[1]) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

export function buildNotesTerminalTheme(
  themeId: AppThemeId,
  background: string,
  foreground: string,
): ITheme {
  const palette = Object.prototype.hasOwnProperty.call(terminalPalettes, themeId)
    ? terminalPalettes[themeId]
    : terminalPalettes.paper;
  return {
    ...palette.ansi,
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: withAlpha(palette.selection, 0.25),
    scrollbarSliderBackground: withAlpha(foreground, 0.2),
    scrollbarSliderHoverBackground: withAlpha(foreground, 0.4),
    scrollbarSliderActiveBackground: withAlpha(foreground, 0.5),
  };
}
