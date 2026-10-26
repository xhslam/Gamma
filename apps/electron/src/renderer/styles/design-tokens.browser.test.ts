import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import '@/styles/globals.css';
    import '@/components/agent/process-timeline.css';
    import '@/components/welcome/code-field-background.css';
    document.getElementById('root').innerHTML = '<div id="panel"></div><div id="inset"></div><div id="secondary"></div><div id="tertiary"></div><div id="accent"></div><div id="border"></div><div class="process-plan-done"></div><div class="process-plan-failed"></div><pre class="shiki"></pre>';
    for(const [id,token] of Object.entries({panel:'card',inset:'muted',secondary:'muted-foreground',tertiary:'tertiary-foreground',accent:'primary'})) document.getElementById(id).style.color='hsl(var(--'+token+'))';
    document.getElementById('border').style.border='1px solid hsl(var(--border))';
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

interface ThemeSnapshot { background: string; text: string; panel: string; inset: string; secondary: string; tertiary: string; accent: string; border: string; status: string[] }

function snapshotScript(classes: string): string {
  return `document.documentElement.className=${JSON.stringify(classes)};
    return {background:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color,
      ...Object.fromEntries(['panel','inset','secondary','tertiary','accent'].map(id=>[id,getComputedStyle(document.getElementById(id)).color])),
      border:getComputedStyle(document.getElementById('border')).borderTopColor,
      status:[...document.querySelectorAll('.process-plan-done,.process-plan-failed')].map(e=>getComputedStyle(e).color)};`
}
const light: ThemeSnapshot = { background: 'rgb(250, 249, 245)', text: 'rgb(20, 20, 19)', panel: 'rgb(255, 255, 255)', inset: 'rgb(240, 238, 230)', secondary: 'rgb(94, 93, 89)', tertiary: 'rgb(138, 136, 127)', accent: 'rgb(217, 119, 87)', border: 'rgba(20, 20, 19, 0.08)', status: ['rgb(138, 136, 127)', 'rgb(217, 119, 87)'] }
const dark: ThemeSnapshot = { background: 'rgb(31, 30, 29)', text: 'rgb(240, 238, 230)', panel: 'rgb(38, 38, 36)', inset: 'rgb(48, 48, 46)', secondary: 'rgb(176, 174, 165)', tertiary: 'rgb(133, 131, 123)', accent: 'rgb(217, 119, 87)', border: 'rgba(250, 249, 245, 0.08)', status: ['rgb(133, 131, 123)', 'rgb(217, 119, 87)'] }

describe('Given 真实 Chromium 中的暖色主题', () => {
  test('When 使用亮色与暗色 Then 表面、三级文字、强调与透明边框精确匹配色板', async () => {
    expect(await renderer.run<ThemeSnapshot>(snapshotScript(''))).toEqual(light)
    expect(await renderer.run<ThemeSnapshot>(snapshotScript('dark'))).toEqual(dark)
  }, 30_000)

  test('When 恢复历史特殊主题或反复切换 Then 不重新引入色板之外的颜色', async () => {
    const themes = ['theme-ocean-light', 'theme-forest-light', 'theme-slate-light', 'dark theme-ocean-dark', 'dark theme-forest-dark', 'dark theme-slate-dark', 'dark theme-terminal-dark', '', 'dark']
    const snapshots = await renderer.run<ThemeSnapshot[]>(`return [${themes.map(theme => `(()=>{${snapshotScript(theme)}})()`).join(',')}];`)
    expect(snapshots).toEqual(themes.map(theme => theme.startsWith('dark') ? dark : light))
  }, 30_000)
})
