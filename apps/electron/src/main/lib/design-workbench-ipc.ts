import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { createDesignDeliveryService, saveDesignArchive } from './design-delivery'
import { getAgentWorkspace } from './agent-workspace-manager'
import { resolveAgentWorkbenchDir } from './agent-session-manager'
import { getDesignBundleSkillPath, runDesignArtifactCommand } from './design-bundle'
import { parseDesignTheme, matchesDesignEditorThemeUrl } from './design-theme-policy'
import type { DesignThemeSnapshot } from '@gamma/shared'
import type { IpcMain } from 'electron'
import { DESIGN_WORKBENCH_IPC } from '@gamma/shared'
import type { BrowserViewState, DesignArtifact, DesignCreateArtifactInput, DesignWorkbenchOpenResult } from '@gamma/shared'
import { getDesignBundleStatus, installDesignBundle } from './design-bundle'
import { createDesignArtifact, getDesignArtifact, listDesignArtifacts, openDesignArtifact } from './design-artifacts'
import { bindDesignAgentContext, unbindDesignAgentContext } from './design-agent-context'
import { startDesignComments, stopDesignComments } from './design-comments-service'
import { getAgentSessionMeta } from './agent-session-manager'
import { browserController } from './browser-controller'
import { hasAcknowledgedBrowserRiskDisclaimer } from './browser-risk-disclaimer'
import { getSettings } from './settings-service'
import { addDesignThumbnails, saveDesignThumbnail } from './design-thumbnails'
import { registerDesignEditorOrigin } from './design-browser-policy'

const registeredEditorUrls = new Set<string>()
const editorTabs = new Map<string, { sessionId: string; tabId: string; artifact: DesignArtifact; url: string }>()

const delivery = createDesignDeliveryService({
  getArtifact: getDesignArtifact,
  getWorkbench: async (artifact) => {
    const root = resolveAgentWorkbenchDir(getAgentWorkspace(artifact.workspaceId), artifact.sessionId)
    if (!root) throw new Error('设计会话工作台不可用')
    return root
  },
  getSkillPath: (artifact) => getDesignBundleSkillPath(artifact.kind),
  flush: async (artifact) => {
    const entry = editorTabs.get(artifact.id)
    if (!entry || entry.sessionId !== artifact.sessionId) throw new Error('请先打开设计作品，再下载或添加到对话')
    await browserController.flushDesignEditor(entry.sessionId, entry.tabId, entry.url)
  },
  archive: async (artifact, root, output) => {
    await runDesignArtifactCommand(artifact.kind, ['archive', root, '--out', output], { timeoutMs: 120_000 })
  },
})

