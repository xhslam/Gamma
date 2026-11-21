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
  test('When Windows 夹具挂载完成 Then 内容视口、字体和侧栏动画均已稳定，普通标题完整显示', async () => {
    const result = await renderer.run<{ viewport: number[]; width: number; opacity: string; fonts: string; titleFits: boolean }>(`
      const fixture = await window.leftSidebarRegression.mount({ platform: 'Win32', width: 256 });
      const container = document.querySelector('[data-sidebar-transition]');
      const content = document.querySelector('[data-sidebar-transition-content]');
      const title = [...fixture.row('parent').querySelectorAll('span')].find(span => span.textContent === '整理研究资料');
      const result = { viewport: [innerWidth, innerHeight], width: container.getBoundingClientRect().width,
        opacity: getComputedStyle(content).opacity, fonts: document.fonts.status,
        titleFits: title.clientWidth > 0 && title.scrollWidth <= title.clientWidth };
      if (!result.titleFits) {
        const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
        throw new Error('普通标题空间不足：' + JSON.stringify({ ...result, titleWidth: title.clientWidth, titleScroll: title.scrollWidth,
          font: getComputedStyle(title).font, gutter: scroll.offsetWidth - scroll.clientWidth,
          rowWidth: fixture.row('parent').clientWidth }));
      }
      fixture.root.unmount(); return result;
    `)
    expect(result).toEqual({ viewport: [900, 600], width: 256, opacity: '1', fonts: 'loaded', titleFits: true })
  }, 30_000)

  test('When 为经典滚动条预留至少 12px 宽度 Then 普通标题仍完整显示且操作按钮不重叠', async () => {
    const result = await renderer.run<{ reserved: number; titleWidth: number; titleScroll: number; separated: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ platform: 'Win32', width: 256 });
      const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
      // macOS overlay 不占据布局宽度；补足相同预算，不能让本机验证忽略 Windows 的经典滚动条。
      const nativeGutter = scroll.offsetWidth - scroll.clientWidth;
      scroll.style.paddingInlineEnd = Math.max(0, 12 - nativeGutter) + 'px';
      const row = fixture.row('parent');
      const title = [...row.querySelectorAll('span')].find(span => span.textContent === '整理研究资料');
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await api.openMenu(row.querySelector('button[aria-label="更多会话操作"]'));
      const menu = document.querySelector('[role="menu"]');
      const archive = [...menu.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === '归档');
      const toggle = row.querySelector('button[aria-label="展开子会话"]');
      const result = { reserved: nativeGutter + parseFloat(getComputedStyle(scroll).paddingInlineEnd),
        titleWidth: title.clientWidth, titleScroll: title.scrollWidth,
        separated: toggle.getBoundingClientRect().right <= menu.getBoundingClientRect().left };
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.root.unmount(); return result;
    `)
    expect(result.reserved).toBeGreaterThanOrEqual(12)
    expect(result.titleWidth).toBeGreaterThanOrEqual(result.titleScroll)
    expect(result.separated).toBe(true)
  }, 30_000)

  test('Given 没有活跃会话 When 点击 Code Then 仍能进入独立页面', async () => {
    expect(await renderer.run<{ view: string; agent: string | null; componentTabs: string[] }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ activeAgent: null });
      const button = fixture.button('Code');
      button.click(); await api.until(() => button.getAttribute('aria-current') === 'page');
      const { view, agent, componentTabs } = fixture.state();
      fixture.root.unmount();
      return { view, agent, componentTabs };
    `)).toEqual({ view: 'agy-terminal', agent: null, componentTabs: [] })
  }, 30_000)

  test('When 点击 Design Then 打开完整主工作台而非草稿或重复右侧会话', async () => {
    expect(await renderer.run<{ view: string; agent: string; workspace: string }>(`
      const api=window.leftSidebarRegression,fixture=await api.mount();fixture.button('Design').click();
      await api.until(()=>fixture.state().view==='design');const state=fixture.state();fixture.root.unmount();
      return {view:state.view,agent:state.agent,workspace:state.workspace};
    `)).toEqual({view:'design',agent:'parent',workspace:'project-a'})
  }, 30_000)

  test('When 未悬浮会话行且没有归档历史 Then 更多操作和已归档入口仍然可达', async () => {
    const result = await renderer.run<{ actionReachable: boolean; archiveReachable: boolean; entryVisible: boolean; opened: boolean; returned: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ width: 240 });
      const action = fixture.row('parent').querySelector('button[aria-label="更多会话操作"]');
      const visible = element => {
        if (!element) return false;
        for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.opacity === '0' || style.pointerEvents === 'none' || style.display === 'none') return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight;
      };
      fixture.row('parent').focus();
      fixture.row('parent').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await api.until(() => getComputedStyle(action).opacity === '1');
      const actionReachable = visible(action);
      await api.openMenu(action);
      const archiveReachable = [...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.trim() === '归档');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await api.until(() => !document.querySelector('[role="menu"]'));
      const entry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('已归档'));
      const entryVisible = visible(entry);
      let opened = false, returned = false;
      if (entry) {
        entry.click(); await api.until(() => document.body.innerText.includes('返回活跃会话'));
        opened = !fixture.row('parent');
        [...document.querySelectorAll('button')].find(button => button.textContent.includes('返回活跃会话')).click();
        await api.until(() => fixture.row('parent')); returned = true;
      }
      fixture.root.unmount(); return { actionReachable, archiveReachable, entryVisible, opened, returned };
    `)
    expect(result).toEqual({ actionReachable: true, archiveReachable: true, entryVisible: true, opened: true, returned: true })
  }, 30_000)

  test('When 从紧凑会话菜单归档 Then 直接归档且不切换当前会话', async () => {
    expect(await renderer.run<{ before: number; after: number; selected: string; archived: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const fixture = await api.mount({ agents: [
        { id: 'parent', title: '整理研究资料', workspaceId: 'project-a', pinned: true, createdAt: now, updatedAt: now },
        { id: 'other', title: '检查第二个项目', workspaceId: 'project-b', createdAt: now, updatedAt: now },
      ] });
      let calls = 0;
      await api.until(() => fixture.row('other'));
      window.electronAPI.toggleArchiveAgentSession = async id => {
        calls++;
        const session = fixture.store.get(window.leftSidebarRegression.atoms.agentSessions).find(item => item.id === id);
        const updated = { ...session, archived: true };
        fixture.setSessions(fixture.store.get(window.leftSidebarRegression.atoms.agentSessions).map(item => item.id === id ? updated : item));
        return updated;
      };
      const row = fixture.row('other');
      await api.openMenu(row.querySelector('button[aria-label="更多会话操作"]'));
      const before = calls;
      await api.chooseMenu('归档');
      await api.until(() => calls === 1 && !fixture.row('other'));
      const result = { before, after: calls, selected: fixture.state().agent, archived: !fixture.row('other') };
      fixture.root.unmount(); return result;
    `)).toEqual({ before: 0, after: 1, selected: 'parent', archived: true })
  }, 30_000)

  test('When 浅深色窄侧栏窗口缩短且历史较长 Then 归档和账户入口保持在可见区域', async () => {
    const results = await renderer.run<Array<{ entryVisible: boolean; accountVisible: boolean; scrollable: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now();
      for (const dark of [false, true]) {
        const fixture = await api.mount({ dark, width: 200, height: 480, agents: Array.from({ length: 40 }, (_, i) => ({
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

  test('When 项目超过七条会话 Then 预览可展开全部与收起，项目折叠独立生效', async () => {
    const result = await renderer.run<{ preview: number; all: number; restored: number; collapsed: boolean; independent: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = Array.from({ length: 12 }, (_, index) => ({
        id: 'history-' + index, title: '历史会话 ' + index, workspaceId: 'project-a',
        createdAt: now - index * 86400000, updatedAt: now - index * 86400000,
      }));
      const fixture = await api.mount({ agents });
      const count = () => agents.filter(agent => !!fixture.row(agent.id)).length;
      await api.until(() => count() === 7);
      const preview = count(), control = fixture.button('查看「Gamma 项目」的全部会话');
      control.click(); await api.until(() => count() === 12);
      const all = count();
      fixture.button('收起「Gamma 项目」的全部会话').click(); await api.until(() => count() === 7);
      const restored = count();
      const project = fixture.button('项目：Gamma 项目');
      fixture.button('收起项目「Gamma 项目」').click(); await api.until(() => !fixture.row('history-0'));
      const collapsed = project.getAttribute('aria-expanded') === 'false' && fixture.button('查看「Gamma 项目」的全部会话') === null;
      fixture.button('展开项目「Gamma 项目」').click(); await api.until(() => count() === 7);
      const independent = project.getAttribute('aria-expanded') === 'true' && count() === 7;
      fixture.root.unmount(); return { preview, all, restored, collapsed, independent };
    `)
    expect(result).toEqual({ preview: 7, all: 12, restored: 7, collapsed: true, independent: true })
  }, 30_000)

  test('When Windows 窄侧栏包含长历史列表 Then 展开预览后可滚动到底且不溢出', async () => {
    const results = await renderer.run<Array<{ scrollable: boolean; lastVisible: boolean; fits: boolean; hasControls: boolean }>>(`
      const api = window.leftSidebarRegression, results = [], now = Date.now();
      for (const dark of [false, true]) {
        const agents = Array.from({ length: 40 }, (_, index) => ({
          id: 'win-' + index, title: 'Windows 长标题会话用于检查窄侧栏截断和滚动 ' + index,
          workspaceId: 'project-a', createdAt: now - index * 86400000, updatedAt: now - index * 86400000,
        }));
        const fixture = await api.mount({ platform: 'Win32', width: 200, dark, agents });
        fixture.button('查看「Gamma 项目」的全部会话').click();
        await api.until(() => fixture.row('win-39'));
        const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
        const scrollable = scroll.scrollHeight > scroll.clientHeight;
        scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll'));
        await api.delay(60);
        const bounds = scroll.getBoundingClientRect(), last = fixture.row('win-39').getBoundingClientRect();
        const hasControls = !!fixture.button('收起「Gamma 项目」的全部会话');
        results.push({ scrollable, lastVisible: last.top >= bounds.top && last.bottom <= bounds.bottom + 1,
          fits: scroll.scrollWidth <= scroll.clientWidth && last.right <= bounds.right, hasControls });
        fixture.root.unmount(); await api.delay();
      }
      return results;
    `)
    expect(results).toEqual(Array.from({ length: 2 }, () => ({ scrollable: true, lastVisible: true, fits: true, hasControls: true })))
  }, 30_000)

  test('When Windows 用户滚动后按 Ctrl 数字 Then 按当前可见会话切换而不是使用 macOS 修饰键', async () => {
    const result = await renderer.run<{ modifier: string; metaIgnored: boolean; selected: boolean; hidden: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = Array.from({ length: 40 }, (_, index) => ({
        id: 'key-' + index, title: '键盘会话 ' + index, workspaceId: 'project-a', createdAt: now, updatedAt: now - index,
      }));
      const fixture = await api.mount({ platform: 'Win32', agents });
      fixture.button('查看「Gamma 项目」的全部会话').click();
      await api.until(() => fixture.row('key-39'));
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
      const brand = document.querySelector('.gamma-sidebar-topbar').textContent.trim();
      const title = [...fixture.row('parent').querySelectorAll('span')].find(span => span.textContent === '整理研究资料');
      const titleFits = title.clientWidth > 0 && title.scrollWidth <= title.clientWidth;
      const labels = [...document.querySelectorAll('nav[aria-label="工作区"] button')].map(button => button.getAttribute('aria-label'));
      const states = [];
      for (const [label, tab] of [['Markdown','markdown'],['定时任务','automations'],['MCP/skills','skills']]) {
        fixture.button(label).click();
        await api.until(() => fixture.state().workspaceTab === tab && fixture.button(label).getAttribute('aria-current') === 'page');
        states.push({ label, tab: fixture.state().workspaceTab, current: fixture.button(label).getAttribute('aria-current') });
      }
      const state = fixture.state(), hasLegacyPromotion = /Proma|商业版|升级 Pro/.test(document.body.innerText);
      fixture.root.unmount();
      return { brand, titleFits, labels, states, components: state.componentTabs, session: state.agent, project: state.workspace, view: state.view, hasLegacyPromotion };
    `)
    expect(result).toEqual({
      brand: 'Gamma', titleFits: true, labels: ['搜索', '项目', 'Design', 'Code', 'MCP/skills', '定时任务', 'Markdown'],
      states: [
        { label: 'Markdown', tab: 'markdown', current: 'page' },
        { label: '定时任务', tab: 'automations', current: 'page' }, { label: 'MCP/skills', tab: 'skills', current: 'page' },
      ],
      components: ['markdown', 'automations', 'mcp', 'skills'],
      session: 'parent', project: 'project-a', view: 'conversations', hasLegacyPromotion: false,
    })
  }, 30_000)

  test('When 展开委派子会话、选择子会话与其他项目 Then 保留父会话观察和项目树的原有行为', async () => {
    const result = await renderer.run<{
      child: { parent: string; selected: string; tab: string; open: boolean }; other: { session: string; project: string }
      collapsed: boolean; expanded: boolean; controls: boolean
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const controls = ['折叠所有项目','新建项目','项目菜单'].every(label => !!fixture.button(label));
      await api.openMenu(fixture.button('新建项目'));
      const creationControls = ['新建空白项目','从本地文件夹创建项目'].every(label => [...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.trim() === label));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await api.until(() => !document.querySelector('[role="menu"]'));
      fixture.button('展开子会话').click(); await api.until(() => fixture.row('child'));
      fixture.row('child').click(); await api.until(() => fixture.state().delegation === 'child');
      const childState = fixture.state(), child = { parent: childState.agent, selected: childState.delegation, tab: childState.workspaceTab, open: childState.workspaceOpen };
      fixture.row('other').click(); await api.until(() => fixture.state().agent === 'other');
      const other = { session: fixture.state().agent, project: fixture.state().workspace };
      const projectButton = [...document.querySelectorAll('button[aria-expanded]')].find(button => button.textContent.includes('第二个项目'));
      projectButton.click(); await api.until(() => !fixture.row('other')); const collapsed = projectButton.getAttribute('aria-expanded') === 'false';
      projectButton.click(); await api.until(() => fixture.row('other')); const expanded = projectButton.getAttribute('aria-expanded') === 'true';
      fixture.root.unmount(); return { child, other, collapsed, expanded, controls: controls && creationControls };
    `)
    expect(result).toEqual({
      child: { parent: 'parent', selected: 'child', tab: 'delegation', open: true },
      other: { session: 'other', project: 'project-b' }, collapsed: true, expanded: true, controls: true,
    })
  }, 30_000)

  test('When 渲染 Agent-only 导航 Then 无模式栏且新建入口保持可用', async () => {
    const result = await renderer.run<{ modeBar: boolean; newTask: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount();
      const modeBar = !!document.querySelector('[aria-label="工作模式"]');
      const newTask = !!fixture.button('新建');
      fixture.root.unmount(); return { modeBar, newTask };
    `)
    expect(result).toEqual({ modeBar: false, newTask: true })
  }, 30_000)

  test('When 展开侧栏 Then 品牌字标使用衬线正文栈，顶栏容下 macOS 红绿灯且导航仍为无衬线', async () => {
    const result = await renderer.run<{
      brandFamily: string; brandSize: string; brandText: string
      navFamily: string; topbarHeight: number; dividerTop: number; trafficLightBottom: number
      brandBaselineDelta: number
    }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ platform: 'MacIntel' });
      const topbar = document.querySelector('.gamma-sidebar-topbar');
      const brand = topbar.querySelector('.gamma-sidebar-brand');
      const brandStyle = getComputedStyle(brand);
      const navStyle = getComputedStyle(fixture.button('搜索'));
      const collapse = fixture.button('收起侧边栏').getBoundingClientRect();
      const brandBox = brand.getBoundingClientRect();
      const topbarBox = topbar.getBoundingClientRect();
      const dividerTop = topbarBox.top + parseFloat(getComputedStyle(document.querySelector('.gamma-sidebar'), '::after').top);
      // macOS 红绿灯由主进程固定在 y=8，直径 12px；顶栏分隔线必须落在其下方。
      const trafficLightBottom = 8 + 12;
      const result = {
        brandFamily: brandStyle.fontFamily, brandSize: brandStyle.fontSize, brandText: brand.textContent.trim(),
        navFamily: navStyle.fontFamily, topbarHeight: topbarBox.height, dividerTop, trafficLightBottom,
        brandBaselineDelta: Math.abs((brandBox.top + brandBox.height / 2) - (collapse.top + collapse.height / 2)),
      };
      fixture.root.unmount(); return result;
    `)
    expect(result.brandText).toBe('Gamma')
    expect(result.brandFamily).toContain('Source Serif 4')
    expect(result.brandSize).toBe('19px')
    expect(result.navFamily).toContain('Inter')
    expect(result.navFamily).not.toContain('Source Serif')
    expect(result.topbarHeight).toBe(32)
    expect(result.dividerTop).toBeGreaterThanOrEqual(result.trafficLightBottom)
    expect(result.brandBaselineDelta).toBeLessThanOrEqual(1)
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
      fixture.button('Design').click(); await api.until(() => fixture.state().view === 'design');
      const tab = fixture.state().view;
      await api.openMenu(fixture.button('个人资料与设置'));
      await api.chooseMenu('打开设置');
      await api.until(() => fixture.state().settings); const settings = fixture.state().settings;
      fixture.closeSettings(); fixture.button('搜索').click(); await api.until(() => fixture.state().search); const search = fixture.state().search;
      fixture.closeSearch();
      fixture.root.unmount(); return { absent, contentLeft, top, expanded, tab, settings, search };
    `)
    expect(result).toEqual({ absent: true, contentLeft: 0, top: true, expanded: true, tab: 'design', settings: true, search: true })
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
    for (const result of results) expect(result).toEqual({ absent: true, fits: true, focusable: true, height: 32, fallback: true })
  }, 30_000)

  test('When 空列表或超长名称在 200px 浅深色侧栏展示 Then 底栏入口可见且更新提示和长用户名不会挤出容器', async () => {
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
        const footer = sidebar.querySelector('.gamma-sidebar-footer');
        const footerBounds = footer.getBoundingClientRect();
        const controls = !!fixture.button('新建') && ['个人资料与设置', '设置'].every(label => {
          const button = fixture.button(label);
          if (!button || !footer.contains(button)) return false;
          const bounds = button.getBoundingClientRect();
          return bounds.width >= (label === '设置' ? 28 : 80) && bounds.left >= footerBounds.left && bounds.right <= footerBounds.right;
        });
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

describe('Given 使用 disclosure 标记的项目列表', () => {
  test('When 切换项目并打开归档 Then 当前项目语义、展开标记及折叠菜单入口保持', async () => {
    const result = await renderer.run<{ disclosure: boolean; noLegacyTriangle: boolean; current: boolean; switched: boolean; controls: boolean; archived: boolean; collapsed: boolean }>(`
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
      const disclosure = !!document.querySelector('.gamma-sidebar-project-chevron[data-disclosure-chevron]');
      const noLegacyTriangle = !document.querySelector('.workspace-selected-triangle');
      fixture.root.unmount(); return { disclosure, noLegacyTriangle, current, switched, controls, archived, collapsed };
    `)
    expect(result).toEqual({ disclosure: true, noLegacyTriangle: true, current: true, switched: true, controls: true, archived: true, collapsed: true })
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

describe('Given 可滚动且可收起的项目分组', () => {
  test('When 列表滚动后点击顶部项目入口 Then 展开分组并定位到项目标题', async () => {
    const result = await renderer.run<{ insideScroll: boolean; revealed: boolean; collapsed: boolean; restored: boolean; navigationFits: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const fixture = await api.mount({ agents: Array.from({ length: 30 }, (_, i) => ({
        id: 'scroll-test-' + i, title: '长列表会话 ' + i, workspaceId: 'project-a', createdAt: now, updatedAt: now - i,
      })) });
      fixture.button('查看「Gamma 项目」的全部会话').click();
      await api.until(() => fixture.row('scroll-test-29'));
      const scroll = document.querySelector('.gamma-sidebar .overflow-y-auto');
      const collapseBtn = fixture.button('折叠所有项目');
      const insideScroll = scroll.contains(collapseBtn);
      scroll.scrollTop = 200;
      await api.delay(60);
      fixture.button('收起项目').click();
      await api.until(() => !fixture.row('scroll-test-0'));
      const collapsed = fixture.button('展开项目').getAttribute('aria-expanded') === 'false';
      fixture.button('项目').click();
      await api.until(() => fixture.row('scroll-test-0') && Math.abs(document.querySelector('[data-sidebar-projects]').getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 2);
      const heading = document.querySelector('[data-sidebar-projects]').getBoundingClientRect();
      const revealed = heading.top >= scroll.getBoundingClientRect().top - 1 && heading.bottom <= scroll.getBoundingClientRect().bottom;
      const restored = fixture.button('收起项目').getAttribute('aria-expanded') === 'true' && !!fixture.row('scroll-test-0');
      const navigation = document.querySelector('nav[aria-label="工作区"]').getBoundingClientRect();
      const navigationFits = navigation.top >= 0 && navigation.bottom <= scroll.getBoundingClientRect().top;
      fixture.root.unmount();
      return { insideScroll, revealed, collapsed, restored, navigationFits };
    `)
    expect(result).toEqual({ insideScroll: true, revealed: true, collapsed: true, restored: true, navigationFits: true })
  }, 30_000)
})

describe('Given 参考图中的侧栏层级与账户区', () => {
  test('When 置顶真实项目 Then 项目和七条会话预览移入置顶区且可独立收起', async () => {
    const result = await renderer.run<boolean>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const fixture = await api.mount({ agents: Array.from({ length: 8 }, (_, index) => ({
        id: 'project-thread-' + index, title: '项目会话 ' + index, workspaceId: 'project-a',
        createdAt: now, updatedAt: now - index,
      })) });
      const project = () => fixture.button('项目：Gamma 项目');
      await api.openMenu(project().closest('.gamma-sidebar-project').querySelector('[aria-label="项目菜单"]'));
      await api.chooseMenu('置顶项目');
      await api.until(() => fixture.button('收起已置顶'));
      const heading = document.querySelector('[data-sidebar-projects]');
      const aboveHeading = !!(project().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
      const preview = fixture.button('查看「Gamma 项目」的全部会话');
      const count = document.querySelectorAll('[data-session-switch-id^="project-thread-"]').length;
      fixture.button('收起已置顶').click();
      await api.until(() => !project());
      fixture.button('展开已置顶').click();
      await api.until(project);
      await api.openMenu(project().closest('.gamma-sidebar-project').querySelector('[aria-label="项目菜单"]'));
      await api.chooseMenu('取消置顶项目');
      await api.until(() => project() && !fixture.button('收起已置顶'));
      const restored = !!(heading.compareDocumentPosition(project()) & Node.DOCUMENT_POSITION_FOLLOWING);
      fixture.root.unmount();
      return aboveHeading && !!preview && count === 7 && restored;
    `)
    expect(result).toBe(true)
  }, 30_000)

  test('When 置顶项目包含会话 Then 置顶标题可折叠，项目与子会话使用连续树线', async () => {
    const result = await renderer.run<{
      labels: string[]; pinnedCollapsed: boolean; restored: boolean; childExpanded: boolean; childCollapsed: boolean
      railAligned: boolean; markerHollow: boolean; railEndsAtPreview: boolean; heights: number[]; border: string
      pinnedIcon: boolean; pinnedPreviewCount: number; padding: string
      pinnedExpandedCount: number; pinnedRestoredCount: number
    }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = [
        { id: 'pinned-project', title: '11月21日学习内容', workspaceId: 'project-a', pinned: true, createdAt: now, updatedAt: now },
        ...Array.from({ length: 8 }, (_, index) => ({
          id: 'lesson-' + index, title: '学习内容 ' + index, workspaceId: 'project-a', parentSessionId: 'pinned-project',
          sourceDelegationId: 'delegation-' + index, rootSessionId: 'pinned-project', createdAt: now - index, updatedAt: now - index,
        })),
        ...Array.from({ length: 8 }, (_, index) => ({
          id: 'project-session-' + index, title: '项目会话 ' + index, workspaceId: 'project-b', createdAt: now - index, updatedAt: now - index,
        })),
      ];
      const fixture = await api.mount({ agents });
      const labels = [...document.querySelectorAll('nav[aria-label="工作区"] button')].map(button => button.getAttribute('aria-label'));
      await api.until(() => fixture.row('pinned-project'));
      const pinnedIcon = !!fixture.row('pinned-project').querySelector('.gamma-sidebar-pinned-root > span > svg');
      await api.until(() => fixture.row('lesson-6'));
      const pinnedPreviewCount = document.querySelectorAll('[data-session-switch-id^="lesson-"]').length;
      await api.until(() => fixture.button('查看「11月21日学习内容」的全部会话'));
      fixture.button('查看「11月21日学习内容」的全部会话').click();
      await api.until(() => fixture.row('lesson-7'));
      const childExpanded = !!fixture.row('lesson-7');
      const pinnedExpandedCount = document.querySelectorAll('[data-session-switch-id^="lesson-"]').length;
      fixture.button('收起「11月21日学习内容」的全部会话').click();
      await api.until(() => !fixture.row('lesson-7'));
      const pinnedRestoredCount = document.querySelectorAll('[data-session-switch-id^="lesson-"]').length;
      const child = fixture.row('lesson-0');
      const childWrapper = child.closest('.gamma-sidebar-delegation-children');
      const railX = childWrapper.getBoundingClientRect().left;
      const marker = child.querySelector('.gamma-sidebar-thread-marker').getBoundingClientRect();
      const sidebar = document.querySelector('.gamma-sidebar');
      const sidebarLeft = sidebar.getBoundingClientRect().left;
      const sidebarStyle = getComputedStyle(sidebar);
      const scroller = child.closest('[data-sidebar-scroll]');
      const contentInset = scroller.getBoundingClientRect().left - sidebarLeft;
      const railInset = parseFloat(sidebarStyle.getPropertyValue('--sidebar-thread-rail-inset'));
      const markerInset = parseFloat(sidebarStyle.getPropertyValue('--sidebar-thread-marker-inset'));
      const railAligned = Math.abs(railX - (sidebarLeft + contentInset + railInset)) < 1
        && Math.abs(marker.left + marker.width / 2 - (sidebarLeft + contentInset + markerInset)) < 1;
      if (!railAligned) throw new Error('树线几何异常：' + JSON.stringify({ railX, markerCenter: marker.left + marker.width / 2,
        expectedRail: sidebarLeft + contentInset + railInset, expectedMarker: sidebarLeft + contentInset + markerInset,
        contentInset, railInset, markerInset, wrapperClass: childWrapper.className }));
      const markerStyle = getComputedStyle(child.querySelector('.gamma-sidebar-thread-marker'));
      const markerHollow = markerStyle.fill === 'none' && markerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const preview = document.querySelector('.gamma-sidebar-preview-boundary');
      const previewButton = preview.querySelector('button').getBoundingClientRect();
      const railEnd = preview.getBoundingClientRect().bottom - parseFloat(getComputedStyle(preview).getPropertyValue('--sidebar-thread-rail-end'));
      const railEndsAtPreview = Math.abs(railEnd - previewButton.bottom) < 1;
      const heights = [...document.querySelectorAll('.gamma-sidebar-nav-item, .gamma-sidebar-project-row, .session-quick-switch-row')].map(row => row.getBoundingClientRect().height);
      const border = getComputedStyle(document.querySelector('.gamma-sidebar')).borderRightWidth;
      const padding = getComputedStyle(sidebar).paddingInline;
      fixture.button('收起子会话').click(); await api.until(() => !fixture.row('lesson-0'));
      const childCollapsed = !fixture.row('lesson-0');
      fixture.button('收起已置顶').click(); await api.until(() => !fixture.row('pinned-project'));
      const pinnedCollapsed = !fixture.row('pinned-project') && !!fixture.button('项目：Gamma 项目');
      fixture.button('展开已置顶').click(); await api.until(() => fixture.row('pinned-project'));
      const restored = !!fixture.row('pinned-project');
      fixture.root.unmount();
      return { labels, pinnedCollapsed, restored, childExpanded, childCollapsed, railAligned, markerHollow, railEndsAtPreview, heights, border, pinnedIcon, pinnedPreviewCount, pinnedExpandedCount, pinnedRestoredCount, padding };
    `)
    expect(result.labels).toEqual(['搜索', '项目', 'Design', 'Code', 'MCP/skills', '定时任务', 'Markdown'])
    expect(result.pinnedCollapsed).toBe(true)
    expect(result.restored).toBe(true)
    expect(result.childExpanded).toBe(true)
    expect(result.childCollapsed).toBe(true)
    expect(result.railAligned).toBe(true)
    expect(result.markerHollow).toBe(true)
    expect(result.railEndsAtPreview).toBe(true)
    expect(result.heights.every(height => height === 36)).toBe(true)
    expect(result.border).toBe('0px')
    expect(result.pinnedIcon).toBe(true)
    expect(result.pinnedPreviewCount).toBe(7)
    expect(result.pinnedExpandedCount).toBe(8)
    expect(result.pinnedRestoredCount).toBe(7)
    expect(result.padding).toBe('8px')
  }, 30_000)

  test('When 置顶子会话超过七条 Then 预览展开收起与当前选择均保留', async () => {
    const result = await renderer.run<{ preview: number; all: number; restored: number; selectedVisible: boolean; active: string; controlBefore: boolean; controlAfter: boolean; continuousRail: boolean }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = [
        { id: 'pinned-preview', title: '置顶学习项目', workspaceId: 'project-a', pinned: true, createdAt: now, updatedAt: now },
        ...Array.from({ length: 12 }, (_, index) => ({
          id: 'pinned-child-' + index, title: '置顶子会话 ' + index, workspaceId: 'project-a',
          parentSessionId: 'pinned-preview', sourceDelegationId: 'delegation-' + index, rootSessionId: 'pinned-preview',
          createdAt: now - index, updatedAt: now - index,
        })),
      ];
      const fixture = await api.mount({ agents, activeAgent: 'pinned-preview' });
      const count = () => agents.filter(agent => agent.parentSessionId && fixture.row(agent.id)).length;
      await api.until(() => count() === 7);
      const preview = count();
      fixture.button('查看「置顶学习项目」的全部会话').click();
      await api.until(() => count() === 12 && fixture.row('pinned-child-10'));
      const all = count();
      fixture.row('pinned-child-10').click();
      await api.until(() => fixture.state().delegation === 'pinned-child-10');
      const scroller = document.querySelector('[data-sidebar-scroll]');
      scroller.scrollTop = 0;
      await api.delay(40);
      const control = fixture.button('收起「置顶学习项目」的全部会话');
      const controlBefore = !!control;
      const continuousRail = [...document.querySelectorAll('.gamma-sidebar-preview-tree')].every(node => getComputedStyle(node, '::before').width === '1px');
      control.click();
      await api.until(() => count() === 7);
      const restored = count();
      const selectedVisible = !!fixture.row('pinned-child-10');
      const collapseControl = fixture.button('查看「置顶学习项目」的全部会话');
      const controlAfter = !!collapseControl;
      const active = fixture.state().agent;
      fixture.root.unmount();
      return { preview, all, restored, selectedVisible, active, controlBefore, controlAfter, continuousRail };
    `)
    expect(result).toEqual({ preview: 7, all: 12, restored: 7, selectedVisible: true, active: 'pinned-preview', controlBefore: true, controlAfter: true, continuousRail: true })
  }, 30_000)

  test('When 当前会话位于第七条之后 Then 收起预览仍保留当前会话及其子会话', async () => {
    const result = await renderer.run<{ selectedVisible: boolean; childVisible: boolean; count: number; active: string }>(`
      const api = window.leftSidebarRegression, now = Date.now();
      const agents = Array.from({ length: 12 }, (_, index) => ({
        id: 'preview-' + index, title: '预览会话 ' + index, workspaceId: 'project-a', createdAt: now - index, updatedAt: now - index,
      }));
      agents.push({ id: 'selected-child', title: '当前子会话', workspaceId: 'project-a', parentSessionId: 'preview-10', sourceDelegationId: 'delegation', rootSessionId: 'preview-10', createdAt: now, updatedAt: now });
      const fixture = await api.mount({ agents, activeAgent: 'preview-10' });
      await api.until(() => fixture.row('preview-10'));
      const parent = fixture.row('preview-10');
      parent.scrollIntoView({ block: 'center' });
      parent.querySelector('button[aria-label="展开子会话"]').click();
      await api.until(() => fixture.row('selected-child'));
      fixture.row('selected-child').click();
      await api.until(() => fixture.state().delegation === 'selected-child');
      await api.until(() => fixture.row('preview-10') && fixture.row('selected-child'));
      const result = { selectedVisible: !!fixture.row('preview-10'), childVisible: !!fixture.row('selected-child'),
        count: agents.filter(agent => !!fixture.row(agent.id)).length, active: fixture.state().agent };
      fixture.root.unmount(); return result;
    `)
    expect(result).toEqual({ selectedVisible: true, childVisible: true, count: 8, active: 'preview-10' })
  }, 30_000)

  test('When 打开账户与齿轮设置入口 Then 显示本地身份并进入设置，不伪造云端套餐', async () => {
    const result = await renderer.run<{ name: boolean; local: boolean; initial: string; profileTab: string; settingsTab: string; gearIcon: boolean; noPlan: boolean }>(`
      const api = window.leftSidebarRegression, fixture = await api.mount({ userName: 'Charlie' });
      const account = fixture.button('个人资料与设置');
      const name = account.textContent.includes('Charlie'), local = account.textContent.includes('· 本地');
      const initial = account.querySelector('.gamma-sidebar-avatar').textContent.trim();
      await api.openMenu(account);
      const noPlan = !/Free|Pro|升级|云端账户/.test(document.querySelector('[role="menu"]').textContent);
      await api.chooseMenu('个人资料');
      await api.until(() => fixture.state().settings && fixture.state().settingsTab === 'general');
      const profileTab = fixture.state().settingsTab;
      fixture.closeSettings();
      const gear = fixture.button('设置');
      const gearIcon = gear.querySelector('svg.lucide-settings') !== null && gear.querySelector('svg.lucide-monitor-smartphone') === null;
      gear.click();
      await api.until(() => fixture.state().settings);
      const settingsTab = fixture.state().settingsTab;
      fixture.root.unmount(); return { name, local, initial, profileTab, settingsTab, gearIcon, noPlan };
    `)
    expect(result).toEqual({ name: true, local: true, initial: 'C', profileTab: 'general', settingsTab: 'general', gearIcon: true, noPlan: true })
  }, 30_000)

  test('When 从标题菜单创建空白或本地项目 Then 保留两种既有创建路径', async () => {
    const result = await renderer.run<{ blank: boolean; focused: boolean; folder: boolean; calls: unknown[] }>(`
      const api = window.leftSidebarRegression;
      const blankFixture = await api.mount();
      await api.openMenu(blankFixture.button('新建项目'));
      await api.chooseMenu('新建空白项目');
      await api.until(() => document.querySelector('input[aria-label="新项目名称"]'));
      const input = document.querySelector('input[aria-label="新项目名称"]');
      await api.until(() => document.activeElement === input);
      const focused = document.activeElement === input;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(input, '新的本地项目');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await api.until(() => blankFixture.state().workspace === 'created-project');
      const blank = blankFixture.state().workspace === 'created-project';
      const blankCalls = [...blankFixture.calls];
      blankFixture.root.unmount();
      const folderFixture = await api.mount({ folder: { path: '/tmp/gamma-local-project', name: '本地文件夹项目' } });
      await api.openMenu(folderFixture.button('新建项目'));
      await api.chooseMenu('从本地文件夹创建项目');
      await api.until(() => folderFixture.state().workspace === 'created-project');
      const folder = folderFixture.state().workspace === 'created-project';
      const calls = [...blankCalls, ...folderFixture.calls].filter(call => call.createProject);
      folderFixture.root.unmount(); return { blank, focused, folder, calls };
    `)
    expect(result.blank).toBe(true)
    expect(result.focused).toBe(true)
    expect(result.folder).toBe(true)
    expect(result.calls).toEqual([
      { createProject: { name: '新的本地项目' } },
      { createProject: { name: '本地文件夹项目', projectRootPath: '/tmp/gamma-local-project' } },
    ])
  }, 30_000)

  test('When 浅深主题与窄空侧栏展示 Then 图标文字基线稳定、底栏不溢出且空项目可操作', async () => {
    const results = await renderer.run<Array<{ dark: boolean; width: number; empty: boolean; fits: boolean; footer: boolean; emptyState: boolean; focus: boolean }>>(`
      const api = window.leftSidebarRegression, results = [];
      for (const dark of [false, true]) for (const empty of [false, true]) {
        const fixture = await api.mount({ dark, width: 200, agents: empty ? [] : undefined, userName: 'Charlie' });
        const sidebar = document.querySelector('.gamma-sidebar');
        const nodes = [sidebar, ...sidebar.querySelectorAll('nav, .gamma-sidebar-footer, [data-sidebar-scroll], [data-session-switch-id]')];
        const fits = nodes.every(node => node.scrollWidth <= node.clientWidth + 1);
        const footer = fixture.button('个人资料与设置').getBoundingClientRect().right < fixture.button('设置').getBoundingClientRect().left;
        const emptyState = !empty || document.body.textContent.includes('暂无会话');
        const target = empty ? fixture.button('新建项目') : fixture.row('parent').querySelector('button[aria-label="更多会话操作"]');
        if (empty) target.focus();
        else {
          fixture.row('parent').focus();
          fixture.row('parent').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
          target.focus();
        }
        await api.until(() => getComputedStyle(target).opacity === '1');
        const focus = document.activeElement === target
          && getComputedStyle(target).opacity === '1';
        results.push({ dark, width: sidebar.getBoundingClientRect().width, empty, fits, footer, emptyState, focus });
        fixture.root.unmount(); await api.delay();
      }
      return results;
    `)
    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result.width).toBe(200)
      expect(result.fits).toBe(true)
      expect(result.footer).toBe(true)
      expect(result.emptyState).toBe(true)
      expect(result.focus).toBe(true)
    }
  }, 30_000)
})
