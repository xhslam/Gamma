import { afterEach, describe, expect, test } from 'bun:test'
import { YAML } from 'bun'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { artifactName, assembleRelease, digest, releaseTargets, releaseVersion, validateTarget, verifyDownloaded } from './release-artifacts'
import type { ReleaseTarget } from './release-artifacts'
import { writeTextFileAtomic } from '../src/main/lib/safe-file'

const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'gamma-release-test-'))
  temporary.push(root)
  return root
}
async function makeTarget(root: string, target: ReleaseTarget): Promise<string> {
  const directory = join(root, target)
  mkdirSync(directory, { recursive: true })
  const extensions = target.startsWith('mac') ? ['zip', 'dmg'] : target === 'win-x64' ? ['exe'] : ['AppImage', 'deb']
  const files: { url: string; sha512: string; size: number }[] = []
  for (const extension of extensions) {
    const name = artifactName(version, target, extension)
    const content = extension === 'zip' ? 'PK\x03\x04fixture' : extension === 'exe' ? 'MZfixture'
      : extension === 'AppImage' ? '\x7fELFfixture' : extension === 'deb' ? '!<arch>\nfixture' : 'dmg-fixture'
    writeTextFileAtomic(join(directory, name), content)
    if (['zip', 'dmg', 'exe'].includes(extension)) writeTextFileAtomic(join(directory, `${name}.blockmap`), 'fixture-map')
    if (extension !== 'deb') files.push({ url: name, sha512: await digest(join(directory, name), 'sha512'), size: Buffer.byteLength(content) })
  }
  const manifest = { version, files, path: files[0]!.url, sha512: files[0]!.sha512 }
  const name = target.startsWith('mac') ? 'latest-mac.yml' : target === 'win-x64' ? 'latest.yml' : 'latest-linux.yml'
  writeTextFileAtomic(join(directory, name), YAML.stringify(manifest))
  return directory
}

describe('Given 标签触发正式发布', () => {
  test('When 构建 Linux Then 沿用 electron-builder 的架构命名', () => {
    expect(artifactName('1.0.0', 'linux-x64', 'deb')).toBe('Gamma-1.0.0-linux-amd64.deb')
    expect(artifactName('1.0.0', 'linux-x64', 'AppImage')).toBe('Gamma-1.0.0-linux-x86_64.AppImage')
  })
  test('When 标签与版本一致 Then 接受；不一致或预发布版本则拒绝', () => {
    expect(releaseVersion(`v${version}`, version)).toBe(version)
    for (const tag of ['v0.19.237', version, 'v0.19.238-beta.1']) expect(() => releaseVersion(tag, version)).toThrow()
    expect(() => releaseVersion('v1.0.0-beta.1', '1.0.0-beta.1')).toThrow()
  })
})
describe('Given 各平台安装包与 electron-updater 清单', () => {
  test('When 所有平台齐全 Then 合并双架构且为每个附件生成校验和', async () => {
    const root = fixture()
    for (const target of releaseTargets) await makeTarget(root, target)
    const output = join(root, 'output')
    await assembleRelease(root, output, version)
    const manifest = YAML.parse(readFileSync(join(output, 'latest-mac.yml'), 'utf8')) as { files: { url: string }[] }
    expect(manifest.files).toHaveLength(4)
    expect(manifest.files.some(file => file.url.includes('mac-arm64.zip'))).toBe(true)
    expect(manifest.files.some(file => file.url.includes('mac-x64.zip'))).toBe(true)
    await verifyDownloaded(output, readFileSync(join(output, 'SHA256SUMS'), 'utf8'))
  })
  test('When 安装包篡改或 blockmap 缺失 Then 阻止发布', async () => {
    const root = fixture()
    const directory = await makeTarget(root, 'win-x64')
    const file = join(directory, `Gamma-${version}-win-x64.exe`)
    writeTextFileAtomic(file, 'MZtamper!')
    await expect(validateTarget(directory, 'win-x64', version)).rejects.toThrow('SHA-512')
    await makeTarget(root, 'win-x64')
    unlinkSync(`${file}.blockmap`)
    await expect(validateTarget(directory, 'win-x64', version)).rejects.toThrow()
  })
  test('When 清单版本错误、文件为空、大小错误或越界路径 Then 拒绝', async () => {
    const root = fixture()
    for (const mutation of ['version', 'empty', 'size', 'path']) {
      const directory = await makeTarget(root, 'mac-arm64')
      const path = join(directory, 'latest-mac.yml')
      const manifest = YAML.parse(readFileSync(path, 'utf8')) as { version: string; files: { url: string; size: number }[]; path: string }
      if (mutation === 'version') manifest.version = '0.0.1'
      if (mutation === 'empty') writeTextFileAtomic(join(directory, manifest.files[0]!.url), '')
      if (mutation === 'size') manifest.files[0]!.size += 1
      if (mutation === 'path') { manifest.files[0]!.url = '../outside.zip'; manifest.path = '../outside.zip' }
      writeTextFileAtomic(path, YAML.stringify(manifest))
      await expect(validateTarget(directory, 'mac-arm64', version)).rejects.toThrow()
    }
  })
  test('When 任一平台失败或 ZIP 缺失 Then 不生成可发布结果', async () => {
    const root = fixture()
    await makeTarget(root, 'mac-arm64')
    await expect(assembleRelease(root, join(root, 'output'), version)).rejects.toThrow()
    const directory = await makeTarget(root, 'mac-arm64')
    unlinkSync(join(directory, `Gamma-${version}-mac-arm64.zip`))
    await expect(validateTarget(directory, 'mac-arm64', version)).rejects.toThrow()
  })
  test('When 草稿重新下载的附件遗漏、损坏或混入额外文件 Then 保持草稿', async () => {
    const root = fixture()
    for (const target of releaseTargets) await makeTarget(root, target)
    const output = join(root, 'output')
    await assembleRelease(root, output, version)
    const expected = readFileSync(join(output, 'SHA256SUMS'), 'utf8')
    writeTextFileAtomic(join(output, 'extra'), 'extra')
    await expect(verifyDownloaded(output, expected)).rejects.toThrow('附件集合')
    unlinkSync(join(output, 'extra'))
    const name = readdirSync(output).find(name => name.endsWith('.exe'))!
    writeTextFileAtomic(join(output, name), 'MZtamper!')
    await expect(verifyDownloaded(output, expected)).rejects.toThrow('SHA-256')
    unlinkSync(join(output, name))
    await expect(verifyDownloaded(output, expected)).rejects.toThrow('附件集合')
  })
})


