/** 发布门禁：校验各平台更新清单与安装包，再合并双架构 macOS 清单。 */
import { YAML } from 'bun'
import { createHash } from 'node:crypto'
import { createReadStream, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeTextFileAtomic } from '../src/main/lib/safe-file'

export const releaseTargets = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'] as const
export type ReleaseTarget = typeof releaseTargets[number]
interface UpdateFile { url: string; sha512: string; size: number; blockMapSize?: number }
interface UpdateManifest { version: string; files: UpdateFile[]; path: string; sha512: string; releaseDate?: string }

export function releaseVersion(tag: string, version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`) throw new Error(`标签 ${tag} 必须与应用版本 v${version} 一致（正式版本）`)
  return version
}

export async function digest(file: string, algorithm: 'sha512' | 'sha256'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(algorithm === 'sha512' ? 'base64' : 'hex')
}

function regularFile(directory: string, name: string): string {
  if (!name || /[/\\\r\n]/.test(name) || name === '.' || name === '..') throw new Error(`非法产物路径: ${name}`)
  const file = join(directory, name)
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`产物缺失或为空: ${name}`)
  return file
}

export function artifactName(version: string, target: ReleaseTarget, extension: string): string {
  // electron-builder 对 Linux 安装包使用平台惯例架构名。
  const suffix = target === 'linux-x64' && extension === 'AppImage' ? 'linux-x86_64'
    : target === 'linux-x64' && extension === 'deb' ? 'linux-amd64' : target
  return `Gamma-${version}-${suffix}.${extension}`
}

function manifestName(target: ReleaseTarget): string {
  return target.startsWith('mac-') ? 'latest-mac.yml' : target === 'win-x64' ? 'latest.yml' : 'latest-linux.yml'
}

function readManifest(directory: string, name: string, version: string): UpdateManifest {
  const value: unknown = YAML.parse(readFileSync(regularFile(directory, name), 'utf8'))
  if (!value || typeof value !== 'object') throw new Error(`无效更新清单: ${name}`)
  const manifest = value as UpdateManifest
  if (manifest.version !== version || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error(`更新清单版本或 files 无效: ${name}`)
  if (!manifest.files.some(file => file.url === manifest.path && file.sha512 === manifest.sha512)) throw new Error(`更新清单兼容字段与 files 不一致: ${name}`)
  return manifest
}

async function validateManifest(directory: string, manifest: UpdateManifest): Promise<void> {
  const seen = new Set<string>()
  for (const entry of manifest.files) {
    if (!entry || typeof entry.url !== 'string' || seen.has(entry.url)) throw new Error('更新文件重复或无效')
    seen.add(entry.url)
    const file = regularFile(directory, entry.url)
    if (!Number.isSafeInteger(entry.size) || entry.size !== lstatSync(file).size) throw new Error(`文件大小不匹配: ${entry.url}`)
    if (entry.sha512 !== await digest(file, 'sha512')) throw new Error(`SHA-512 不匹配: ${entry.url}`)
  }
}

export async function validateTarget(directory: string, target: ReleaseTarget, version: string): Promise<UpdateManifest> {
  const manifest = readManifest(directory, manifestName(target), version)
  await validateManifest(directory, manifest)
  const extensions = target.startsWith('mac-') ? ['dmg', 'zip'] : target === 'win-x64' ? ['exe'] : ['AppImage', 'deb']
  for (const extension of extensions) {
    const name = artifactName(version, target, extension)
    const file = regularFile(directory, name)
    // deb 用于手动安装；其它格式必须可由更新清单直接验证。
    if (extension !== 'deb' && !manifest.files.some(entry => entry.url === name)) throw new Error(`更新清单缺少 ${name}`)
    if (extension === 'dmg' || extension === 'zip' || extension === 'exe') regularFile(directory, `${name}.blockmap`)
    const header = Buffer.alloc(8)
    const handle = await Bun.file(file).slice(0, 8).arrayBuffer()
    Buffer.from(handle).copy(header)
    const valid = extension === 'exe' ? header.subarray(0, 2).toString() === 'MZ'
      : extension === 'zip' ? header.readUInt32LE(0) === 0x04034b50
      : extension === 'AppImage' ? header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      : extension === 'deb' ? header.toString() === '!<arch>\n' : true
    if (!valid) throw new Error(`安装包格式错误: ${name}`)
  }
  return manifest
}

export async function assembleRelease(input: string, output: string, version: string): Promise<void> {
  mkdirSync(output, { recursive: true })
  if (readdirSync(output).length) throw new Error('发布暂存目录必须为空')
  const manifests: Partial<Record<ReleaseTarget, UpdateManifest>> = {}
  for (const target of releaseTargets) {
    const directory = join(input, target)
    manifests[target] = await validateTarget(directory, target, version)
    for (const name of readdirSync(directory)) {
      if (name === manifestName(target) || !/\.(dmg|zip|exe|AppImage|deb|blockmap)$/.test(name)) continue
      if (!['dmg', 'zip', 'exe', 'AppImage', 'deb'].some(extension => name === artifactName(version, target, extension) || name === `${artifactName(version, target, extension)}.blockmap`)) throw new Error(`混入其它版本或架构: ${name}`)
      copyFileSync(regularFile(directory, name), join(output, name))
    }
  }
  for (const target of ['win-x64', 'linux-x64'] as const) {
    copyFileSync(join(input, target, manifestName(target)), join(output, manifestName(target)))
  }
  const arm = manifests['mac-arm64']!
  const intel = manifests['mac-x64']!
  const merged: UpdateManifest = { ...arm, files: [...arm.files, ...intel.files] }
  writeTextFileAtomic(join(output, 'latest-mac.yml'), YAML.stringify(merged))
  await validateManifest(output, merged)
  const names = readdirSync(output).sort()
  const checksums: string[] = []
  for (const name of names) checksums.push(`${await digest(join(output, name), 'sha256')}  ${name}`)
  writeTextFileAtomic(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
}

/** 使用上传前保留的可信校验表验证从草稿重新下载的全部文件，拒绝遗漏和额外文件。 */
export async function verifyDownloaded(directory: string, expectedChecksums: string): Promise<void> {
  const expected = expectedChecksums.trim().split('\n').map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (!match) throw new Error('无效 SHA256SUMS')
    return { sha256: match[1]!, name: match[2]! }
  })
  const names = [...expected.map(entry => entry.name), 'SHA256SUMS'].sort()
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(names)) throw new Error('Release 附件集合不完整或存在额外文件')
  if (readFileSync(regularFile(directory, 'SHA256SUMS'), 'utf8') !== expectedChecksums) throw new Error('远端校验表不匹配')
  for (const entry of expected) {
    if (await digest(regularFile(directory, entry.name), 'sha256') !== entry.sha256) throw new Error(`远端附件 SHA-256 不匹配: ${entry.name}`)
  }
}

if (import.meta.main) {
  const [command, directory, targetOrOutput, tag] = process.argv.slice(2)
  const version = releaseVersion(tag ?? '', JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string)
  if (!directory || !targetOrOutput) throw new Error('缺少产物目录与目标参数')
  if (command === 'validate' && releaseTargets.includes(targetOrOutput as ReleaseTarget)) await validateTarget(resolve(directory), targetOrOutput as ReleaseTarget, version)
  else if (command === 'assemble') await assembleRelease(resolve(directory), resolve(targetOrOutput), version)
  else throw new Error('用法: release-artifacts.ts validate <目录> <目标> <标签> 或 assemble <输入目录> <输出目录> <标签>')
  console.log(`发布产物校验通过: ${command} v${version}`)
}
