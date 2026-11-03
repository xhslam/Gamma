interface IconLoaders {
  loadMacIcon: (path: string) => Promise<string>
  loadNativeIcon: (path: string) => Promise<string>
}

/** macOS 原生图标加载可能导致 Electron 主进程崩溃，失败时不再回退到该路径。 */
export async function loadDefaultAppIcon(platform: NodeJS.Platform, path: string, loaders: IconLoaders): Promise<string> {
  if (platform === 'darwin') {
    return path.toLowerCase().endsWith('.app') ? loaders.loadMacIcon(path) : ''
  }
  return loaders.loadNativeIcon(path)
}
