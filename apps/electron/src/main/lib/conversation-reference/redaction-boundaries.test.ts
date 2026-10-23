import { expect, test } from 'bun:test'
import { redactCredentials } from './context-builder'

const jwt = [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from('{}').toString('base64url'),
  Buffer.from('synthetic-signature-only').toString('base64url'),
].join('.')

for (const [name, input, privatePart] of [
  ['转义双引号', 'APP_SECRET="prefix\\"VISIBLE_SECRET_SUFFIX"', 'VISIBLE_SECRET_SUFFIX'],
  ['转义单引号', "PASSWORD='prefix\\'VISIBLE_SECRET_SUFFIX'", 'VISIBLE_SECRET_SUFFIX'],
  ['纯数字令牌', 'APP_TOKEN=1234567890123456', '1234567890123456'],
  ['以KEY开头的数字凭据', 'KEY_SECRET=1234567890123456', '1234567890123456'],
  ['quoted null字符串', 'PASSWORD="null"', '"null"'],
  ['JWT合法短JSON payload', jwt, jwt],
  ['明确Authorization的短Bearer', 'Authorization: Bearer Ab3_def45', 'Ab3_def45'],
  ['JSON Authorization的短Bearer', '{"Authorization": "Bearer Ab3_def45"}', 'Ab3_def45'],
  ['URL密码含原始at符号', 'https://fixture:prefix@VISIBLE_SECRET_SUFFIX@example.invalid/path', 'VISIBLE_SECRET_SUFFIX'],
  ['quoted多行密码', 'PASSWORD="prefix\nVISIBLE_SECRET_SUFFIX"', 'VISIBLE_SECRET_SUFFIX'],
  ['不完整quoted密码', 'PASSWORD="prefix\nVISIBLE_SECRET_SUFFIX', 'VISIBLE_SECRET_SUFFIX'],
] as const) {
  test(`Given 合成凭据边界 When ${name} Then 不输出私密部分且幂等`, () => {
    const output = redactCredentials(input)
    expect(output).not.toContain(privatePart)
    expect(output).toContain('[REDACTED')
    expect(redactCredentials(output)).toBe(output)
  })
}

test('Given 普通表达式、计数与公共URL When 集中脱敏 Then 不改变非凭据内容', () => {
  for (const input of [
    'const tokenCount = 10', 'const maxTokens = 4096', 'KEY_ENTER = 13',
    'if (token === currentToken)', 'key => value', 'const key = getKey()',
    'TOKEN=process.env.ACCESS_TOKEN', 'let hasKey = true', 'TOKEN=null',
    'https://api.example.com?email=a@example.com', 'Bearer of good news',
    'eyJabc.short.jwt', 'ordinary prose about password and keyboard',
  ]) expect(redactCredentials(input)).toBe(input)
})

test('Given 330k ASCII正文或长非敏感赋值 When 脱敏 Then 子进程在两秒内完成而非二次扫描', async () => {
  const modulePath = new URL('./context-builder.ts', import.meta.url).pathname
  const script = `import { redactCredentials } from ${JSON.stringify(modulePath)};
    const text = 'A'.repeat(330_000);
    if (redactCredentials(text) !== text || redactCredentials(text + '=42') !== text + '=42') process.exit(1);`
  const child = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  const watchdog = setTimeout(() => child.kill(), 2_000)
  try { expect(await child.exited).toBe(0) } finally { clearTimeout(watchdog) }
}, 5_000)
