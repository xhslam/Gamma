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
  test('When 在窄侧栏显示长标题、委派计数与快捷键提示 Then 会话保持紧凑单行且操作不溢出', async () => {
    const results = await renderer.run<Array<{ height: number; aligned: boolean; fits: boolean; truncated: boolean }>>(`
      const api = window.leftSidebarRegression, results = [];
      for (const dark of [false, true]) {
        for (const width of [240, 256]) {
          const now = Date.now(), fixture = await api.mount({ dark, width, agents: [
            { id: 'parent', title: '这是一段需要截断的很长会话标题用于检查侧栏布局', workspaceId: 'project-a', createdAt: now, updatedAt: now },
            { id: 'child', title: '核对引用来源', workspaceId: 'project-a', parentSessionId: 'parent', sourceDelegationId: 'delegation', rootSessionId: 'parent', createdAt: now, updatedAt: now },
          ] });
          const row = fixture.row('parent');
          for (const hints of [false, true]) {
            const sidebar = document.querySelector('.gamma-sidebar');
            sidebar.setAttribute('data-session-switch-hints', String(hints));
            row.setAttribute('data-quick-switch-label', '1');
            await api.delay();
            const bounds = row.getBoundingClientRect();
            const title = [...row.querySelectorAll('span')].find(span => span.textContent.startsWith('这是一段'));
            const titleBounds = title.getBoundingClientRect(), actions = row.querySelector('.session-item-actions').getBoundingClientRect();
            results.push({ height: bounds.height,
              aligned: Math.abs(titleBounds.top + titleBounds.height / 2 - actions.top - actions.height / 2) < 2,
              fits: row.scrollWidth <= row.clientWidth && actions.right <= bounds.right && titleBounds.width > 0,
              truncated: title.scrollWidth > title.clientWidth });
          }
          fixture.root.unmount(); await api.delay();
        }
      }
      return results;
    `)
    expect(results).toHaveLength(8)
    for (const result of results) {
      expect(result.height).toBeLessThanOrEqual(36)
      expect(result.aligned).toBe(true)
      expect(result.fits).toBe(true)
      expect(result.truncated).toBe(true)
    }
  }, 30_000)

  test('When 项目包含较多或较早的会话 Then 直接列出且没有底部展开按钮，并保留项目折叠', async () => {
    const result = await renderer.run<{ allVisible: boolean; hasControls: boolean; collapsed: boolean; restored: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = Array.from({ length: 8 }, (_, index) => ({
        id: 'history-' + index, title: '历史会话 ' + index, workspaceId: 'project-a',
        createdAt: now - index * 86400000, updatedAt: now - index * 86400000,
      }));
      const fixture = await api.mount({ agents });
      await api.until(() => fixture.row('history-7'));
      const allVisible = agents.every(agent => !!fixture.row(agent.id));
      const hasControls = [...document.querySelectorAll('button')].some(button => /显示更多会话|收起额外会话/.test(button.getAttribute('aria-label') ?? ''));
      const project = [...document.querySelectorAll('button[aria-expanded]')].find(button => button.textContent.includes('Gamma 项目'));
      project.click(); await api.until(() => !fixture.row('history-0'));
      const collapsed = project.getAttribute('aria-expanded') === 'false';
      project.click(); await api.until(() => fixture.row('history-7'));
      const restored = agents.every(agent => !!fixture.row(agent.id));
      fixture.root.unmount(); return { allVisible, hasControls, collapsed, restored };
    `)
    expect(result).toEqual({ allVisible: true, hasControls: false, collapsed: true, restored: true })
  }, 30_000)

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

  test('When 渲染 Agent-only 导航 Then 无模式栏且新建任务保持可用', async () => {
    const result = await renderer.run<{ modeBar: boolean; newTask: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const modeBar = !!document.querySelector('[aria-label="工作模式"]');
      const newTask = !!fixture.button('新建任务');
      fixture.root.unmount(); return { modeBar, newTask };
    `)
    expect(result).toEqual({ modeBar: false, newTask: true })
  }, 30_000)

  test('When 收起侧栏 Then 不保留图标栏，顶部展开后导航与全局操作恢复', async () => {
    const result = await renderer.run<{
      absent: boolean; contentLeft: number; top: boolean; expanded: boolean; tab: string; settings: boolean; search: boolean
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      fixture.button('收起侧边栏').click();
      await api.until(() => fixture.button('展开侧边栏'));
      await api.until(() => Math.round(document.querySelector('[data-testid="fixture-content"]').getBoundingClientRect().left) === 0);
      const sidebarContainer = document.querySelector('.crt-sidebar');
      const absent = !sidebarContainer || sidebarContainer.getBoundingClientRect().width === 0;
      const contentLeft = Math.round(document.querySelector('[data-testid="fixture-content"]').getBoundingClientRect().left);
      const header = document.querySelector('[data-testid="collapsed-sidebar-header"]');
      const top = header.getBoundingClientRect().top === 0 && header.textContent.includes('整理研究资料');
      fixture.button('展开侧边栏').focus(); fixture.button('展开侧边栏').click();
      await api.until(() => fixture.button('收起侧边栏'));
      await api.until(() => Math.round(document.querySelector('.gamma-sidebar')?.getBoundingClientRect().width ?? 0) === 256);
      const expanded = !fixture.state().collapsed && Math.round(document.querySelector('.gamma-sidebar').getBoundingClientRect().width) === 256;
      fixture.button('Todo').click(); await api.until(() => fixture.state().workspaceTab === 'todos');
      const tab = fixture.state().workspaceTab;
      fixture.button('打开设置').click(); await api.until(() => fixture.state().settings); const settings = fixture.state().settings;
      fixture.closeSettings(); fixture.button('搜索').click(); await api.until(() => fixture.state().search); const search = fixture.state().search;
      fixture.root.unmount(); return { absent, contentLeft, top, expanded, tab, settings, search };
    `)
    expect(result).toEqual({ absent: true, contentLeft: 0, top: true, expanded: true, tab: 'todos', settings: true, search: true })
  }, 30_000)

  test('When 空会话或长标题在浅深色下收起 Then 顶栏单行不溢出且展开入口可聚焦', async () => {
    const results = await renderer.run<Array<{ absent: boolean; fits: boolean; focusable: boolean; height: number; fallback: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now();
      for (const dark of [false, true]) for (const empty of [false, true]) {
        const fixture = await api.mount({ dark, collapsed: true,
          agents: empty ? [] : [{ id: 'parent', title: '很长的会话标题'.repeat(100), workspaceId: 'project-a', createdAt: now, updatedAt: now }],
        });
        const header = document.querySelector('[data-testid="collapsed-sidebar-header"]');
        fixture.button('展开侧边栏').focus();
        const sidebarContainer = document.querySelector('.crt-sidebar');
        const absent = !sidebarContainer || sidebarContainer.getBoundingClientRect().width === 0;
        results.push({ absent, fits: header.scrollWidth <= header.clientWidth,
          focusable: document.activeElement === fixture.button('展开侧边栏'), height: header.getBoundingClientRect().height,
          fallback: !empty || header.textContent.includes('Gamma') });
        fixture.root.unmount(); await api.delay();
      }
      return results;
    `)
    expect(results).toHaveLength(4)
    for (const result of results) expect(result).toEqual({ absent: true, fits: true, focusable: true, height: 44, fallback: true })
  }, 30_000)

  test('When 空列表或超长名称在 200px 浅深色侧栏展示 Then 操作入口可见且容器不会横向溢出', async () => {
    const results = await renderer.run<Array<{ dark: boolean; empty: boolean; width: number; overflow: string[]; controls: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now(), long = '极长的项目与会话名称'.repeat(40);
      for (const dark of [false,true]) for (const empty of [false,true]) {
        const fixture = await api.mount({ dark, width: 200, userName: long,
          agents: empty ? [] : [{ id: 'long-agent', title: long, workspaceId: 'long-project', createdAt: now, updatedAt: now }],
          workspaces: [{ id: 'long-project', name: long, slug: 'long-project', createdAt: now, updatedAt: now }],
          update: { status: 'available', version: '1.2.3' },
        });
        const sidebar = document.querySelector('.gamma-sidebar');
        const overflow = [sidebar, ...sidebar.querySelectorAll('nav, [data-session-switch-id], [class*="overflow-y-auto"]')]
          .filter(node => node.scrollWidth > node.clientWidth + 1)
          .map(node => node.getAttribute('aria-label') || node.dataset.sessionSwitchId || node.className);
        const controls = !!fixture.button('新建任务') && !!fixture.button('搜索') && !!fixture.button('打开设置');
        results.push({ dark, empty, width: sidebar.getBoundingClientRect().width, overflow, controls }); fixture.root.unmount();
      }
      return results;
    `)
    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result.width).toBe(200)
      expect(result.overflow).toEqual([])
      expect(result.controls).toBe(true)
    }
  }, 30_000)
})
