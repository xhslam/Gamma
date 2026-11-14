export interface AsciiWallpaperEngine {
  init(ctx: CanvasRenderingContext2D, width: number, height: number): void
  paint(now: number): void
  resize(width: number, height: number): void
  dispose(): void
}

export const CELL_WIDTH = 9
export const CELL_HEIGHT = 16
export const MONOSPACE_FONT = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
