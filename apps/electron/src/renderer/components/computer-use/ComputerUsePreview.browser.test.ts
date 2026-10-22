import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { computerPreviewFixture } from '../../../test-utils/computer-preview-fixture'
let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(computerPreviewFixture) }, 30_000)
afterAll(async () => { await renderer?.dispose() })

test('Given 当前工具观察 When 展示、折叠并停止 Then 有时间、步骤和绑定当前run的停止入口', async () => {
  const result = await renderer.run(`
    await window.mount()
    const observed=document.body.textContent.includes('实时画面')
    document.querySelector('[aria-label="收起操作画面"]').click()
    await window.until(()=>!document.querySelector('img'))
    const stopVisible=!!document.querySelector('[aria-label="停止当前电脑操作"]')
    document.querySelector('[aria-label="展开操作画面"]').click()
    await window.until(()=>document.querySelector('img'))
    const steps=document.querySelector('details').textContent
    document.querySelector('[aria-label="停止当前电脑操作"]').click()
    await window.until(()=>!document.querySelector('section'))
    return {observed,stopVisible,steps,stops:window.stops}
  `)
  expect(result).toMatchObject({ observed: true, stopVisible: true, stops: [{ sessionId: 's1', runId: 'run1' }] })
  expect((result as { steps: string }).steps).toContain('查看应用')
})

test('Given 旧会话读取尚未返回 When 切换会话 Then 旧响应不显示到新会话', async () => {
  const result = await renderer.run(`
    await window.mount();window.blockRead=true
    window.listeners.forEach(fn=>fn({sessionId:'s1',phase:'active'}))
    await window.until(()=>window.releaseRead)
    window.select('s2')
    await window.until(()=>!document.querySelector('img'))
    window.blockRead=false;window.releaseRead()
    await new Promise(r=>setTimeout(r,80))
    return {images:document.querySelectorAll('img').length,cards:document.querySelectorAll('section').length}
  `)
  expect(result).toEqual({ images: 0, cards: 0 })
})

test('Given 读取在途 When 收到停止事件 Then 立即清图且迟到响应不能恢复画面', async () => {
  const result = await renderer.run(`
    await window.mount();window.blockRead=true
    window.listeners.forEach(fn=>fn({sessionId:'s1',phase:'active'}))
    await window.until(()=>window.releaseRead)
    window.listeners.forEach(fn=>fn({sessionId:'s1',phase:'stopping'}))
    await window.until(()=>!document.querySelector('img'))
    window.preview=null;window.releaseRead()
    await new Promise(r=>setTimeout(r,80))
    return document.querySelectorAll('img').length
  `)
  expect(result).toBe(0)
})

test('Given 断连或停止失败 When 操作预览 Then 不留旧截图假装实时并能重试', async () => {
  const result = await renderer.run(`
    await window.mount();window.failStop=true
    document.querySelector('[aria-label="停止当前电脑操作"]').click()
    await window.until(()=>document.querySelector('[role="alert"]'))
    const stopError=document.querySelector('[role="alert"]').textContent
    window.failRead=true;window.listeners.forEach(fn=>fn({sessionId:'s1',phase:'active'}))
    await window.until(()=>!document.querySelector('img'))
    const readError=document.querySelector('[role="alert"]').textContent
    window.failRead=false
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='重试').click()
    await window.until(()=>document.querySelector('img'))
    return {stopError,readError,recovered:!!document.querySelector('img')}
  `)
  expect(result).toMatchObject({ recovered: true })
  expect((result as { stopError: string }).stopError).toContain('停止未确认')
  expect((result as { readError: string }).readError).toContain('画面已清除')
})

test('Given 增量帧 When 相同视频帧或新的运行 Then 只复用同会话同运行的JPEG', async () => {
  const result = await renderer.run(`
    await window.mount()
    const previous=window.preview
    const delta=structuredClone(previous);delete delta.frame.dataUrl
    return {
      same:!!window.mergePreview(previous,delta).frame.dataUrl,
      run:!!window.mergePreview(previous,{...delta,runId:'run2'}).frame.dataUrl,
      session:!!window.mergePreview(previous,{...delta,sessionId:'s2'}).frame.dataUrl,
      remote:!!window.mergePreview(null,{...delta,frame:{...delta.frame,dataUrl:'https://example.com/private.png'}}).frame.dataUrl
    }
  `)
  expect(result).toEqual({ same: true, run: false, session: false, remote: false })
})

