/** AX 基础操作支持 macOS 14；可选屏幕采集由原生层另行检查。 */
export function isComputerPlatformSupported(platform: string, kernelRelease: string): boolean {
  const [major, minor] = kernelRelease.split('.').map(Number)
  return platform === 'darwin' && Number.isSafeInteger(major) && Number.isSafeInteger(minor)
    && major! >= 23 && minor! >= 0
}
