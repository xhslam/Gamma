import { parseDesignTheme, matchesDesignEditorThemeUrl } from './design-theme-policy'
import type { DesignThemeSnapshot } from '@gamma/shared'
import type { IpcMain } from 'electron'
import { DESIGN_WORKBENCH_IPC } from '@gamma/shared'
import type { BrowserViewState, DesignArtifact, DesignCreateArtifactInput, DesignWorkbenchOpenResult } from '@gamma/shared'
import { getDesignBundleStatus, installDesignBundle } from './design-bundle'
import { createDesignArtifact, listDesignArtifacts, openDesignArtifact } from './design-artifacts'
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
    if (theme && matchesDesignEditorThemeUrl(result.url, browser.tabs.find((tab) => tab.tabId === browser.activeTabId)?.url ?? '')) {
      await browserController.setDesignEditorTheme(session.id, browser.activeTabId, result.url, theme)
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
