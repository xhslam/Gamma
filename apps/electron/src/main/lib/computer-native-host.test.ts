import { describe, expect, test } from 'bun:test'
import { ComputerNativeHost } from './computer-native-host'

function host(code: string, maxLineBytes?: number): ComputerNativeHost {
  return new ComputerNativeHost(() => ({ executable: process.execPath, args: ['-e', `const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const q=JSON.parse(line);if(q.method==='stop'){process.exit(0)};${code}})`] }), { maxLineBytes })
}
describe('Given 私有原生 helper 通道（使用无桌面能力的 Bun fixture）', () => {
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
