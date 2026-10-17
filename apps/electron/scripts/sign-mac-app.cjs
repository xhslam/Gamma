const path = require('node:path')

/** 保留Electron既有逐文件配置，只为独立桌面helper覆写最小entitlements。 */
function computerOptionsForFile(app, original) {
  const helper = path.join(app, 'Contents', 'Helpers', 'Gamma Computer Use Helper.app')
  return file => {
    const existing = original ? original(file) : {}
    const normalized = path.resolve(file)
    if (normalized !== helper && !normalized.startsWith(helper + path.sep)) return existing
    return {
      ...existing,
      entitlements: path.join(helper, 'Contents', 'Resources', 'entitlements.plist'),
      hardenedRuntime: true,
    }
  }
}

// 仅electron-builder打包签名阶段调用，不在构建/测试/导入时执行签名。
module.exports = async function signMacApp(options) {
  if (!options.identity || options.identity === 'none') {
    return
  }
  const { signAsync } = require('@electron/osx-sign')
  await signAsync({ ...options, optionsForFile: computerOptionsForFile(options.app, options.optionsForFile) })
}
module.exports.computerOptionsForFile = computerOptionsForFile
