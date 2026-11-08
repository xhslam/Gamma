import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { APP_ICON_PREVIEWS } from '../../lib/app-icons'
import { AppIconGrid } from './AppIconPicker'
import { GammaLogoSettings } from './GammaLogoSettings'

describe('十三款应用图标选择与品牌素材', () => {
  test('Given 默认米白蓝绿 When 渲染图标选择器 Then 显示十三张真实图片并仅标记默认项', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="default" onSelect={() => {}} />)
    expect(html.match(/<img /g)).toHaveLength(13)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-label="米白蓝绿（默认）" aria-pressed="true"/)
    expect(html).toContain('gamma-ivory-teal.png')
    for (const icon of APP_ICON_PREVIEWS) {
      expect(icon.src).toBeTruthy()
      expect(html).toContain(icon.src)
    }
    expect(html).not.toContain('经典黑')
  })

  test('Given 用户保存晴空钴蓝 When 渲染当前选择 Then 只有晴空钴蓝保持选中且默认仍可选择', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="sky-cobalt" onSelect={() => {}} />)
    expect(html).toMatch(/aria-label="晴空钴蓝" aria-pressed="true"/)
    expect(html).toMatch(/aria-label="米白蓝绿（默认）" aria-pressed="false"/)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain('focus-visible:ring-2')
  })

  test('Given 正在读取或平台不支持 When 禁用图标选择器 Then 十三个按钮均禁用且保留预览', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="default" disabled onSelect={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(13)
    expect(html.match(/<img /g)).toHaveLength(13)
    expect(html).toContain('aria-busy="false"')
  })

  test('Given 图标正在切换 When 渲染pending项 Then 阻止重复提交并在确认前保留原选择', () => {
    const html = renderToStaticMarkup(<AppIconGrid activeIcon="default" pendingIcon="midnight-cyan" onSelect={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(13)
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/aria-label="米白蓝绿（默认）" aria-pressed="true"/)
    expect(html).toMatch(/aria-label="午夜冰青" aria-pressed="false"/)
    expect(html).toContain('animate-spin')
  })

  test('Given 打开品牌素材页 When 渲染下载列表 Then 与图标选择器共用十三款图片且每款均可下载', () => {
    const html = renderToStaticMarkup(<GammaLogoSettings />)
    expect(html.match(/<img /g)).toHaveLength(13)
    expect(html.match(/aria-label="下载/g)).toHaveLength(13)
    for (const icon of APP_ICON_PREVIEWS) {
      expect(html).toContain(icon.src)
      expect(icon.resourcePath).toBe(`gamma-logos/${icon.fileName}`)
    }
    expect(html).not.toContain('透明背景版本')
  })
})
