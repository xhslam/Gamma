import { expect, test } from 'bun:test'
import { createComputerFixture } from '../../test-utils/computer-fixture'

function videoFrame(frameId = 'video-1') {
  return { mode: 'live', frame: { frameId, capturedAt: Date.now(), width: 960, height: 600, data: '/9j/2Q==' } }
}
const request = { sessionId: 'computer-test', live: true }

test('Given 工具观察不变 When 连续读取视频 Then 画面独立更新、不读取AX、不新增observe且坐标观察仍有效', async () => {
  let next = 'video-1'
  const f = createComputerFixture({ call: async method => method === 'previewFrame' ? videoFrame(next) : undefined })
  expect(await f.controller.getPreview(request)).toBeNull()
  const observed = await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
  const observations = f.calls.filter(call => call.method === 'observe').length
  const preview = (await f.controller.getPreview(request))!
  expect(preview.frame?.dataUrl).toStartWith('data:image/jpeg;base64,')
  expect(preview.frame?.frameId).toBe('video-1')
  expect(preview.frame?.frameId).not.toBe(observed.observationId!)
  expect(preview.activities.at(-1)).toMatchObject({ action: 'screenshot', status: 'returned' })
  expect(JSON.stringify(preview)).not.toContain('FIXTURE_AX')
  expect(await f.controller.getPreview({ ...request, sessionId: 'other-session' })).toBeNull()
  expect((await f.controller.getPreview({ ...request, frameId: 'video-1' }))?.frame?.dataUrl).toBeUndefined()
  next = 'video-2'
  expect((await f.controller.getPreview(request))?.frame?.frameId).toBe('video-2')
  expect(f.calls.filter(call => call.method === 'observe').length).toBe(observations)
  await f.controller.executeAutonomousAction({ action: 'click', coordinate: [0, 0], observationId: observed.observationId }, undefined, f.binding)
  expect(f.actions).toHaveLength(1)
  await f.controller.finishRun(f.binding)
  expect(await f.controller.getPreview(request)).toBeNull()
})

test('Given 旧预览 When 另一会话或旧run请求停止/暂停 Then 不影响当前运行', async () => {
  const f = createComputerFixture({ call: async method => method === 'previewFrame' ? videoFrame() : undefined })
  await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
  expect(() => f.controller.stopPreview('other', f.binding.runId)).toThrow('已结束')
  expect(() => f.controller.stopPreview(f.binding.sessionId, 'old-run')).toThrow('已结束')
  const before = f.calls.length
  expect(await f.controller.getPreview({ ...request, runId: 'old-run', live: false })).toBeNull()
  expect(f.calls.length).toBe(before)
  expect(await f.controller.getPreview(request)).not.toBeNull()
  await f.controller.stopPreview(f.binding.sessionId, f.binding.runId)
  expect(await f.controller.getPreview(request)).toBeNull()
  await f.controller.finishRun(f.binding)
})

test('Given 在途视频读取 When 撤销同意/停止 Then 迟到帧被丢弃', async () => {
  let release!: (value: unknown) => void
  const f = createComputerFixture({ call: async method => method === 'previewFrame' ? new Promise(resolve => { release = resolve }) : undefined })
  await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
  const pending = f.controller.getPreview(request)
  f.auth.updatePreferences({ shareObservations: false })
  release(videoFrame())
  expect(await pending).toBeNull()
  expect(await f.controller.getPreview(request)).toBeNull()
  await f.controller.finishRun(f.binding)
})

test('Given 收起预览或原生流不可用 When 读取 Then 关闭视频或清除帧，不回退工具截图', async () => {
  let available = false
  const f = createComputerFixture({ call: async (method, params) => method === 'previewFrame'
    ? params.enabled === false ? { mode: 'paused' } : available ? videoFrame() : { mode: 'unavailable' } : undefined })
  await f.controller.executeAutonomousAction({ action: 'screenshot' }, undefined, f.binding)
  expect(await f.controller.getPreview(request)).toMatchObject({ mode: 'unavailable', frame: undefined })
  available = true
  expect((await f.controller.getPreview(request))?.frame?.frameId).toBe('video-1')
  expect(await f.controller.getPreview({ ...request, live: false })).toMatchObject({ mode: 'paused', frame: undefined })
  expect(f.calls.at(-1)?.params.enabled).toBe(false)
  await f.controller.finishRun(f.binding)
})
