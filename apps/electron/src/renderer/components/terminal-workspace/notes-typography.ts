export interface NotesTypographySettings {
  fontSize: string
  lineHeight: string
  blockSpacing: string
  cjkLetterSpacing: string
  editorMaxWidth: string
  fontLatin: string
  fontCjk: string
  fontMono: string
}

const DEFAULT_LATIN_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI"'
const DEFAULT_CJK_STACK = '"PingFang SC", "Microsoft YaHei"'
const DEFAULT_MONO_STACK = '"Cascadia Code", "JetBrains Mono", "SFMono-Regular", monospace'

export const DEFAULT_NOTES_TYPOGRAPHY: NotesTypographySettings = {
  fontSize: '18px',
  lineHeight: '1.8',
  blockSpacing: '14px',
  cjkLetterSpacing: 'normal',
  editorMaxWidth: '50em',
  fontLatin: DEFAULT_LATIN_STACK,
  fontCjk: DEFAULT_CJK_STACK,
  fontMono: DEFAULT_MONO_STACK,
}

const STORAGE_KEY = 'auris.notes.typography'
export const NOTES_TYPOGRAPHY_EVENT = 'auris:notes-typography'

export function loadNotesTypography(): NotesTypographySettings {
  if (typeof window === 'undefined') return DEFAULT_NOTES_TYPOGRAPHY
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NotesTypographySettings>
      return { ...DEFAULT_NOTES_TYPOGRAPHY, ...parsed }
    }
  } catch {
    // fallback
  }
  return DEFAULT_NOTES_TYPOGRAPHY
}

export function notesTypographyCssVars(settings: NotesTypographySettings): Record<string, string> {
  const contentWidth = !settings.editorMaxWidth || settings.editorMaxWidth === 'none' ? 'min(1240px, 100%)' : settings.editorMaxWidth
  return {
    '--notes-editor-font-size': settings.fontSize,
    '--notes-editor-line-height': settings.lineHeight,
    '--notes-editor-block-spacing': settings.blockSpacing,
    '--notes-editor-cjk-letter-spacing': settings.cjkLetterSpacing,
    '--notes-editor-max-width': settings.editorMaxWidth,
    '--notes-editor-content-width': contentWidth,
    '--notes-editor-font-latin': settings.fontLatin,
    '--notes-editor-font-cjk': settings.fontCjk,
    '--notes-editor-font-mono': settings.fontMono,
    '--auris-font-mono': settings.fontMono,
  }
}
