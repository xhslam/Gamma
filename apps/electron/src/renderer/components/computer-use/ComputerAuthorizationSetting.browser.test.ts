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
      let preferences = { riskPolicy:options?.riskPolicy??'standard',shareObservations:true,systemPermissionsDismissed:false,allowedApps:{'app.one':'always','app.two':'denied'} }
      window.writes=[];window.permissionRequests=[];window.permissions={accessibility:false,screen:false,listen:false,post:false}
      window.electronAPI={
        getComputerPreferences:async()=>{if(options?.readFails)throw Error('读取失败');return structuredClone(preferences)},
        updateComputerPreferences:async update=>{window.writes.push(update);if(options?.writeFails)throw Error('保存失败');preferences={...preferences,...update};return structuredClone(preferences)},
        requestComputerPermission:async permission=>{window.permissionRequests.push(permission);if(options?.permissionFails)throw Error('请求失败');if(!options?.permissionDeclined)window.permissions[permission]=true;return {phase:'disabled',permissions:window.permissions}},
        getComputerState:async()=>({phase:'disabled',permissions:window.permissions})
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
test('Given 已保存的允许/拒绝和外发同意 When 恢复默认并撤销外发 Then 只删除目标应用且显示新状态', async () => {
  const result = await renderer.run<{ writes: unknown[]; preserved: boolean; revoked: boolean }>(`
    window.mount()
    await window.until(()=>document.querySelector('[aria-label="恢复默认 app.one"]'))
    document.querySelector('[aria-label="恢复默认 app.one"]').click()
    await window.until(()=>!document.querySelector('[aria-label="恢复默认 app.one"]'))
    const preserved=!!document.querySelector('[aria-label="恢复默认 app.two"]')
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='撤销外发同意').click()
    await window.until(()=>document.body.textContent.includes('尚未同意桌面观察外发'))
    return {writes:window.writes,preserved,revoked:!document.body.textContent.includes('撤销外发同意')}
  `)
  expect(result).toEqual({ writes: [{ allowedApps: { 'app.two': 'denied' } }, { shareObservations: false }], preserved: true, revoked: true })
}, 20_000)
test('Given 保存失败 When 撤销 Then 原授权仍显示且提供错误', async () => {
  const result = await renderer.run<{ kept: boolean; error: string }>(`
    window.mount({writeFails:true})
    await window.until(()=>document.querySelector('[aria-label="恢复默认 app.one"]'))
    document.querySelector('[aria-label="恢复默认 app.one"]').click()
    await window.until(()=>document.querySelector('[role="alert"]'))
    return {kept:!!document.querySelector('[aria-label="恢复默认 app.one"]'),error:document.querySelector('[role="alert"]').textContent}
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

test('Given 用户只有基础权限需求 When 授权Gamma辅助功能 Then 不请求录屏且不写入应用偏好', async () => {
  const result = await renderer.run(`
    window.mount()
    await window.until(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='授权 Gamma 辅助功能'))
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='授权 Gamma 辅助功能').click()
    await window.until(()=>document.body.textContent.includes('Gamma 辅助功能已授权。'))
    return {requests:window.permissionRequests,writes:window.writes,text:document.body.textContent}
  `)
  expect(result).toMatchObject({ requests: ['accessibility'], writes: [] })
  expect((result as { text: string }).text).toContain('可选的录屏权限')
  expect((result as { text: string }).text).toContain('未保存授权决定的应用会请求确认')
})

test('Given 三种风险策略 When 展示应用授权说明 Then 仅宽松策略说明默认可用，已有拒绝均保留', async () => {
  for (const policy of ['relaxed', 'standard', 'strict']) {
    const result = await renderer.run<{ text: string; kept: boolean; writes: unknown[] }>(`
      window.mount({riskPolicy:${JSON.stringify(policy)}})
      await window.until(()=>document.querySelector('[aria-label="恢复默认 app.two"]'))
      return {text:document.body.textContent,kept:!!document.querySelector('[aria-label="恢复默认 app.two"]'),writes:window.writes}
    `)
    expect(result.text).toContain(policy === 'relaxed' ? '宽松策略下，应用默认可用于当前任务' : '未保存授权决定的应用会请求确认')
    expect(result.text).toContain('已保存的拒绝仍会阻止操作')
    expect(result.kept).toBe(true)
    expect(result.writes).toEqual([])
  }
})

test('Given 用户未开启可选录屏 When 返回设置 Then 基础操作不被标记为失败且保留授权', async () => {
  const result = await renderer.run(`
    window.mount({permissionDeclined:true})
    await window.until(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='开启可选画面预览'))
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='开启可选画面预览').click()
    await window.until(()=>document.body.textContent.includes('录屏尚未开启'))
    return {requests:window.permissionRequests,writes:window.writes,errors:document.querySelectorAll('[role="alert"]').length,text:document.body.textContent}
  `)
  expect(result).toMatchObject({ requests: ['screen'], writes: [], errors: 0 })
  expect((result as { text: string }).text).toContain('辅助功能操作仍可继续')
})

test('Given 系统授权请求失败 When 在设置中操作 Then 显示重试说明并保留既有应用决定', async () => {
  const result = await renderer.run(`
    window.mount({permissionFails:true})
    await window.until(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='开启可选画面预览'))
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='开启可选画面预览').click()
    await window.until(()=>document.body.textContent.includes('未能完成系统授权'))
    return {writes:window.writes,kept:!!document.querySelector('[aria-label="恢复默认 app.two"]'),retry:!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='开启可选画面预览').disabled}
  `)
  expect(result).toEqual({ writes: [], kept: true, retry: true })
})
