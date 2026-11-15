import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { leftSidebarFixtureSource } from '../../../test-utils/left-sidebar-fixture'

const fixtureSource = leftSidebarFixtureSource
  .replace("import { LeftSidebar }", "import { applyThemeToDOM } from '@/atoms/theme'\n  import { LeftSidebar }")
  .replace("import { LeftSidebar }", "import { AppShell } from '@/components/app-shell/AppShell'\n  import { LeftSidebar }")
  .replace('agentSidePanelOpenMapAtom, agentSessionComponentTabsAtomFamily,', 'agentSidePanelOpenMapAtom, agentSessionComponentTabsAtomFamily, agentSessionComponentOpenMapAtom,')
  .replace('React.createElement(Layout, { width: options.width ?? 256 })', 'React.createElement(AppShell)')
  .replace('localStorage.clear();', `
    localStorage.clear();
    localStorage.setItem('auris.notes.terminal.webgl', 'false');
    localStorage.setItem('auris.notes.reading-theme', 'solarized');
  `)
  .replace('window.electronAPI = {', `
    const dataListeners = new Set();
    const callsToTerminal = { list: 0, resume: 0, kill: 0, reports: [] };
    const terminal = {
      id: 'running-shell', backend: 'pty', cwd: '/tmp', shell: '/bin/zsh',
      workspaceInstanceId: 'auris:terminal-focus', output: 'SHELL_READY\\r\\n\\x1b[32mANSI_GREEN\\x1b[0m', outputSequence: 1,
    };
    window.electronAPI = {
      terminalWorkbench: {
        list: async () => { callsToTerminal.list++; return [terminal]; },
        resume: async () => { callsToTerminal.resume++; return terminal; },
        kill: async () => { callsToTerminal.kill++; },
        resize: async () => {},
        onData: listener => { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit: () => () => {},
        reportVisiblePanes: async report => { callsToTerminal.reports.push(report); },
      },
  `)
  .replace('store.set(activeTabIdAtom, activeId);', `
    store.set(activeTabIdAtom, activeId);
    if (activeAgent) store.set(agentSidePanelOpenMapAtom, { [activeAgent]: true });
    if (options.legacy) store.set(agentSessionComponentOpenMapAtom, { parent: ['agy-terminal', 'markdown'] });
  `)
  .replace('root, calls,', `
    root, calls, callsToTerminal,
    setTheme: applyThemeToDOM,
    setView: view => store.set(activeViewAtom, view),
    emit: data => dataListeners.forEach(listener => listener({ sessionId: terminal.id, data, sequence: 2 })),
    errors: rendererErrors,
  `)

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(fixtureSource, {
    moduleStubs: {
      'components/tabs/TabContent.tsx': 'export function TabContent({tabId}){return tabId}',
      'components/design/DesignWorkspaceView.tsx': 'export function DesignWorkspaceView(){return null}',
      'components/markdown-workspace/MarkdownWorkspaceView.tsx': 'export default function MarkdownWorkspaceView(){return null}',
      'components/planning/PlanningView.tsx': 'export function PlanningView(){return null}',
      'components/automation/AutomationFormView.tsx': 'export function AutomationFormView(){return null}',
      'components/agent-skills/AgentSkillsView.tsx': 'export function AgentSkillsView(){return null}',
      'components/app-shell/RightSidePanel.tsx': 'export function RightSidePanel(){return "会话工作区"}',
      'components/tabs/TerminalLifecycleObserver.tsx': 'export function TerminalLifecycleObserver(){return null}',
      'components/computer-use/index.ts': 'export function ComputerModals(){return null}',
      'components/agent-skills/WorkspaceMemoryChangeObserver.tsx': 'export function WorkspaceMemoryChangeObserver(){return null}',
      'components/WindowControls.tsx': 'export function WindowControls(){return null}',
    },
  })
}, 180_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given Gamma 的终端工作台独立页', () => {
  test('When 从会话切换到独立工作区 Then 工作区内容贴合主面板四边', async () => {
    expect(await renderer.run<boolean[]>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      fixture.setTheme('light', false, 'cloud-drift');
      const panel = document.querySelector('[data-workspace-pane="agent"] > [data-panel="content"]');
      const fills = () => {
        const outer = panel.getBoundingClientRect(), inner = panel.firstElementChild.getBoundingClientRect();
        return ['top', 'bottom', 'left', 'right'].every(edge => Math.abs(outer[edge] - inner[edge]) < 1);
      };
      const results = [!fills()];
      for (const view of ['markdown', 'design', 'planning', 'agent-skills']) {
        fixture.setView(view);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        results.push(fills());
      }
      fixture.root.unmount();
      fixture.setTheme('light', false);
      return results;
    `)).toEqual([true, true, true, true, true])
  }, 30_000)

  test('When 从有右侧工作区的会话打开终端 Then 占满主内容区，切回会话后仍保留 Shell 和后台输出', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const button = fixture.button('终端工作台');
      const layout = document.querySelector('[data-testid="agent-workspace-layout"]');
      const workspace = () => layout.querySelector('[data-workspace-pane="workspace"]');
      const page = () => layout.querySelector('section[aria-label="终端工作台"]');
      const workspaceWasOpen = Boolean(workspace());
      button.click();
      await api.until(() => page()?.querySelector('.xterm-rows')?.textContent.includes('SHELL_READY'));
      const screen = page().querySelector('.xterm');
      const rect = page().getBoundingClientRect(), layoutRect = layout.getBoundingClientRect();
      const opened = {
        active: button.getAttribute('aria-current'),
        chatHidden: !layout.innerText.includes('parent'),
        rightPanelHidden: !workspace(),
        fillsMainArea: ['top', 'bottom', 'left', 'right'].every(edge => Math.abs(rect[edge] - layoutRect[edge]) < 1),
        selectedSession: fixture.state().agent,
      };
      fixture.row('parent').click();
      await api.until(() => page().hidden && workspace() && layout.innerText.includes('parent'));
      const afterReturn = {
        active: button.getAttribute('aria-current'),
        panes: fixture.callsToTerminal.reports.at(-1)?.visibleSessionIds,
        selectedSession: fixture.state().agent,
      };
      fixture.emit('BACKGROUND_OUTPUT');
      button.click();
      await api.until(() => !page().hidden && page().querySelector('.xterm-rows')?.textContent.includes('BACKGROUND_OUTPUT'));
      const { list, resume, kill } = fixture.callsToTerminal;
      const result = { workspaceWasOpen, opened, afterReturn, sameScreen: screen === page().querySelector('.xterm'), list, resume, kill, errors: fixture.errors };
      fixture.root.unmount();
      return result;
    `)).toEqual({
      workspaceWasOpen: true,
      opened: { active: 'page', chatHidden: true, rightPanelHidden: true, fillsMainArea: true, selectedSession: 'parent' },
      afterReturn: { active: null, panes: [], selectedSession: 'parent' },
      sameScreen: true,
      list: 1,
      resume: 1,
      kill: 0,
      errors: [],
    })
  }, 30_000)

  test('Given 旧阅读主题和已运行的终端 When 切换 Gamma 主题 Then 页面和终端实时同步', async () => {
    expect(await renderer.run<Record<string, boolean>>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      fixture.button('终端工作台').click();
      const page = () => document.querySelector('.terminal-focus');
      const rows = () => page()?.querySelector('.xterm-rows');
      const green = () => [...(rows()?.querySelectorAll('span') ?? [])].find(span => span.textContent.includes('ANSI_GREEN'));
      await api.until(() => green());
      const panel = page().closest('[data-panel="content"]');
      const read = () => ({
        page: getComputedStyle(page()).backgroundColor,
        panel: getComputedStyle(panel).backgroundColor,
        terminal: getComputedStyle(page().querySelector('.xterm-screen')).backgroundColor,
        ansi: getComputedStyle(green()).color,
        text: getComputedStyle(rows()).color,
        foreground: getComputedStyle(page()).color,
      });
      const light = read();
      fixture.setTheme('system', true);
      await api.until(() => read().ansi !== light.ansi);
      const dark = read();
      fixture.setTheme('light', true);
      await api.until(() => read().ansi === light.ansi);
      const matches = colors => colors.page === colors.panel && colors.terminal === colors.page && colors.text === colors.foreground;
      const result = { light: matches(light), dark: matches(dark), changed: light.page !== dark.page, restored: matches(read()) };
      fixture.root.unmount();
      return result;
    `)).toEqual({ light: true, dark: true, changed: true, restored: true })
  }, 30_000)

  test('Given 旧版本保存了终端和 Markdown 标签 When 恢复会话 Then 只清理终端侧栏标签', async () => {
    expect(await renderer.run<{ componentTabs: string[]; view: string }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ legacy: true });
      await api.until(() => fixture.state().componentTabs.join(',') === 'markdown');
      fixture.button('终端工作台').click();
      await api.until(() => document.querySelector('section[aria-label="终端工作台"]'));
      const { componentTabs, view } = fixture.state();
      fixture.root.unmount();
      return { componentTabs, view };
    `)).toEqual({ componentTabs: ['markdown'], view: 'agy-terminal' })
  }, 30_000)
})
