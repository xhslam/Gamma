import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'
let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { ComputerModals } from '@/components/computer-use/ComputerModals'
    import { ComputerAuthorizationSetting } from '@/components/computer-use/ComputerAuthorizationSetting'
    window.mount = options => {
      let preferences = { riskPolicy:'standard',shareObservations:true,systemPermissionsDismissed:false,allowedApps:{'app.one':'always','app.two':'denied'} }
      window.writes=[]
      window.electronAPI={
        getComputerPreferences:async()=>{if(options?.readFails)throw Error('读取失败');return structuredClone(preferences)},
        updateComputerPreferences:async update=>{window.writes.push(update);if(options?.writeFails)throw Error('保存失败');preferences={...preferences,...update};return structuredClone(preferences)}
      }
      createRoot(document.getElementById('root')).render(React.createElement(ComputerAuthorizationSetting))
    }
    window.mountModal=()=>{
      window.writes=[]
      window.electronAPI={onComputerAppAuthRequested:listener=>{window.askAppAuth=listener;return ()=>{}},onComputerRiskConfirmRequested:()=>()=>{},decideComputerAppAuth:async(id,decision)=>{window.writes.push({id,decision});return true}}
      createRoot(document.getElementById('root')).render(React.createElement(ComputerModals))
    }
    window.until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('未达到预期DOM状态')}
  `)
}, 20_000)
afterAll(async () => { await renderer?.dispose() })
test('Given 已保存的允许/拒绝和外发同意 When 恢复询问并撤销外发 Then 只删除目标应用且显示新状态', async () => {
  const result = await renderer.run<{ writes: unknown[]; preserved: boolean; revoked: boolean }>(`
    window.mount()
    await window.until(()=>document.querySelector('[aria-label="恢复询问 app.one"]'))
    document.querySelector('[aria-label="恢复询问 app.one"]').click()
    await window.until(()=>!document.querySelector('[aria-label="恢复询问 app.one"]'))
    const preserved=!!document.querySelector('[aria-label="恢复询问 app.two"]')
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='撤销外发同意').click()
    await window.until(()=>document.body.textContent.includes('尚未同意桌面观察外发'))
    return {writes:window.writes,preserved,revoked:!document.body.textContent.includes('撤销外发同意')}
  `)
  expect(result).toEqual({ writes: [{ allowedApps: { 'app.two': 'denied' } }, { shareObservations: false }], preserved: true, revoked: true })
}, 20_000)
test('Given 保存失败 When 撤销 Then 原授权仍显示且提供错误', async () => {
  const result = await renderer.run<{ kept: boolean; error: string }>(`
    window.mount({writeFails:true})
    await window.until(()=>document.querySelector('[aria-label="恢复询问 app.one"]'))
    document.querySelector('[aria-label="恢复询问 app.one"]').click()
    await window.until(()=>document.querySelector('[role="alert"]'))
    return {kept:!!document.querySelector('[aria-label="恢复询问 app.one"]'),error:document.querySelector('[role="alert"]').textContent}
  `)
  expect(result.kept).toBe(true)
  expect(result.error).toContain('撤销失败')
}, 20_000)
test('Given 读取失败 When 打开授权设置 Then 不暴露写入入口且可以重试', async () => {
  const result = await renderer.run<{ writes: unknown[]; buttons: string[]; error: string }>(`
    window.mount({readFails:true})
    await window.until(()=>document.querySelector('[role="alert"]'))
    return {writes:window.writes,buttons:Array.from(document.querySelectorAll('button')).map(b=>b.textContent),error:document.querySelector('[role="alert"]').textContent}
  `)
  expect(result.writes).toEqual([])
  expect(result.buttons).toEqual(['重试读取'])
  expect(result.error).toContain('无法读取')
}, 20_000)

test('Given 应用授权弹窗 When 按Escape关闭 Then IPC发送cancelled而不是永久拒绝', async () => {
  const result = await renderer.run<unknown[]>(`
    window.mountModal()
    await window.until(()=>window.askAppAuth)
    window.askAppAuth({requestId:'cancel-case',appName:'App',bundleId:'app.fixture'})
    await window.until(()=>document.querySelector('[role="dialog"]'))
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    await window.until(()=>window.writes.length===1)
    return window.writes
  `)
  expect(result).toEqual([{ id: 'cancel-case', decision: 'cancelled' }])
}, 20_000)
