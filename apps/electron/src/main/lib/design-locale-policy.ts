export const DESIGN_LOCALE_STORAGE_KEY = 'gamma:design:system-locale'

export function resolveDesignLocale(languages: readonly string[]): 'zh-CN' | 'en-US' {
  // 跟随首选系统语言，而不是“列表里出现中文就切中文”。当前只提供简体中文和英文。
  return /^zh(?:-|_|$)/i.test(languages[0]?.trim() ?? '') ? 'zh-CN' : 'en-US'
}
