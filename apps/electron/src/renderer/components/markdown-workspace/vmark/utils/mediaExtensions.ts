// 移植自 xiaolai/vmark @ ca71e3e0；Copyright (c) 2026 Xiaolai Li，ISC 许可见本移植目录根 LICENSE。
/**
 * Media Extensions — single source of truth
 *
 * Purpose: One canonical list per media kind (image/video/audio). Previously
 * these lists were redefined in 7+ places with DIVERGENT contents — `avif`,
 * `bmp`, and `ico` disagreed across copies, so detection paths disagreed on
 * whether the same file was an image (a latent correctness bug, not just DRY).
 *
 * Two forms are exported because callers need both:
 * - bare (`png`)   — Tauri file-dialog `extensions` filters expect no dot.
 * - dotted (`.png`) — path/URL suffix detection matches the trailing extension.
 *
 * The canonical IMAGE set is the UNION of all former copies (the most permissive
 * is the intended set: a real image file should be recognized everywhere).
 *
 * @coordinates-with src/utils/mediaExtensions.json — the data, shared with Rust
 * @coordinates-with src-tauri/src/asset_access.rs — embeds the same file for the asset:// grant gate
 * @module utils/mediaExtensions
 */

/**
 * The lists themselves live in `mediaExtensions.json`, the ONE file both this
 * module and the Rust asset-protocol gate (`src-tauri/src/asset_access.rs`,
 * via `include_str!`) read. They used to be two hand-kept copies held together
 * by a Rust test that parsed this file's source text, so a comment or a
 * reformat could break or fool the check. Both sides now validate the same
 * data: lowercase bare extensions, none named twice.
 *
 * Image: the canonical union of the former copies, broadened for the media
 * viewer. macOS WKWebView decodes heic/heif/tiff natively; where a webview
 * can't decode a format the media viewer degrades to an "open externally"
 * fallback rather than erroring.
 */
import MEDIA from "./mediaExtensions.json";

/** Image extensions (bare, no leading dot). */
export const IMAGE_EXTENSIONS: readonly string[] = Object.freeze([...MEDIA.image]);

/** Video extensions (bare, no leading dot). */
export const VIDEO_EXTENSIONS: readonly string[] = Object.freeze([...MEDIA.video]);

/** Audio extensions (bare, no leading dot). */
export const AUDIO_EXTENSIONS: readonly string[] = Object.freeze([...MEDIA.audio]);

/** Image extensions with a leading dot (for path/URL suffix matching). */
export const IMAGE_EXTENSIONS_DOTTED = IMAGE_EXTENSIONS.map((e) => `.${e}`);
/** Video extensions with a leading dot. */
export const VIDEO_EXTENSIONS_DOTTED = VIDEO_EXTENSIONS.map((e) => `.${e}`);
/** Audio extensions with a leading dot. */
export const AUDIO_EXTENSIONS_DOTTED = AUDIO_EXTENSIONS.map((e) => `.${e}`);

/**
 * Extract the lowercase bare extension (no dot) from a filename, path, or URL.
 * Strips query params, hash fragments, and trailing slashes. Returns "" when
 * there is no extension or for hidden files like ".gitignore".
 */
/** True for inputs with a URL scheme (`http://`, `file://`, `asset://`, …). */
function isUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}

export function fileExtension(pathOrUrl: string): string {
  if (!pathOrUrl) return "";
  // URLs carry a real query/fragment — strip it. Local paths keep `?`/`#` as
  // literal filename characters (e.g. `photo#1.png` is a `.png`).
  const clean = (isUrl(pathOrUrl) ? (pathOrUrl.split(/[?#]/)[0] ?? "") : pathOrUrl).replace(
    /\/+$/,
    "",
  );
  // Operate on the basename so a leading-dot hidden file in a subfolder
  // (e.g. "/p/.gitignore") is correctly treated as having no extension.
  // A trailing `?…`/`#…` with no dot after it is a marker/anchor (`?reload=1`,
  // `#anchor`) and is dropped; `photo#1.png` keeps its `.png`.
  const base = (clean.split(/[/\\]/).pop() ?? "").replace(/[?#][^.]*$/, "");
  const lastDot = base.lastIndexOf(".");
  // -1 = no dot; 0 = hidden file (".gitignore") → no extension.
  if (lastDot <= 0) return "";
  return base.slice(lastDot + 1).toLowerCase();
}
