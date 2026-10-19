const path = require('node:path')

/** 保留Electron既有逐文件配置，只为独立桌面helper覆写最小entitlements。 */
function computerOptionsForFile(app, original, defaults = {}) {
  const application = path.resolve(app)
  const helper = path.join(application, 'Contents', 'Helpers', 'Gamma Computer Use Helper.app')
  return file => {
    const normalized = path.resolve(file)
    // 新版osx-sign只读取逐文件权限，顶层旧entitlements字段不会自动继承。
    // 本地ad-hoc签名也必须沿用项目权限，不能悄悄回退到osx-sign的默认权限。
    const entitlements = normalized === application ? defaults.entitlements : defaults.entitlementsInherit ?? defaults.entitlements
    const existing = original ? original(file) : {
      ...(entitlements !== undefined && { entitlements }),
      ...(defaults.hardenedRuntime !== undefined && { hardenedRuntime: defaults.hardenedRuntime }),
    }
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
  await signAsync({ ...options, optionsForFile: computerOptionsForFile(options.app, options.optionsForFile, options) })
}
module.exports.computerOptionsForFile = computerOptionsForFile
