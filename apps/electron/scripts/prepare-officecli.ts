#!/usr/bin/env bun
/**
 * 准备随 Gamma 安装包分发的 OfficeCLI 二进制。
 *
 * 每次 Electron build / dev 启动前按当前构建目标的平台与架构从 OfficeCLI 官方 GitHub
 * Release 取得固定版本，流式校验文件大小及 SHA-256，再原子写入 resources/officecli/。
 * 对交叉架构打包，可通过 OFFICECLI_PLATFORM / OFFICECLI_ARCH 指定安装包目标；默认使用宿主。
 * 该目录被 gitignore，避免将大体积第三方二进制提交进源码仓库。
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fetchWithRetry } from './fetch-with-retry'

const OFFICECLI_VERSION = 'v1.0.145'
const RELEASE_BASE_URL = `https://github.com/iOfficeAI/OfficeCLI/releases/download/${OFFICECLI_VERSION}`
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024
const OUTPUT_DIR = join(resolve(import.meta.dir, '..'), 'resources', 'officecli')
const targetPlatform = process.env.OFFICECLI_PLATFORM || process.platform
const targetArch = process.env.OFFICECLI_ARCH || process.arch
const outputName = targetPlatform === 'win32' ? 'officecli.exe' : 'officecli'

interface Asset {
  url: string
  assetId: number
  sha256: string
  sizeBytes: number
}

const assets: Record<string, Asset> = {
  'darwin-arm64': {
    url: `${RELEASE_BASE_URL}/officecli-mac-arm64`,
    assetId: 529408471,
    sha256: 'd66763a563bc844c3cc67036ebc7c4a9caa9319b9592814d9acd3706da231fc1',
    sizeBytes: 33_764_912,
  },
  'darwin-x64': {
    url: `${RELEASE_BASE_URL}/officecli-mac-x64`,
    assetId: 529408470,
    sha256: 'd7dc7013f7bf0af6345ae16a7913e6cf041947460d7f2fa3e024f0b27073d0a2',
    sizeBytes: 34_708_640,
  },
  'linux-arm64': {
    url: `${RELEASE_BASE_URL}/officecli-linux-arm64`,
    assetId: 529408473,
    sha256: 'd38233bb7df4f0f5fb40313de1f00c0f0e575dc96b4164742709711ceec148c5',
    sizeBytes: 34_737_671,
  },
  'linux-x64': {
    url: `${RELEASE_BASE_URL}/officecli-linux-x64`,
    assetId: 529408475,
    sha256: '449f0e6a1298e3c6d7da792d26ab53d04ba77bd990f299b51123c7aef383d2ce',
    sizeBytes: 35_319_717,
  },
  'win32-arm64': {
    url: `${RELEASE_BASE_URL}/officecli-win-arm64.exe`,
    assetId: 529408478,
    sha256: '9ab800745ef06f4d30b8fd41729c516a4b28c86a24a32af8764d12a6a5226d57',
    sizeBytes: 33_824_692,
  },
  'win32-x64': {
    url: `${RELEASE_BASE_URL}/officecli-win-x64.exe`,
    assetId: 529408477,
    sha256: '760696b262f3d6bd2cd174577220d54541b6e1e04ec58dee051f1897395638b8',
    sizeBytes: 33_386_408,
  },
}

function fail(message: string): never {
  throw new Error(`[prepare:officecli] ${message}`)
}

function isAllowedDownloadUrl(url: URL): boolean {
  return url.protocol === 'https:' && (
    url.hostname === 'github.com'
    || url.hostname === 'api.github.com'
    || url.hostname === 'objects.githubusercontent.com'
    || url.hostname === 'release-assets.githubusercontent.com'
    || url.hostname === 'github-releases.githubusercontent.com'
    || url.hostname.endsWith('.githubusercontent.com')
  )
}

export async function fetchOfficialAsset(
  url: string,
  assetId: number,
  request: (target: URL, options: RequestInit) => Promise<Response> = fetchWithRetry,
): Promise<Response> {
  let target = new URL(url)
  let usingApi = false
  const switchToApi = () => {
    console.warn('[prepare:officecli] 普通下载路径不可用，改用 GitHub 官方资产 API')
    target = new URL(`https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/assets/${assetId}`)
    usingApi = true
  }
  for (let redirectsLeft = 5; redirectsLeft >= 0; redirectsLeft--) {
    if (!isAllowedDownloadUrl(target)) fail(`下载地址不受信任：${target.hostname}`)
    let response: Response
    try {
      response = await request(target, { redirect: 'manual', headers: { Accept: 'application/octet-stream' } })
    } catch (error) {
      if (usingApi) throw error
      switchToApi()
      redirectsLeft = 5
      continue
    }
    if (!usingApi && (response.status === 408 || response.status === 429 || response.status >= 500)) {
      await response.body?.cancel()
      switchToApi()
      redirectsLeft = 5
      continue
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirectsLeft === 0) fail('下载重定向无效或次数过多')
      target = new URL(location, target)
      continue
    }
    if (!response.ok) fail(`下载失败：HTTP ${response.status}`)
    return response
  }
  fail('下载重定向次数过多')
}

async function verifyExisting(filePath: string, asset: Asset): Promise<boolean> {
  try {
    if (!existsSync(filePath) || statSync(filePath).size !== asset.sizeBytes) return false
    const hash = new Bun.CryptoHasher('sha256')
    hash.update(await Bun.file(filePath).arrayBuffer())
    return hash.digest('hex').toLowerCase() === asset.sha256
  } catch {
    return false
  }
}

async function downloadAndVerify(asset: Asset, destination: string): Promise<void> {
  const response = await fetchOfficialAsset(asset.url, asset.assetId)
  if (!response.body) fail('下载响应为空')
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_DOWNLOAD_SIZE) fail('下载文件超过安全大小上限')

  const file = await open(destination, 'w', 0o700)
  const hash = createHash('sha256')
  let downloaded = 0
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      downloaded += value.byteLength
      if (downloaded > MAX_DOWNLOAD_SIZE) fail('下载文件超过安全大小上限')
      hash.update(value)
      await file.write(value)
    }
  } finally {
    await file.close()
  }

  if (downloaded !== asset.sizeBytes) fail(`下载文件大小不匹配：预期 ${asset.sizeBytes}，实际 ${downloaded}`)
  const actual = hash.digest('hex')
  if (actual.toLowerCase() !== asset.sha256) fail(`SHA-256 校验失败：预期 ${asset.sha256}，实际 ${actual}`)
}

async function main(): Promise<void> {
  const key = `${targetPlatform}-${targetArch}`
  const asset = assets[key]
  if (!asset) fail(`当前构建目标不受支持：${key}`)
  const outputPath = join(OUTPUT_DIR, outputName)

  if (targetPlatform !== process.platform) {
    fail(`OfficeCLI 资源必须在目标平台 Runner 上准备：目标 ${targetPlatform}，当前 ${process.platform}`)
  }

  await mkdir(OUTPUT_DIR, { recursive: true })
  if (await verifyExisting(outputPath, asset)) {
    if (targetPlatform !== 'win32') await chmod(outputPath, 0o755)
    console.log(`[prepare:officecli] 已验证 ${OFFICECLI_VERSION}（${key}）`)
  } else {
    const temporaryPath = `${outputPath}.download-${process.pid}-${Date.now()}`
    try {
      console.log(`[prepare:officecli] 下载并校验 ${OFFICECLI_VERSION}（${key}）`)
      await downloadAndVerify(asset, temporaryPath)
      if (targetPlatform !== 'win32') await chmod(temporaryPath, 0o755)
      await rename(temporaryPath, outputPath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
  }
}

if (import.meta.main) await main()