describe('Given 真实发布脚本与模拟 GitHub CLI', () => {
  async function publish(mode: string): Promise<{ code: number; log: string }> {
    const root = fixture()
    for (const target of releaseTargets) await makeTarget(root, target)
    const output = join(root, 'output')
    await assembleRelease(root, output, version)
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const fake = join(bin, 'gh')
    writeTextFileAtomic(fake, `#!${process.execPath}
import { appendFileSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.TEST_RELEASE_LOG, args.slice(0, 2).join(' ') + '\\n')
const mode = process.env.TEST_RELEASE_CASE
if (args[0] === 'api') {
  if (mode === 'api-failure') process.exit(1)
  console.log(JSON.stringify([[...(mode === 'published' ? [{ tag_name: process.env.TEST_RELEASE_TAG, draft: false }] : [])]]))
} else if (args[1] === 'download') {
  const destination = args[args.indexOf('--dir') + 1]
  const source = process.env.TEST_RELEASE_SOURCE
  for (const name of readdirSync(source)) copyFileSync(join(source, name), join(destination, name))
  if (mode === 'corrupt') writeFileSync(join(destination, readdirSync(source).find(name => name.endsWith('.exe'))), 'MZtampered')
}
`)
    chmodSync(fake, 0o755)
    const logFile = join(root, 'calls.log')
    const processResult = Bun.spawn([process.execPath, new URL('./publish-release.ts', import.meta.url).pathname, output, `v${version}`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'xhslam/Gamma', TEST_RELEASE_LOG: logFile, TEST_RELEASE_CASE: mode, TEST_RELEASE_TAG: `v${version}`, TEST_RELEASE_SOURCE: output },
      stdout: 'pipe', stderr: 'pipe',
    })
    // 同时消费输出，避免子进程管道积压。
    const [code] = await Promise.all([processResult.exited, new Response(processResult.stdout).text(), new Response(processResult.stderr).text()])
    return { code, log: readFileSync(logFile, 'utf8') }
  }
  test('When 上传及重新下载复核成功 Then 最后才公开', async () => {
    const result = await publish('success')
    expect(result.code).toBe(0)
    expect(result.log.trim().split('\n')).toEqual(['api --paginate', 'release create', 'release upload', 'release download', 'release edit'])
  })
  test('When 远端附件损坏 Then 不执行公开操作', async () => {
    const result = await publish('corrupt')
    expect(result.code).not.toBe(0)
    expect(result.log).toContain('release download')
    expect(result.log).not.toContain('release edit')
  })
  test('When API 失败或版本已经公开 Then 不上传也不覆盖', async () => {
    for (const mode of ['api-failure', 'published']) {
      const result = await publish(mode)
      expect(result.code).not.toBe(0)
      expect(result.log).not.toContain('release create')
      expect(result.log).not.toContain('release upload')
      expect(result.log).not.toContain('release edit')
    }
  })
})
