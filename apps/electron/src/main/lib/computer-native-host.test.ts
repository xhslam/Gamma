import { describe, expect, test } from 'bun:test'
import { ComputerNativeHost, createComputerNativeHostError, getComputerDiagnosticCode } from './computer-native-host'
import { classifyComputerFailure } from './computer-failure-policy'

test('Given 文本动作诊断 When 原生错误包含私密文本 Then 只允许固定枚举错误码', () => {
  expect(getComputerDiagnosticCode(createComputerNativeHostError({ code: 'ax-timeout', message: 'PRIVATE_TEXT' }))).toBe('ax-timeout')
  expect(getComputerDiagnosticCode(createComputerNativeHostError({ code: 'PRIVATE_TEXT', message: 'PRIVATE_TEXT' }))).toBeNull()
  expect(getComputerDiagnosticCode(Object.assign(new Error('PRIVATE_TEXT'), { code: 'PRIVATE_TEXT' }))).toBeNull()
})

test('Given 原生身份与读取失败 When 经跨进程错误映射 Then 保留固定诊断码且仍保守暂停', () => {
  for (const code of ['process-identity', 'window-metadata', 'ax-budget', 'capture-failed', 'capture-too-large', 'visual-unavailable', 'event-create', 'input-too-large', 'invalid-request', 'unknown-method', 'owner-busy', 'owner-lock']) {
    const error = createComputerNativeHostError({ code, message: 'PRIVATE_TEXT' })
    expect(getComputerDiagnosticCode(error)).toBe(code)
    expect(error.message).not.toContain('PRIVATE_TEXT')
    expect(classifyComputerFailure({ code: error.code, phase: 'prepare' })).toBe('pause')
  }
})

function host(code: string, maxLineBytes?: number): ComputerNativeHost {
  return new ComputerNativeHost(() => ({ executable: process.execPath, args: ['-e', `const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const q=JSON.parse(line);if(q.method==='stop'){process.exit(0)};${code}})`] }), { maxLineBytes })
}
describe('Given 私有原生 helper 通道（使用无桌面能力的 Bun fixture）', () => {
  test('When 启动 helper Then 显式传递日志路径与应用版本', async () => {
    const native = new ComputerNativeHost(() => ({ executable: process.execPath, args: ['-e', `
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const q = JSON.parse(line); if (q.method === 'stop') process.exit(0);
        process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{path:process.env.GAMMA_COMPUTER_LOG_PATH,version:process.env.GAMMA_APP_VERSION}})+'\\n');
      });
    `] }), { loggerEnvironment: () => ({ logPath: '/tmp/gamma-test.log', version: '1.2.3' }) })
    try { await expect(native.call('status')).resolves.toEqual({ path: '/tmp/gamma-test.log', version: '1.2.3' }) }
    finally { await native.terminate() }
  })
  test('When 读取日志配置失败 Then 仍可启动 helper', async () => {
    const native = new ComputerNativeHost(() => ({ executable: process.execPath, args: ['-e', `
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const q = JSON.parse(line); if (q.method === 'stop') process.exit(0);
        process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{ready:true}})+'\\n');
      });
    `] }), { loggerEnvironment: () => { throw new Error('日志不可用') } })
    try { await expect(native.call('status')).resolves.toEqual({ ready: true }) }
    finally { await native.terminate() }
  })
  test('When 请求成功 Then 保持UTF8并正确关联响应，停止等待进程退出', async () => {
    const native = host("process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{text:'中文🙂'}})+'\\n')")
    try { expect(await native.call('status')).toEqual({ text: '中文🙂' }) }
    finally { await native.terminate() }
    expect(await native.call('status')).toEqual({ text: '中文🙂' })
    await native.terminate()
  })
  test('When native错误带私密文本 Then 不透传到错误/日志', async () => {
    const native = host("process.stdout.write(JSON.stringify({id:q.id,ok:false,error:{message:'SECRET_AX_CANARY'}})+'\\n')")
    try { await expect(native.call('observe')).rejects.not.toThrow('SECRET_AX_CANARY') }
    finally { await native.terminate() }
  })
  test('When 响应过大 Then 关闭通道而非无限缓冲', async () => {
    const native = host("process.stdout.write('x'.repeat(2000))", 1000)
    await expect(native.call('observe')).rejects.toThrow()
    await native.terminate()
  })
  test('When 超时 Then 不重试，也不能把请求取消当成安全未执行', async () => {
    const native = host('')
    await expect(native.call('perform', {}, 50)).rejects.toThrow('副作用可能未知')
    await native.terminate()
  })
  test('When 任意命令或超大参数 Then 不启动进程', async () => {
    const native = new ComputerNativeHost(() => { throw new Error('不应创建进程') })
    await expect(native.call('exec')).rejects.toThrow('未允许')
    await expect(native.call('perform', { text: 'x'.repeat(1024 * 1024) })).rejects.toThrow('过大')
  })
})

