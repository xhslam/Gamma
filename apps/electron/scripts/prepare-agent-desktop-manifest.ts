/**
 * 固定源码基线。2026-10-31 核验：v1.0.2 tag 指向 a47ed664e0db00d1d4df364eb3fe8a5599882f3c，
 * 不等于批准提交，因此该 release 的 CLI/hash 均不能作为本基线产物使用。
 * 核验：git ls-remote https://github.com/vercel-labs/agent-desktop.git refs/tags/v1.0.2
 * 上游构建/平台布局来源：该固定提交 .github/workflows/release.yml。
 * 源码构建保证输入版本固定，不宣称跨 SDK/链接器的字节级可复现；receipt 记录实际工具链及文件哈希。
 */
export const AGENT_DESKTOP_SOURCE = {
  repository: 'https://github.com/vercel-labs/agent-desktop.git',
  commit: '893a4140d35261c5f8e3a6aa646d1558bb4f386f',
  version: '1.0.2',
  rustToolchain: '1.89.0',
  cargoLockSha256: '3be8a5fdfc899e326249e61c96ca9756bc3d4078540e316f0e011aba6d9c40d7',
  licenseSha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  toolchainSha256: 'a9ca2c483f361f43aab9c0776d7d12eb281a20a83cf4d9207e08bc3b42542197',
  rejectedReleaseTag: 'v1.0.2',
  rejectedReleaseCommit: 'a47ed664e0db00d1d4df364eb3fe8a5599882f3c',
} as const

export interface AgentDesktopTarget {
  platform: 'darwin' | 'linux' | 'win32'
  arch: 'arm64' | 'x64'
  triple: string
  executables: string[]
}

export function agentDesktopTarget(platform: string, arch: string): AgentDesktopTarget {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`不支持的 agent-desktop 目标：${platform}/${arch}`)
  }
  const rustArch = arch === 'arm64' ? 'aarch64' : 'x86_64'
  const suffix = platform === 'darwin' ? 'apple-darwin' : platform === 'linux' ? 'unknown-linux-gnu' : 'pc-windows-msvc'
  return {
    platform: platform as AgentDesktopTarget['platform'],
    arch: arch as AgentDesktopTarget['arch'],
    triple: `${rustArch}-${suffix}`,
    executables: platform === 'win32' ? ['agent-desktop.exe'] : ['agent-desktop', platform === 'darwin' ? 'agent-desktop-macos-helper' : 'agent-desktop-linux-clipboard-owner'],
  }
}

export const AGENT_DESKTOP_ENTITLEMENTS = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict/></plist>\n'
export const AGENT_DESKTOP_NOTICE = `agent-desktop ${AGENT_DESKTOP_SOURCE.version}\nSource: ${AGENT_DESKTOP_SOURCE.repository}\nCommit: ${AGENT_DESKTOP_SOURCE.commit}\nLicense: Apache-2.0 (see LICENSE)\nCopyright: agent-desktop contributors; upstream LICENSE has no additional copyright or NOTICE file.\nGamma builds the unmodified CLI and platform helper from the fixed source commit.\nRelease ${AGENT_DESKTOP_SOURCE.rejectedReleaseTag} is not used: it points to ${AGENT_DESKTOP_SOURCE.rejectedReleaseCommit}.\n`
