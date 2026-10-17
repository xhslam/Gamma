/** macOS14.2对应Darwin23.2；14.0/14.1不能显式排除子窗口。 */
export function isComputerPlatformSupported(platform: string, kernelRelease: string): boolean {
  const [major, minor] = kernelRelease.split('.').map(Number)
  return platform === 'darwin' && Number.isSafeInteger(major) && Number.isSafeInteger(minor)
    && (major! > 23 || (major === 23 && minor! >= 2))
}
