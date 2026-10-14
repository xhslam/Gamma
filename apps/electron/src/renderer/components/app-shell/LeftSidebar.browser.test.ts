import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { leftSidebarFixtureSource } from '../../../test-utils/left-sidebar-fixture'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(leftSidebarFixtureSource)
}, 180_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 Chromium 中的 Gamma 左侧栏', () => {
  test('When 在已有 Agent 会话点击工作区导航 Then 各入口打开既有组件并保持会话与项目', async () => {
    const result = await renderer.run<{
      brand: string; titleFits: boolean; labels: string[]; states: Array<{ label: string; tab: string; current: string }>
      components: string[]; session: string; project: string; view: string; hasLegacyPromotion: boolean
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const brand = document.querySelector('.gamma-wordmark').textContent;
      const title = [...fixture.row('parent').querySelectorAll('span')].find(span => span.textContent === '整理研究资料');
      const titleFits = title.clientWidth > 0 && title.scrollWidth <= title.clientWidth;
      const labels = [...document.querySelectorAll('nav[aria-label="工作区"] button')].map(button => button.getAttribute('aria-label'));
      const states = [];
      for (const [label, tab] of [['Markdown','markdown'],['Todo','todos'],['日程','calendar'],['项目记忆','memory'],['定时任务','automations'],['MCP/Skills','skills']]) {
        fixture.button(label).click();
        await api.until(() => fixture.state().workspaceTab === tab && fixture.button(label).getAttribute('aria-current') === 'page');
        states.push({ label, tab: fixture.state().workspaceTab, current: fixture.button(label).getAttribute('aria-current') });
      }
      const state = fixture.state(), hasLegacyPromotion = /Proma|商业版|升级 Pro/.test(document.body.innerText);
      fixture.root.unmount();
      return { brand, titleFits, labels, states, components: state.componentTabs, session: state.agent, project: state.workspace, view: state.view, hasLegacyPromotion };
    `)
    expect(result).toEqual({
      brand: 'Gamma', titleFits: true, labels: ['Markdown', 'Todo', '日程', '项目记忆', '定时任务', 'MCP/Skills'],
      states: [
        { label: 'Markdown', tab: 'markdown', current: 'page' }, { label: 'Todo', tab: 'todos', current: 'page' },
        { label: '日程', tab: 'calendar', current: 'page' }, { label: '项目记忆', tab: 'memory', current: 'page' },
        { label: '定时任务', tab: 'automations', current: 'page' }, { label: 'MCP/Skills', tab: 'skills', current: 'page' },
      ],
      components: ['markdown', 'todos', 'calendar', 'memory', 'automations', 'mcp', 'skills'],
      session: 'parent', project: 'project-a', view: 'conversations', hasLegacyPromotion: false,
    })
  }, 30_000)

  test('When 展开委派子会话、选择子会话与其他项目 Then 保留父会话观察和项目树的原有行为', async () => {
    const result = await renderer.run<{
      child: { parent: string; selected: string; tab: string; open: boolean }; other: { session: string; project: string }
      collapsed: boolean; expanded: boolean; controls: boolean
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const controls = ['折叠所有项目','从本地文件夹创建项目','新建空白项目','项目菜单'].every(label => !!fixture.button(label));
      fixture.button('展开子会话').click(); await api.until(() => fixture.row('child'));
      fixture.row('child').click(); await api.until(() => fixture.state().delegation === 'child');
      const childState = fixture.state(), child = { parent: childState.agent, selected: childState.delegation, tab: childState.workspaceTab, open: childState.workspaceOpen };
      fixture.row('other').click(); await api.until(() => fixture.state().agent === 'other');
      const other = { session: fixture.state().agent, project: fixture.state().workspace };
      const projectButton = [...document.querySelectorAll('button[aria-expanded]')].find(button => button.textContent.includes('第二个项目'));
      projectButton.click(); await api.until(() => !fixture.row('other')); const collapsed = projectButton.getAttribute('aria-expanded') === 'false';
      projectButton.click(); await api.until(() => fixture.row('other')); const expanded = projectButton.getAttribute('aria-expanded') === 'true';
      fixture.root.unmount(); return { child, other, collapsed, expanded, controls };
    `)
    expect(result).toEqual({
      child: { parent: 'parent', selected: 'child', tab: 'delegation', open: true },
      other: { session: 'other', project: 'project-b' }, collapsed: true, expanded: true, controls: true,
    })
  }, 30_000)

  test('When 从 Agent 切换 Chat 并选择对话 Then 选中状态、会话操作和无宿主导航继续可用', async () => {
    const result = await renderer.run<{
      pressed: string; selected: string; activeTab: string; actions: boolean; primary: boolean
      fallback: Array<{ label: string; view: string; planning: string }>
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const chatButton = [...document.querySelectorAll('[role="group"][aria-label="工作模式"] button')].find(button => button.textContent.trim() === 'Chat');
      chatButton.click(); await api.until(() => fixture.state().mode === 'chat' && fixture.row('chat-b'));
      const pressed = chatButton.getAttribute('aria-pressed'), primary = !!fixture.button('新建对话');
      const actions = !!fixture.row('chat-b').querySelector('[aria-label="更多会话操作"]');
      fixture.row('chat-b').click(); await api.until(() => fixture.state().chat === 'chat-b');
      const selected = fixture.state().chat, activeTab = fixture.state().activeTab, fallback = [];
      for (const label of ['Markdown','Todo','日程','定时任务']) {
        fixture.button(label).click(); await api.delay(); const state = fixture.state();
        fallback.push({ label, view: state.view, planning: state.planning });
      }
      fixture.root.unmount(); return { pressed, selected, activeTab, actions, primary, fallback };
    `)
    expect(result.pressed).toBe('true')
    expect(result.selected).toBe('chat-b')
    expect(result.activeTab).toBe('chat-b')
    expect(result.actions).toBe(true)
    expect(result.primary).toBe(true)
    expect(result.fallback.map(({ label, view }) => ({ label, view }))).toEqual([
      { label: 'Markdown', view: 'markdown' }, { label: 'Todo', view: 'planning' },
      { label: '日程', view: 'planning' }, { label: '定时任务', view: 'planning' },
    ])
    expect(result.fallback.slice(1).map(({ planning }) => planning)).toEqual(['todos', 'calendar', 'automations'])
  }, 30_000)

  test('When 收起侧栏并打开工具 Then 工作区导航和设置、更新、搜索仍可达', async () => {
    const result = await renderer.run<{
      collapsedWidth: number; focusableTools: boolean; tab: string; settings: boolean; update: boolean; search: boolean; expanded: boolean
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ update: { status: 'downloaded', version: '1.2.3' } });
      fixture.button('收起侧边栏').click(); await api.until(() => fixture.button('展开侧边栏'));
      const collapsedWidth = document.querySelector('.gamma-sidebar').getBoundingClientRect().width;
      const tools = fixture.button('工作区工具'); tools.focus();
      const triggerFocused = document.activeElement === tools;
      tools.click();
      await api.until(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Todo'));
      const todo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Todo');
      const focusableTools = triggerFocused && tools.tabIndex === 0 && todo.tabIndex === 0; todo.click();
      await api.until(() => fixture.state().workspaceTab === 'todos'); const tab = fixture.state().workspaceTab;
      fixture.button('打开设置').click(); await api.until(() => fixture.state().settings); const settings = fixture.state().settings;
      fixture.closeSettings(); fixture.button('立即重启更新 v1.2.3').click(); await api.until(() => fixture.state().settingsTab === 'about');
      const update = fixture.state().settings && fixture.state().settingsTab === 'about'; fixture.closeSettings();
      fixture.button('展开侧边栏').click(); await api.until(() => fixture.button('收起侧边栏')); const expanded = !fixture.state().collapsed;
      fixture.button('搜索').click(); await api.until(() => fixture.state().search); const search = fixture.state().search;
      fixture.root.unmount(); return { collapsedWidth, focusableTools, tab, settings, update, search, expanded };
    `)
    expect(result).toEqual({ collapsedWidth: 60, focusableTools: true, tab: 'todos', settings: true, update: true, search: true, expanded: true })
  }, 30_000)

  test('When 空列表或超长名称在 200px 浅深色侧栏展示 Then 操作入口可见且容器不会横向溢出', async () => {
    const results = await renderer.run<Array<{ mode: string; dark: boolean; empty: boolean; width: number; overflow: string[]; controls: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now(), long = '极长的项目与会话名称'.repeat(40);
      for (const mode of ['agent','chat']) for (const dark of [false,true]) for (const empty of [false,true]) {
        const fixture = await api.mount({ mode, dark, width: 200, userName: long,
          agents: empty ? [] : [{ id: 'long-agent', title: long, workspaceId: 'long-project', createdAt: now, updatedAt: now }],
          chats: empty ? [] : [{ id: 'long-chat', title: long, createdAt: now, updatedAt: now }],
          workspaces: [{ id: 'long-project', name: long, slug: 'long-project', createdAt: now, updatedAt: now }],
          update: { status: 'available', version: '1.2.3' },
        });
        const sidebar = document.querySelector('.gamma-sidebar');
        const overflow = [sidebar, ...sidebar.querySelectorAll('nav, [data-session-switch-id], [class*="overflow-y-auto"]')]
          .filter(node => node.scrollWidth > node.clientWidth + 1)
          .map(node => node.getAttribute('aria-label') || node.dataset.sessionSwitchId || node.className);
        const controls = !!fixture.button(mode === 'agent' ? '新建任务' : '新建对话') && !!fixture.button('搜索') && !!fixture.button('打开设置');
        results.push({ mode, dark, empty, width: sidebar.getBoundingClientRect().width, overflow, controls }); fixture.root.unmount();
      }
      return results;
    `)
    expect(results).toHaveLength(8)
    for (const result of results) {
      expect(result.width).toBe(200)
      expect(result.overflow).toEqual([])
      expect(result.controls).toBe(true)
    }
  }, 30_000)
})
