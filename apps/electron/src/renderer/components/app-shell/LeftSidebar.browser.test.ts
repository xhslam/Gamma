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
  test('When 点击 AGY 入口 Then 与 Markdown 一样作为右侧工作区栏目打开且不改选会话', async () => {
    expect(await renderer.run<{ view: string; workspace: string; agent: string; workspaceTab: string; componentTabs: string[]; current: string }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'AGY');
      if (!button) throw new Error('侧栏缺少 AGY 入口');
      button.click(); await api.until(() => fixture.state().workspaceTab === 'agy-terminal');
      const state = fixture.state(), current = button.getAttribute('aria-current');
      fixture.root.unmount();
      return { view: state.view, workspace: state.workspace, agent: state.agent, workspaceTab: state.workspaceTab, componentTabs: state.componentTabs, current };
    `)).toEqual({ view: 'conversations', workspace: 'project-a', agent: 'parent', workspaceTab: 'agy-terminal', componentTabs: ['agy-terminal'], current: 'page' })
  }, 30_000)

  test('When 未悬浮会话行且没有归档历史 Then 归档操作和已归档入口仍然可见可点击', async () => {
    const result = await renderer.run<{ actionVisible: boolean; entryVisible: boolean; opened: boolean; returned: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ width: 240 });
      const action = fixture.row('parent').querySelector('button[aria-label="归档"]');
      const visible = element => {
        if (!element) return false;
        for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.opacity === '0' || style.pointerEvents === 'none' || style.display === 'none') return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight;
      };
      const actionVisible = visible(action);
      const entry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('已归档'));
      const entryVisible = visible(entry);
      let opened = false, returned = false;
      if (entry) {
        entry.click(); await api.until(() => document.body.innerText.includes('返回活跃会话'));
        opened = !fixture.row('parent');
        [...document.querySelectorAll('button')].find(button => button.textContent.includes('返回活跃会话')).click();
        await api.until(() => fixture.row('parent')); returned = true;
      }
      fixture.root.unmount(); return { actionVisible, entryVisible, opened, returned };
    `)
    expect(result).toEqual({ actionVisible: true, entryVisible: true, opened: true, returned: true })
  }, 30_000)

  test('When 点击常显归档按钮 Then 仍需二次确认且不会误选该会话', async () => {
    expect(await renderer.run<{ before: number; after: number; selected: string; confirming: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      let calls = 0;
      window.electronAPI.toggleArchiveAgentSession = async id => {
        calls++; return { id, title: '检查第二个项目', workspaceId: 'project-b', archived: false };
      };
      const row = fixture.row('other'); row.querySelector('button[aria-label="归档"]').click();
      await api.delay();
      const before = calls, selected = fixture.state().agent;
      const confirm = row.querySelector('button[aria-label="再次点击确认归档"]');
      const confirming = !!confirm; confirm.click(); await api.until(() => calls === 1); await api.delay();
      const result = { before, after: calls, selected, confirming }; fixture.root.unmount(); return result;
    `)).toEqual({ before: 0, after: 1, selected: 'parent', confirming: true })
  }, 30_000)

  test('When 浅深色窄侧栏窗口缩短且历史较长 Then 归档和账户入口保持在可见区域', async () => {
    const results = await renderer.run<Array<{ entryVisible: boolean; accountVisible: boolean; scrollable: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now();
      Object.assign(document.getElementById('root').style, { height: '480px', minHeight: '0' });
      for (const dark of [false, true]) {
        const fixture = await api.mount({ dark, width: 200, agents: Array.from({ length: 40 }, (_, i) => ({
          id: 'short-' + i, title: '较长历史会话 ' + i, workspaceId: 'project-a', createdAt: now, updatedAt: now - i,
        })) });
        const entry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('已归档'));
        const entryBounds = entry.getBoundingClientRect(), accountBounds = fixture.button('个人资料与设置').getBoundingClientRect();
        const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
        results.push({ entryVisible: entryBounds.height > 20 && entryBounds.bottom <= 480,
          accountVisible: accountBounds.height > 20 && accountBounds.bottom <= 480,
          scrollable: scroll.scrollHeight > scroll.clientHeight });
        fixture.root.unmount(); await api.delay();
      }
      return results;
    `)
    expect(results).toEqual(Array.from({ length: 2 }, () => ({ entryVisible: true, accountVisible: true, scrollable: true })))
  }, 30_000)

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

  test('When Windows 窄侧栏包含长历史列表 Then 浅深色均可滚动到底且没有多余展开按钮', async () => {
    const results = await renderer.run<Array<{ scrollable: boolean; lastVisible: boolean; fits: boolean; hasControls: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now();
      for (const dark of [false, true]) {
        const agents = Array.from({ length: 40 }, (_, index) => ({
          id: 'win-' + index, title: 'Windows 长标题会话用于检查窄侧栏截断和滚动 ' + index,
          workspaceId: 'project-a', createdAt: now - index * 86400000, updatedAt: now - index * 86400000,
        }));
        const fixture = await api.mount({ platform: 'Win32', width: 200, dark, agents });
        const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
        const scrollable = scroll.scrollHeight > scroll.clientHeight;
        scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll'));
        await api.delay(60);
        const bounds = scroll.getBoundingClientRect(), last = fixture.row('win-39').getBoundingClientRect();
        const hasControls = [...document.querySelectorAll('button')].some(button => /显示更多会话|收起额外会话/.test(button.getAttribute('aria-label') ?? ''));
        results.push({ scrollable, lastVisible: last.top >= bounds.top && last.bottom <= bounds.bottom + 1,
          fits: scroll.scrollWidth <= scroll.clientWidth && last.right <= bounds.right, hasControls });
        fixture.root.unmount(); await api.delay();
      }
      return results;
    `)
    expect(results).toEqual(Array.from({ length: 2 }, () => ({ scrollable: true, lastVisible: true, fits: true, hasControls: false })))
  }, 30_000)

  test('When Windows 用户滚动后按 Ctrl 数字 Then 按当前可见会话切换而不是使用 macOS 修饰键', async () => {
    const result = await renderer.run<{ modifier: string; metaIgnored: boolean; selected: boolean; hidden: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = Array.from({ length: 40 }, (_, index) => ({
        id: 'key-' + index, title: '键盘会话 ' + index, workspaceId: 'project-a', createdAt: now, updatedAt: now - index,
      }));
      const fixture = await api.mount({ platform: 'Win32', agents });
      const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
      scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll'));
      await api.delay(60);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
      await api.until(() => document.querySelector('[data-quick-switch-index="2"]'));
      const target = document.querySelector('[data-quick-switch-index="2"]');
      const targetId = target.dataset.sessionSwitchId;
      const modifier = target.querySelector('.session-quick-switch-modifier').textContent;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', metaKey: true, bubbles: true, cancelable: true }));
      await api.delay(); const metaIgnored = fixture.state().agent === 'key-0';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true }));
      await api.until(() => fixture.state().agent === targetId);
      const selected = fixture.state().agent === targetId;
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
      await api.until(() => !document.querySelector('[data-quick-switch-index]'));
      const hidden = !document.querySelector('[data-quick-switch-index]');
      fixture.root.unmount(); return { modifier, metaIgnored, selected, hidden };
    `)
    expect(result).toEqual({ modifier: 'Ctrl', metaIgnored: true, selected: true, hidden: true })
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
      brand: 'Gamma', titleFits: true, labels: ['AGY', 'Markdown', 'Todo', '日程', '项目记忆', '定时任务', 'MCP/Skills'],
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
      await api.until(() => document.querySelector('.crt-sidebar').getBoundingClientRect().width === 0);
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

describe('Given 不带三角标记的项目列表', () => {
  test('When 切换项目并打开归档 Then 无装饰三角，当前项目语义及折叠菜单入口保持', async () => {
    const result = await renderer.run<{ absent: boolean; current: boolean; switched: boolean; controls: boolean; archived: boolean; collapsed: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const fixture = await api.mount({ agents: [
        { id: 'a', title: 'A的会话', workspaceId: 'project-a', createdAt: now, updatedAt: now },
        { id: 'b', title: 'B的会话', workspaceId: 'project-b', createdAt: now, updatedAt: now },
        { id: 'old', title: '已归档会话', workspaceId: 'project-b', archived: true, createdAt: now, updatedAt: now },
      ] });
      const project = name => [...document.querySelectorAll('.gamma-sidebar-project-row')].find(button => button.textContent.includes(name));
      const current = project('Gamma 项目').getAttribute('aria-current') === 'true';
      fixture.row('b').click(); await api.until(() => fixture.state().workspace === 'project-b');
      const switched = project('第二个项目').getAttribute('aria-current') === 'true' && !project('Gamma 项目').hasAttribute('aria-current');
      const controls = !!fixture.button('在「第二个项目」中新建会话') && !!fixture.button('项目菜单');
      [...document.querySelectorAll('button')].find(button => button.textContent.includes('已归档 (')).click();
      await api.until(() => document.body.textContent.includes('已归档会话'));
      const archivedProject = project('第二个项目');
      const archived = archivedProject.getAttribute('aria-current') === 'true';
      archivedProject.click(); await api.until(() => archivedProject.getAttribute('aria-expanded') === 'true');
      archivedProject.click(); await api.until(() => archivedProject.getAttribute('aria-expanded') === 'false');
      const collapsed = archivedProject.getAttribute('aria-expanded') === 'false';
      const absent = !document.querySelector('.workspace-selected-triangle');
      fixture.root.unmount(); return { absent, current, switched, controls, archived, collapsed };
    `)
    expect(result).toEqual({ absent: true, current: true, switched: true, controls: true, archived: true, collapsed: true })
  }, 30_000)
})

describe('Given Computer Use 已改为按需工具', () => {
  test('When 窄侧栏处于任意电脑状态 Then 不再渲染模式入口或重新启用按钮', async () => {
    const results = await renderer.run<Array<{ noMode: boolean; noResume: boolean; noCalls: boolean }>>(`
      const api = window.leftSidebarRegression, results = [];
      for (const dark of [false, true]) {
        const fixture = await api.mount({ dark, width: 200, computerState: { supported: true, phase: 'paused', resumeRequired: true } });
        const noMode = !document.querySelector('[aria-label="桌面操作控制"]') && !document.querySelector('button[aria-label^="查看桌面状态"]');
        const noResume = !fixture.button('重新启用桌面操作');
        const noCalls = !fixture.calls.includes('resumeComputer') && !fixture.calls.includes('stopComputer');
        results.push({ noMode, noResume, noCalls });
        fixture.root.unmount(); await api.delay();
      }
      return results;
    `)
    expect(results).toEqual(Array.from({ length: 2 }, () => ({ noMode: true, noResume: true, noCalls: true })))
  }, 30_000)
})

describe('Given 固定不随滚动改变的项目操作栏', () => {
  test('When 侧栏列表向上滚动时 Then 项目操作栏与快捷入口位置保持固定且不位于滚动容器内', async () => {
    const result = await renderer.run<{ outsideScroll: boolean; topBefore: number; topAfter: number; stable: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const fixture = await api.mount({ agents: Array.from({ length: 30 }, (_, i) => ({
        id: 'scroll-test-' + i, title: '长列表会话 ' + i, workspaceId: 'project-a', createdAt: now, updatedAt: now - i,
      })) });
      const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
      const collapseBtn = fixture.button('折叠所有项目');
      const outsideScroll = !scroll.contains(collapseBtn);
      const topBefore = collapseBtn.getBoundingClientRect().top;
      scroll.scrollTop = 200;
      await api.delay(60);
      const topAfter = collapseBtn.getBoundingClientRect().top;
      const stable = topBefore === topAfter;
      fixture.root.unmount();
      return { outsideScroll, topBefore: Math.round(topBefore), topAfter: Math.round(topAfter), stable };
    `)
    expect(result.outsideScroll).toBe(true)
    expect(result.stable).toBe(true)
    expect(result.topAfter).toBe(result.topBefore)
  }, 30_000)
})