describe('Given helper 生命周期通知', () => {
  test('When 父进程主动停止并重新连接 Then 退出回执不重复通知原生暂停', async () => {
    const native = host("process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{ready:true}})+'\\n')")
    let pauses = 0
    native.onStopped(() => { pauses++ })
    try {
      await native.call('status')
      await native.terminate()
      expect(pauses).toBe(0)
      await expect(native.call('status')).resolves.toEqual({ ready: true })
    } finally { await native.terminate() }
    expect(pauses).toBe(0)
  })

  test('When helper 非预期退出 Then 仍通知控制器撤销授权', async () => {
    const native = host("process.exit(1)")
    let pauses = 0
    native.onStopped(() => { pauses++ })
    await expect(native.call('status')).rejects.toThrow()
    expect(pauses).toBeGreaterThan(0)
    await native.terminate()
  })
})

test('Given 主动停止的 helper When 同时发出 stopped 事件与 close Then 不再次通知原生暂停', async () => {
  const native = new ComputerNativeHost(() => ({ executable: process.execPath, args: ['-e', `
    const r = require('node:readline').createInterface({ input: process.stdin });
    r.on('line', line => {
      const q = JSON.parse(line);
      if (q.method === 'stop') {
        process.stdout.write(JSON.stringify({ event: 'stopped', reason: 'parent-stop' }) + '\\n', () => process.exit(0));
      } else process.stdout.write(JSON.stringify({ id: q.id, ok: true, result: {} }) + '\\n');
    });
  `] }))
  let pauses = 0
  native.onStopped(() => { pauses++ })
  try { await native.call('status') } finally { await native.terminate() }
  expect(pauses).toBe(0)
})

describe('Given 自主Computer Use原生协议', () => {
  test('When 解析/准备/确认/列窗 Then 仅开放指定方法，裸openApp不可调用', async () => {
    const native = host("process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{method:q.method}})+'\\n')")
    try {
      for (const method of ['resolveApp', 'prepare', 'confirmation', 'listWindows']) {
        await expect(native.call(method)).resolves.toEqual({ method })
      }
      await expect(native.call('openApp', { appName: 'Notes' })).rejects.toThrow('未允许')
      await expect(native.call('focusWindow')).rejects.toThrow('未允许')
    } finally { await native.terminate() }
  })

  test('When native返回已知错误code与敏感message Then 仅暴露脱敏的code/reason', async () => {
    const native = host("process.stdout.write(JSON.stringify({id:q.id,ok:false,error:{code:'focus-changed',message:'SECRET_AX_CANARY'}})+'\\n')")
    try {
      await expect(native.call('prepare')).rejects.toMatchObject({ code: 'focus-changed', reason: '输入焦点已改变，请重新观察' })
    } finally { await native.terminate() }
  })

  test('When native返回未知错误code Then 不传播未知code或message', async () => {
    const native = host("process.stdout.write(JSON.stringify({id:q.id,ok:false,error:{code:'SECRET_AX_CANARY',message:'SECRET_AX_CANARY'}})+'\\n')")
    try {
      await expect(native.call('prepare')).rejects.toMatchObject({ code: 'native-failure' })
      await expect(native.call('prepare')).rejects.not.toThrow('SECRET_AX_CANARY')
    } finally { await native.terminate() }
  })

  test('When 用户接管触发stopped Then 仅通知一次且保留安全reason并回收helper', async () => {
    const native = host("process.stdout.write(JSON.stringify({event:'stopped',reason:'检测到用户操作，桌面控制已暂停'})+'\\n')")
    const reasons: Array<string | undefined> = []
    native.onStopped(reason => { reasons.push(reason) })
    await expect(native.call('perform')).rejects.toThrow()
    await native.terminate()
    expect(reasons).toEqual(['检测到用户操作，桌面控制已暂停'])
  })

  test('When stopped夹带未知内容 Then 不把敏感内容传播给renderer', async () => {
    const native = host("process.stdout.write(JSON.stringify({event:'stopped',reason:'SECRET_AX_CANARY'})+'\\n')")
    const reasons: Array<string | undefined> = []
    native.onStopped(reason => { reasons.push(reason) })
    await expect(native.call('perform')).rejects.toThrow()
    await native.terminate()
    expect(reasons).toEqual(['原生桌面控制已暂停'])
  })
})
