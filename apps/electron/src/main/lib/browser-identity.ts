/**
 * 受管网页以 Gamma 身份出现，但保留 Chromium 兼容 token 供站点正确选择页面能力。
 * 不伪造为其他浏览器，也不添加跨站识别用的自定义请求头。
 */
export function buildGammaBrowserUserAgent(defaultUserAgent: string, gammaVersion: string): string {
  const base = defaultUserAgent
    .replace(/\s+Electron\/[^\s]+/gi, '')
    .replace(/\s+Gamma\/[^\s]+/gi, '')
    .trim()
  return `${base} Gamma/${gammaVersion}`
}
