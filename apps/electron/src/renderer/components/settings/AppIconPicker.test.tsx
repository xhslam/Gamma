import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { APP_ICON_PREVIEWS } from '../../lib/app-icons'
import { AppIconGrid } from './AppIconPicker'
import { PromaLogoSettings } from './PromaLogoSettings'

describe('十款应用图标选择与品牌素材', () => {
  test('Given 默认白底黑银 When 渲染图标选择器 Then 显示十张真实图片并仅标记默认项', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="default" onSelect={() => {}} />)
    expect(html.match(/<img /g)).toHaveLength(10)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-label="白底黑银（默认）" aria-pressed="true"/)
    expect(html).toContain('proma-black-silver-light.png')
    for (const icon of APP_ICON_PREVIEWS) {
      expect(icon.src).toBeTruthy()
      expect(html).toContain(icon.src)
    }
    expect(html).not.toContain('经典黑')
  })

  test('Given 用户保存白底蓝银 When 渲染当前选择 Then 只有白底蓝银保持选中且默认仍可选择', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="sapphire-silver" onSelect={() => {}} />)
    expect(html).toMatch(/aria-label="白底蓝银" aria-pressed="true"/)
    expect(html).toMatch(/aria-label="白底黑银（默认）" aria-pressed="false"/)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain('focus-visible:ring-2')
  })

  test('Given 正在读取或平台不支持 When 禁用图标选择器 Then 十个按钮均禁用且保留预览', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="default" disabled onSelect={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(10)
    expect(html.match(/<img /g)).toHaveLength(10)
    expect(html).toContain('aria-busy="false"')
  })

  test('Given 图标正在切换 When 渲染pending项 Then 阻止重复提交并在确认前保留原选择', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="default" pendingIcon="ice-blue" onSelect={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(10)
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/aria-label="白底黑银（默认）" aria-pressed="true"/)
    expect(html).toMatch(/aria-label="黑底冰蓝" aria-pressed="false"/)
    expect(html).toContain('animate-spin')
  })

  test('Given 打开品牌素材页 When 渲染下载列表 Then 与图标选择器共用十款图片且每款均可下载', () => {
    const html = renderToStaticMarkup(<PromaLogoSettings />)
    expect(html.match(/<img /g)).toHaveLength(10)
    expect(html.match(/aria-label="下载/g)).toHaveLength(10)
    for (const icon of APP_ICON_PREVIEWS) {
      expect(html).toContain(icon.src)
      expect(icon.resourcePath).toBe(`proma-logos/${icon.fileName}`)
    }
    expect(html).not.toContain('透明背景版本')
  })
})
