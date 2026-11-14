/**
 * Utility functions for formatting file paths safely for terminal input.
 */

/**
 * Formats a local file path for safe insertion into a terminal shell.
 *
 * If the path contains spaces or characters with special shell meaning
 * (quotes, backslashes, dollar signs, shell metacharacters), it is quoted
 * with internal special characters escaped, ensuring commands and CLI agents
 * (such as Claude Code, Codex, bash, zsh) parse it as a single token.
 */
export function formatTerminalPath(filePath: string): string {
  const normalized = filePath.trim();
  if (!normalized) {
    return "";
  }

  // If there are no spaces or shell-special characters, return directly.
  if (!/[\s"'\\$`!*?~()[\]{}&;<>]/.test(normalized)) {
    return normalized;
  }

  // Escape backslashes, double quotes, dollar signs, and backticks before wrapping in double quotes.
  const escaped = normalized.replace(/(["\\$`])/g, "\\$1");
  return `"${escaped}"`;
}
