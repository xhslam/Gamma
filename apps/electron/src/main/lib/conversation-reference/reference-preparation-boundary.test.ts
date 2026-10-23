import { expect, test } from 'bun:test'

const probe = String.raw`
import { mock } from 'bun:test'
const base = BASE_PATH
let failure: Error | undefined
let storeReads = 0
let outboxReads = 0
let outboxFailure = false
mock.module(base+'agent-session-manager.ts', () => ({
  getAgentContextRefs: () => {storeReads++; if (failure) throw failure; return []},
  getAgentSessionSDKMessages: () => [],
  getAgentSessionMeta: () => ({id:'fixture',workspaceId:'fixture'}),
  isAgentSessionDeleting: () => false,
}))
mock.module(base+'agent-workspace-manager.ts', () => ({getAgentWorkspace:()=>({id:'fixture',slug:'fixture'}),getProjectFilesPath:()=>'/fixture',getWorkspaceAttachedDirectories:()=>[],getWorkspaceAttachedFiles:()=>[]}))
mock.module(base+'config-paths.ts', () => ({getAgentSessionWorkspacePath:()=>'/fixture',getAgentSessionMessagesPath:()=>'/fixture/messages.jsonl'}))
mock.module(base+'agent-service.ts', () => ({isAgentSessionBusy:()=>false,isAgentMessageQueuedOrDispatching:()=>false,listQueuedAgentMessages:()=>[],submitOrEnqueueAgentMessage:async()=>({disposition:'accepted'}),cancelAgentQueuedMessage:()=>false}))
mock.module(base+'agent-send-outbox.ts', () => ({AgentSendOutbox:class {list(){outboxReads++;if(outboxFailure)throw new Error('business storage failure');return []}},readPersistedOutboxUserIds:()=>new Set()}))
mock.module(base+'agent-send-outbox-recovery.ts', () => ({AgentSendOutboxRecovery:class {}}))
mock.module(base+'agent-send-outbox-retry-policy.ts', () => ({prepareOutboxRetryInput:()=>undefined}))
mock.module(base+'agent-message-submission-gate.ts', () => ({AgentMessageSubmissionGate:class {submit(){}}}))
const snapshot = await import(base+'conversation-reference/send-snapshot.ts')
const production = await import(base+'agent-send-outbox-service.ts')
const originalWarn = console.warn
const originalError = console.error
const logs: string[] = []
console.warn=(...args:unknown[])=>logs.push(args.map(String).join(' '))
console.error=(...args:unknown[])=>logs.push(args.map(String).join(' '))
try {
  const results=[]
  for (const [label,prepare] of [['snapshot-core',snapshot.prepareAgentReferenceInput],['production-service',production.prepareAgentReferenceInput]] as const) {
    storeReads=0;outboxReads=0;failure=new Error('disk unavailable')
    const noRefs=prepare({sessionId:'fixture',userMessage:'keep-body',contextRefIds:[]},'message-id')
    const explicitEmptySkipsReads=storeReads===0&&noRefs.userMessage==='keep-body'
    let genericExceptionContinues=false
    try { const output=prepare({sessionId:'fixture',userMessage:'keep-body',contextRefIds:['ref-a']},'message-id');genericExceptionContinues=output.contextRefs?.length===0 }catch{/* 只输出判定，不输出异常正文。 */}
    const canary='SYNTHETIC_PRIVATE_ERROR_CANARY'
    failure=new Error('引用解析失败 '+canary)
    const before=logs.length
    prepare({sessionId:'fixture',userMessage:'keep-body',contextRefIds:['ref-a']},'message-id')
    const rawErrorLeaksToLog=logs.slice(before).some(line=>line.includes(canary))
    const knownCredential='AIza'+'A'.repeat(35)
    failure=new Error('引用解析失败 '+knownCredential)
    const credentialBefore=logs.length
    prepare({sessionId:'fixture',userMessage:'keep-body',contextRefIds:['ref-a']},'message-id')
    const knownCredentialLeaksToLog=logs.slice(credentialBefore).some(line=>line.includes(knownCredential))
    results.push({label,explicitEmptySkipsReads,genericExceptionContinues,rawErrorLeaksToLog,knownCredentialLeaksToLog})
  }
  outboxFailure=true
  let businessErrorPropagates=false
  try { production.prepareAgentReferenceInput({sessionId:'fixture',userMessage:'keep',contextRefIds:[]},'id') } catch { businessErrorPropagates=true }
  originalWarn(JSON.stringify({results,businessErrorPropagates}))
} finally {console.warn=originalWarn;console.error=originalError}
`

test('Given 真实核心和生产outbox准备入口 When 引用存储抛普通异常 Then 明确无引用保留正文且不泄漏错误', () => {
  const child = Bun.spawnSync(['bun', '-e', probe.replace('BASE_PATH', JSON.stringify(new URL('../', import.meta.url).pathname))], { stdout: 'pipe', stderr: 'pipe' })
  expect(child.exitCode).toBe(0)
  const report = JSON.parse(new TextDecoder().decode(child.stderr).trim()) as { businessErrorPropagates: boolean; results: Array<{ label: string; explicitEmptySkipsReads: boolean; genericExceptionContinues: boolean; rawErrorLeaksToLog: boolean; knownCredentialLeaksToLog: boolean }> }
  expect(report.businessErrorPropagates).toBe(true)
  expect(report.results).toHaveLength(2)
  for (const result of report.results) {
    expect(result.explicitEmptySkipsReads).toBe(true)
    expect(result.genericExceptionContinues).toBe(true)
    expect(result.rawErrorLeaksToLog).toBe(false)
    expect(result.knownCredentialLeaksToLog).toBe(false)
  }
})