test('Given 原生退出未确认 When stop返回error状态 Then 保留重试停止入口且不显示成功', async () => {
  const result = await renderer.run(`
    await window.mount()
    window.electronAPI.stopComputerPreview=async()=>({phase:'error'})
    document.querySelector('[aria-label="停止当前电脑操作"]').click()
    await window.until(()=>document.querySelector('[role="alert"]'))
    return {error:document.querySelector('[role="alert"]').textContent,canStop:!document.querySelector('[aria-label="停止当前电脑操作"]').disabled}
  `)
  expect(result).toMatchObject({ canStop: true })
  expect((result as { error: string }).error).toContain('停止未确认')
})

test('Given 状态事件缺失且读取在途 When 停止成功 Then 旧响应也不能恢复已清除的画面', async () => {
  const result = await renderer.run(`
    await window.mount();window.blockRead=true
    window.listeners.forEach(fn=>fn({sessionId:'s1',phase:'active'}))
    await window.until(()=>window.releaseRead)
    window.electronAPI.stopComputerPreview=async()=>{window.preview=null;return {phase:'disabled'}}
    document.querySelector('[aria-label="停止当前电脑操作"]').click()
    await window.until(()=>!document.querySelector('img'))
    window.releaseRead()
    await new Promise(r=>setTimeout(r,80))
    return document.querySelectorAll('img').length
  `)
  expect(result).toBe(0)
})

test('Given 工具没有新截图 When 视频内容持续改变 Then 聊天画面连续刷新且收起后停止请求视频', async () => {
  const result = await renderer.run(`
    await window.mount()
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90
    const ctx=canvas.getContext('2d');let n=0;let changed=0
    const image=document.querySelector('img')
    const observer=new MutationObserver(records=>changed+=records.filter(record=>record.attributeName==='src').length)
    observer.observe(image,{attributes:true})
    const producer=setInterval(()=>{
      n++;ctx.fillStyle=n%2?'#ee4455':'#3355ee';ctx.fillRect(0,0,160,90)
      window.preview.frame={frameId:'video-'+n,capturedAt:Date.now(),width:160,height:90,dataUrl:canvas.toDataURL('image/jpeg')}
    },80)
    await new Promise(r=>setTimeout(r,650));clearInterval(producer);observer.disconnect()
    const activities=window.preview.activities.length
    document.querySelector('[aria-label="收起操作画面"]').click()
    await window.until(()=>!document.querySelector('img'))
    await new Promise(r=>setTimeout(r,150))
    const liveReads=window.reads.filter(read=>read.live).length
    await new Promise(r=>setTimeout(r,300))
    return {changed,activities,paused:window.reads.some(read=>!read.live),stoppedPolling:liveReads===window.reads.filter(read=>read.live).length}
  `)
  expect((result as { changed: number }).changed).toBeGreaterThanOrEqual(3)
  expect(result).toMatchObject({ activities: 2, paused: true, stoppedPolling: true })
})

test('Given 监控已连接 When 窗口不可见 Then 清除画面、关闭采集；重新可见后重连', async () => {
  const result = await renderer.run(`
    await window.mount()
    Object.defineProperty(document,'hidden',{value:true,configurable:true})
    document.dispatchEvent(new Event('visibilitychange'))
    await window.until(()=>!document.querySelector('img'))
    const liveReads=window.reads.filter(read=>read.live).length
    await new Promise(r=>setTimeout(r,250))
    const paused=window.reads.some(read=>!read.live)&&liveReads===window.reads.filter(read=>read.live).length
    Object.defineProperty(document,'hidden',{value:false,configurable:true})
    document.dispatchEvent(new Event('visibilitychange'))
    await window.until(()=>document.querySelector('img'))
    return {paused,reconnected:document.body.textContent.includes('实时画面')}
  `)
  expect(result).toEqual({ paused: true, reconnected: true })
})
