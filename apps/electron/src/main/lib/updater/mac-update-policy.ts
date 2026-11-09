/** 原生 Squirrel 会用旧包的 designated requirement 验证新包，ad-hoc 的 cdhash 身份不能跨版本沿用。 */
export function getMacManualInstallReason(platform: string, signature: string, exitCode: number | null): string | undefined {
  if (platform !== 'darwin') return undefined
  if (exitCode !== 0) return '无法确认应用签名，请使用安装包替换应用。'
  if (/Signature=adhoc|flags=[^\n]*\badhoc\b/.test(signature)) {
    return '当前为临时签名版本，不能使用原生自动更新；请使用安装包替换应用。'
  }
  if (!/^Authority=Developer ID Application:/m.test(signature)) return '当前签名不支持可靠的原生更新，请使用安装包替换应用。'
  return undefined
}
