/** 只有本地及远端附件均通过校验，才把草稿切换成公开正式 Release。 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { releaseVersion, verifyDownloaded } from './release-artifacts'

const [directory, tag] = process.argv.slice(2)
if (!directory || !tag) throw new Error('用法: publish-release.ts <已校验产物目录> <版本标签>')
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
releaseVersion(tag, version)
const repo = process.env.GITHUB_REPOSITORY
if (repo !== 'xhslam/Gamma') throw new Error('仅允许发布到 xhslam/Gamma')
const gh = (args: string[]) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const source = resolve(directory)
const checksums = readFileSync(join(source, 'SHA256SUMS'), 'utf8')
await verifyDownloaded(source, checksums)
// 区分不存在与鉴权/网络失败，后两者必须停止。
interface Release { tag_name: string; draft: boolean }
const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`], { encoding: 'utf8' })) as Release[][]
const existing = pages.flat().find(release => release.tag_name === tag)
const newerPublished = pages.flat().some(release => {
  if (release.draft || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return false
  const current = version.split('.').map(Number)
  const other = release.tag_name.slice(1).split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (other[index] !== current[index]) return other[index]! > current[index]!
  }
  return false
})
if (existing && !existing.draft) throw new Error('该版本已公开，拒绝覆盖正式 Release')
if (!existing) gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', `Gamma ${tag}`, '--notes', 'macOS 使用临时 ad-hoc 签名，未公证；自动更新安装尚未验证。'])
gh(['release', 'upload', tag, ...readdirSync(source).map(name => join(source, name)), '--clobber'])
const downloaded = mkdtempSync(join(tmpdir(), 'gamma-release-'))
try {
  gh(['release', 'download', tag, '--dir', downloaded])
  await verifyDownloaded(downloaded, checksums)
  gh(['release', 'edit', tag, '--draft=false', `--latest=${!newerPublished}`])
  console.log(`已校验并公开正式 Release: https://github.com/${repo}/releases/tag/${tag}`)
} finally {
  rmSync(downloaded, { recursive: true, force: true })
}

