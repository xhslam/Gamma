import { describe, expect, test } from 'bun:test'
import { getMacManualInstallReason } from './mac-update-policy'

describe('Given macOS 更新依赖跨版本签名身份', () => {
  test('When 运行包使用 ad-hoc 签名 Then 不再把 ZIP 下载完成当作可原生安装', () => {
    expect(getMacManualInstallReason('darwin', 'Signature=adhoc\nTeamIdentifier=not set', 0)).toContain('临时签名')
    expect(getMacManualInstallReason('darwin', 'flags=0x10002(adhoc,runtime)', 0)).toContain('临时签名')
  })
  test('When 使用稳定 Developer ID 签名 Then 保留原生空闲更新', () => {
    expect(getMacManualInstallReason('darwin', 'Authority=Developer ID Application: Example (TEAM)\nTeamIdentifier=TEAM', 0)).toBeUndefined()
  })
  test('When 签名检测失败、无签名或仅本地签名 Then 给出替换入口而非绕过验证', () => {
    expect(getMacManualInstallReason('darwin', '', 1)).toContain('无法确认')
    expect(getMacManualInstallReason('darwin', 'Signature=adhoc', null)).toContain('无法确认')
    expect(getMacManualInstallReason('darwin', 'Authority=local', 0)).toContain('安装包替换')
  })
  test('When Windows/Linux 更新 Then 不改变已有平台的安装策略', () => {
    for (const platform of ['win32', 'linux']) expect(getMacManualInstallReason(platform, '', 1)).toBeUndefined()
  })
})
