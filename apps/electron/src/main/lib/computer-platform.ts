/** AX 基础操作支持 macOS 14 (Darwin 23+) 与 Windows 10+ (kernel release 10.0+)；可选屏幕采集由原生层另行检查。 */
export function isComputerPlatformSupported(platform: string, kernelRelease: string): boolean {
  const [major, minor] = kernelRelease.split('.').map(Number)
  if (major === undefined || minor === undefined || !Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return false
  if (platform === 'darwin') {
    return major >= 23 && minor >= 0
  }
  if (platform === 'win32') {
    return major >= 10 && minor >= 0
  }
  return false
}

