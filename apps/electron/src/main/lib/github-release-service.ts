/** 版本历史通过 Electron 网络栈使用系统代理；不读取渠道凭据或 GitHub Token。 */
import { net } from 'electron'
import { createGitHubReleaseClient } from './github-release-client'

const client = createGitHubReleaseClient({ fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' }) })
export const listReleases = client.listReleases
export const getLatestRelease = client.getLatestRelease
export const getReleaseByTag = client.getReleaseByTag
export const clearReleaseCache = client.clearReleaseCache