/** 只有 Gamma 主 renderer 可以打开工作台；编辑器自身没有此 preload。 */
export function registerDesignWorkbenchHandlers(ipc: IpcMain, assertTrustedSender: (senderId: number) => void): void {
  ipc.handle(DESIGN_WORKBENCH_IPC.STATUS, (event) => {
    assertTrustedSender(event.sender.id)
    return getDesignBundleStatus()
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.INSTALL, (event, accepted: boolean) => {
    assertTrustedSender(event.sender.id)
    return installDesignBundle(accepted === true)
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.LIST, async (event, workspaceId: string) => {
    assertTrustedSender(event.sender.id)
    return addDesignThumbnails(await listDesignArtifacts(workspaceId), workspaceId)
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.CREATE, (event, input: DesignCreateArtifactInput) => {
    assertTrustedSender(event.sender.id)
    return createDesignArtifact(input)
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.OPEN, async (event, workspaceId: string, artifactId: string, rawTheme?: DesignThemeSnapshot): Promise<DesignWorkbenchOpenResult> => {
    assertTrustedSender(event.sender.id)
    const theme = rawTheme === undefined ? undefined : parseDesignTheme(rawTheme)
    const result = await openDesignArtifact(workspaceId, artifactId)
    if (!registeredEditorUrls.has(result.url)) {
      registerDesignEditorOrigin(result.url)
      registeredEditorUrls.add(result.url)
    }
    const session = getAgentSessionMeta(result.artifact.sessionId)
    if (!session || session.workspaceId !== workspaceId) throw new Error('作品关联会话已删除或不属于当前项目')
    bindDesignAgentContext(result.artifact)
    const previous = editorTabs.get(artifactId)
    const state = browserController.getState(session.id)
    let browser: BrowserViewState
    if (!hasAcknowledgedBrowserRiskDisclaimer(getSettings())) {
      // 第一次仍由标准 BrowserPanel 告知并确认，不绕过受管浏览器边界。
      browser = await browserController.open(session.id)
    } else if (previous?.sessionId === session.id && state?.tabs.some((tab) => tab.tabId === previous.tabId)) {
      browserController.selectTab(session.id, previous.tabId)
      browser = await browserController.navigateDisplay(session.id, result.url, previous.tabId)
    } else {
      browser = await browserController.createDisplayTab(session.id, result.url)
    }
    editorTabs.set(artifactId, { sessionId: session.id, tabId: browser.activeTabId, artifact: result.artifact, url: result.url })
    if (matchesDesignEditorThemeUrl(result.url, browser.tabs.find((tab) => tab.tabId === browser.activeTabId)?.url ?? '')) {
      await browserController.setDesignEditorLocale(session.id, browser.activeTabId, result.url)
      if (theme) await browserController.setDesignEditorTheme(session.id, browser.activeTabId, result.url, theme)
    }
    startDesignComments(result.artifact, event.sender)
    return { ...result, session, browser }
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.THEME, async (event, artifactId: string, rawTheme: unknown): Promise<void> => {
    assertTrustedSender(event.sender.id)
    const theme = parseDesignTheme(rawTheme)
    const entry = editorTabs.get(artifactId)
    if (!entry) throw new Error('请先打开 design 作品')
    const session = getAgentSessionMeta(entry.sessionId)
    if (!session || session.workspaceId !== entry.artifact.workspaceId) throw new Error('design 会话归属已失效')
    const state = browserController.getState(entry.sessionId)
    const tab = state?.tabs.find((item) => item.tabId === entry.tabId && matchesDesignEditorThemeUrl(entry.url, item.url))
      ?? state?.tabs.find((item) => matchesDesignEditorThemeUrl(entry.url, item.url))
    // 首次浏览器风险确认前保留空白页；确认后的页面状态会再次触发主题同步。
    if (!tab) return
    entry.tabId = tab.tabId
    await browserController.setDesignEditorTheme(entry.sessionId, tab.tabId, entry.url, theme)
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.HANDOFF, async (event, workspaceId: string, artifactId: string) => {
    assertTrustedSender(event.sender.id)
    return delivery.prepare(workspaceId, artifactId)
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.EXPORT, async (event, workspaceId: string, artifactId: string) => {
    assertTrustedSender(event.sender.id)
    const artifact = await getDesignArtifact(workspaceId, artifactId)
    const filename = artifact.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 100) || 'design'
    const options = { title: '下载完整设计稿', defaultPath: join(app.getPath('downloads'), `${filename}.zip`), filters: [{ name: '完整设计稿 ZIP', extensions: ['zip'] }], properties: ['showOverwriteConfirmation'] as Array<'showOverwriteConfirmation'> }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) return { canceled: true }
    const result = await delivery.prepare(workspaceId, artifactId)
    await saveDesignArchive(result.archivePath, selected.filePath)
    return { canceled: false, filePath: selected.filePath }
  })
  ipc.handle(DESIGN_WORKBENCH_IPC.CLOSE, async (event, artifactId: string) => {
    assertTrustedSender(event.sender.id)
    if (typeof artifactId !== 'string') throw new Error('无效作品 ID')
    stopDesignComments(artifactId)
    unbindDesignAgentContext(artifactId)
    const entry = editorTabs.get(artifactId)
    if (entry) {
      const state = browserController.getState(entry.sessionId)
      const tab = state?.tabs.find((item) => item.tabId === entry.tabId)
      if (tab && tab.url.startsWith(entry.url)) {
        try {
          const shot = await browserController.screenshot(entry.sessionId, entry.tabId, new AbortController().signal)
          if (shot.url.startsWith(entry.url)) saveDesignThumbnail(entry.artifact, shot.base64)
        } catch (error) { console.warn('[design] 未能更新作品缩略图:', error) }
      }
    }
  })
}
