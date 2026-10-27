const path = require('node:path')

/** 保留Electron既有逐文件配置；桌面CLI使用最小entitlements，不继承主应用JIT等权限。 */
function computerOptionsForFile(app, original, defaults = {}) {
  const application = path.resolve(app)
  const resourceDirectory = path.join(application, 'Contents', 'Resources', 'computer-use')
  const helper = path.join(resourceDirectory, 'gamma-computer-use-helper')
  return file => {
    const normalized = path.resolve(file)
    // 新版osx-sign只读取逐文件权限，顶层旧entitlements字段不会自动继承。
    // 本地ad-hoc签名也必须沿用项目权限，不能悄悄回退到osx-sign的默认权限。
    const entitlements = normalized === application ? defaults.entitlements : defaults.entitlementsInherit ?? defaults.entitlements
    const existing = original ? original(file) : {
      ...(entitlements !== undefined && { entitlements }),
      ...(defaults.hardenedRuntime !== undefined && { hardenedRuntime: defaults.hardenedRuntime }),
    }
    if (normalized !== helper) return existing
    return {
      ...existing,
      entitlements: path.join(resourceDirectory, 'entitlements.plist'),
      hardenedRuntime: true,
    }
  }
}

/** 缺少证书时仍完成本地包签名，不能把链接器签名误当成完整的应用签名。 */
function signingOptions(options) {
  const local = !options.identity || options.identity === 'none' || options.identity === '-'
  if (local && options.platform === 'mas') {
    throw new Error('Mac App Store 构建需要有效的签名证书，不能使用本地临时签名。')
  }
  const perFile = computerOptionsForFile(options.app, options.optionsForFile, options)
  return {
    ...options,
    ...(local && { identity: '-', identityValidation: false, preAutoEntitlements: false }),
    optionsForFile: file => ({
      ...perFile(file),
      // 临时签名没有证书时间戳；正式签名保持调用方配置。
      ...(local && { timestamp: 'none' }),
    }),
  }
}

// 仅electron-builder打包签名阶段调用，不在构建/测试/导入时执行签名。
module.exports = async function signMacApp(options) {
  const { signAsync } = require('@electron/osx-sign')
  await signAsync(signingOptions(options))
}
module.exports.computerOptionsForFile = computerOptionsForFile
module.exports.signingOptions = signingOptions
