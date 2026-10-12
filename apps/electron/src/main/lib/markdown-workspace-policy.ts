import { isAbsolute, relative, sep } from 'node:path'

export const MARKDOWN_FILE_LIMIT = 5 * 1024 * 1024
export const MARKDOWN_RICH_LIMIT = 1024 * 1024
export function isMarkdownFilename(path: string): boolean { return /\.(md|markdown)$/i.test(path) }
export function isWithinMarkdownRoot(path: string, root: string): boolean {
  const part = relative(root, path)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}
export function isSafeMarkdownPath(path: string): boolean {
  return typeof path === 'string' && !isAbsolute(path) && !path.includes('\0')
    && !path.split(/[\\/]/).some(segment => segment === '..')
    && !/^[a-z]:/i.test(path)
}
