import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness

beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Toaster } from 'sonner'
    import { AppIconPicker } from '@/components/settings/AppIconPicker'

    const delay = (milliseconds = 10) => new Promise(resolve => setTimeout(resolve, milliseconds))
    const until = async (condition) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) return
        await delay()
      }
      throw new Error('图标设置 DOM 状态未在预期时间内更新')
    }
    window.iconRegression = {
      until,
      delay,
      async mount(options = {}) {
        Object.defineProperty(navigator, 'platform', { configurable: true, value: options.platform || 'MacIntel' })
        Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: options.platform || 'macOS' } })
        window.electronAPI = {
          getSettings: options.getSettings || (async () => ({ appIconVariant: 'default' })),
          setAppIcon: options.setAppIcon || (async () => true),
        }
        const root = createRoot(document.getElementById('root'))
        root.render(React.createElement(React.Fragment, null, React.createElement(AppIconPicker), React.createElement(Toaster)))
        await until(() => document.querySelector('[role="group"]'))
        return {
          root,
          buttons: () => [...document.querySelectorAll('[role="group"] button')],
          chosen: () => document.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label'),
          status: () => document.querySelector('[role="status"]')?.textContent,
        }
      },
    }
  `)
}, 20_000)

afterAll(async () => { await renderer?.dispose() })

describe('图标设置真实 Chromium 交互', () => {
  test('Given 旧配色配置与延迟读取 When 打开外观设置 Then 加载时禁用且读取后归一化为白底黑银', async () => {
    const result = await renderer.run<{ loadingDisabled: boolean; chosen: string; ready: boolean }>(`
      let finishRead
      const picker = await window.iconRegression.mount({ getSettings: () => new Promise(resolve => { finishRead = resolve }) })
      await window.iconRegression.until(() => finishRead)
      const loadingDisabled = picker.buttons().every(button => button.disabled)
      finishRead({ appIconVariant: 'blue' })
      await window.iconRegression.until(() => picker.buttons().every(button => !button.disabled))
      return { loadingDisabled, chosen: picker.chosen(), ready: !picker.status().includes('正在读取') }
    `)
    expect(result).toEqual({ loadingDisabled: true, chosen: '白底黑银（默认）', ready: true })
  }, 20_000)

  test('Given 图标切换正在进行 When 重复点击且IPC返回失败 Then 仅提交一次并保留原图标与错误提示', async () => {
    const result = await renderer.run<{ calls: string[]; pendingDisabled: boolean; chosen: string; error: boolean }>(`
      const calls = []
      let finishSave
      const picker = await window.iconRegression.mount({ setAppIcon: id => { calls.push(id); return new Promise(resolve => { finishSave = resolve }) } })
      await window.iconRegression.until(() => picker.buttons().every(button => !button.disabled))
      const iceBlue = picker.buttons().find(button => button.getAttribute('aria-label') === '黑底冰蓝')
      iceBlue.click()
      iceBlue.click()
      await window.iconRegression.until(() => picker.buttons().every(button => button.disabled))
      const pendingDisabled = picker.buttons().every(button => button.disabled)
      finishSave(false)
      await window.iconRegression.until(() => picker.buttons().every(button => !button.disabled))
      await window.iconRegression.until(() => document.body.textContent.includes('图标切换失败'))
      return { calls, pendingDisabled, chosen: picker.chosen(), error: document.body.textContent.includes('图标切换失败') }
    `)
    expect(result).toEqual({ calls: ['ice-blue'], pendingDisabled: true, chosen: '白底黑银（默认）', error: true })
  }, 20_000)

  test('Given 读取配置失败 When 点击重试后成功保存新款 Then 清除读取错误并更新选中图标', async () => {
    const result = await renderer.run<{ reads: number; errorDisabled: boolean; selectedBefore: string; selectedAfter: string; calls: string[] }>(`
      let reads = 0
      const calls = []
      const picker = await window.iconRegression.mount({
        getSettings: async () => { if (++reads === 1) throw new Error('读取失败'); return { appIconVariant: 'ice-blue' } },
        setAppIcon: async id => { calls.push(id); return true },
      })
      await window.iconRegression.until(() => document.querySelector('[role="alert"]'))
      const errorDisabled = picker.buttons().every(button => button.disabled)
      document.querySelector('[role="alert"] button').click()
      await window.iconRegression.until(() => picker.buttons().every(button => !button.disabled))
      const selectedBefore = picker.chosen()
      picker.buttons().find(button => button.getAttribute('aria-label') === '白底蓝银').click()
      await window.iconRegression.until(() => picker.chosen() === '白底蓝银')
      return { reads, errorDisabled, selectedBefore, selectedAfter: picker.chosen(), calls }
    `)
    expect(result).toEqual({ reads: 2, errorDisabled: true, selectedBefore: '黑底冰蓝', selectedAfter: '白底蓝银', calls: ['sapphire-silver'] })
  }, 20_000)

  test('Given Windows或Linux When 点击图标预览 Then 保持禁用与平台提示且不提交切换IPC', async () => {
    const result = await renderer.run<{ platform: string; disabled: boolean; calls: number; status: string }[]>(`
      const results = []
      for (const platform of ['Win32', 'Linux x86_64']) {
        let calls = 0
        const picker = await window.iconRegression.mount({ platform, setAppIcon: async () => { calls++; return true } })
        await window.iconRegression.until(() => !picker.status()?.includes('正在读取'))
        picker.buttons()[1].click()
        await window.iconRegression.delay()
        results.push({ platform, disabled: picker.buttons().every(button => button.disabled), calls, status: picker.status() })
        picker.root.unmount()
      }
      return results
    `)
    expect(result).toEqual([
      { platform: 'Win32', disabled: true, calls: 0, status: 'Windows 系统暂不支持更换应用图标。' },
      { platform: 'Linux x86_64', disabled: true, calls: 0, status: '当前系统暂不支持动态更换应用图标。' },
    ])
  }, 20_000)
})
