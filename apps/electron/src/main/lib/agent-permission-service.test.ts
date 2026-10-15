import { describe, expect, test } from 'bun:test'
import { AgentPermissionService, type CanUseToolOptions } from './agent-permission-service'
import type { PermissionRequest } from '@gamma/shared'

function permissionOptions(signal: AbortSignal, toolUseID: string): CanUseToolOptions {
  return { signal, toolUseID, displayName: '删除分组', description: '删除 Todo 分组' }
}

describe('Given 并发同名工具审批', () => {
  test('When 创建请求 Then 保留精确工具调用ID并隔离响应', async () => {
    const service = new AgentPermissionService()
    const requests: PermissionRequest[] = []
    const canUse = service.createCanUseTool('session-1', (request) => requests.push(request))
    const first = canUse('Write', { file_path: 'a.txt' }, permissionOptions(new AbortController().signal, 'call-1'))
    const second = canUse('Write', { file_path: 'b.txt' }, permissionOptions(new AbortController().signal, 'call-2'))
    expect(requests.map((request) => request.toolUseId)).toEqual(['call-1', 'call-2'])
    expect(requests[0]?.requestId).not.toBe(requests[1]?.requestId)
    service.respondToPermission(requests[1]!.requestId, 'deny', false)
    service.respondToPermission(requests[0]!.requestId, 'allow', false)
    expect((await first).behavior).toBe('allow')
    expect((await second).behavior).toBe('deny')
  })
})

describe('公开网络查询权限', () => {
  for (const toolName of ['WebSearch', 'WebFetch']) {
    test(`Given ${toolName} 只读工具 When 检查自动模式权限 Then 不创建用户审批等待`, async () => {
      const service = new AgentPermissionService()
      const requests: string[] = []
      const input = toolName === 'WebSearch' ? { query: 'Gamma' } : { url: 'https://example.com' }
      const result = await service.createCanUseTool('web-session', (request) => requests.push(request.requestId))(
        toolName,
        input,
        permissionOptions(new AbortController().signal, 'web-tool'),
      )

      expect(result).toEqual({ behavior: 'allow', updatedInput: input })
      expect(requests).toEqual([])
      expect(service.getPendingRequests()).toEqual([])
    })
  }
})


test('Given a destructive planning request When it is approved Then approval is single-use and cannot create a session whitelist', async () => {
  const service = new AgentPermissionService()
  const controller = new AbortController()
  let firstRequest: { requestId: string; allowAlways?: boolean } | undefined

  const firstResult = service.requestSingleApproval(
    'session-1',
    'mcp__planning__delete_group',
    { id: 'group-1', scope: 'todo' },
    permissionOptions(controller.signal, 'tool-1'),
    (request) => { firstRequest = request },
  )

  expect(firstRequest?.allowAlways).toBe(false)
  expect(service.respondToPermission(firstRequest!.requestId, 'allow', true)).toBe('session-1')
  expect((await firstResult).behavior).toBe('allow')

  let secondRequest: { requestId: string } | undefined
  const secondResult = service.createCanUseTool('session-1', (request) => { secondRequest = request })(
    'mcp__planning__delete_group',
    { id: 'group-2', scope: 'todo' },
    permissionOptions(controller.signal, 'tool-2'),
  )

  expect(secondRequest).toBeDefined()
  expect(service.respondToPermission(secondRequest!.requestId, 'deny', false)).toBe('session-1')
  expect((await secondResult).behavior).toBe('deny')
})
