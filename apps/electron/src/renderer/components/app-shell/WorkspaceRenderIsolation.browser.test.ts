import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { leftSidebarFixtureSource } from '../../../test-utils/left-sidebar-fixture'

// 在隔离入口中给真实组件函数计数；保留组件导出自身的 memo 边界，不在测试中额外加 memo。
const fixtureSource = leftSidebarFixtureSource
  .replace("import { CollapsedSidebarHeader }", "import { MainArea } from '@/components/tabs/MainArea'\n  import { CollapsedSidebarHeader }")
  .replace('function Layout({ width = 256 }) {', `
    const counts = { layout: 0, sidebar: 0, main: 0 };
    function countRenders(Component, key) {
      const render = typeof Component === 'function' ? Component : Component.type;
      const counted = props => { counts[key]++; return render(props); };
      if (typeof Component === 'function') return counted;
      Component.type = counted;
      return Component;
    }
    const CountedSidebar = countRenders(LeftSidebar, 'sidebar');
    const CountedMainArea = countRenders(MainArea, 'main');
    window.workspaceRenderIsolation = {
      counts, withMainArea: false, errors: rendererErrors,
      rename: (fixture, id, title) => fixture.store.set(agentSessionsAtom, previous =>
        previous.map(session => session.id === id ? { ...session, title } : session)),
      showAgy: fixture => fixture.store.set(activeViewAtom, 'agy-terminal'),
    };
    function Layout({ width = 256 }) {
      counts.layout++;
      const [, setParentWidth] = React.useState(660);
      const [sidebarWidth, setSidebarWidth] = React.useState(width);
      window.workspaceRenderIsolation.resizeParent = setParentWidth;
      window.workspaceRenderIsolation.resizeSidebar = setSidebarWidth;
  `)
  .replace('{ collapsed, width },', '{ collapsed, width: sidebarWidth },')
  .replace('React.createElement(LeftSidebar, { width, noTransition: true })', 'React.createElement(CountedSidebar, { width: sidebarWidth, noTransition: true })')
  .replace("React.createElement('div', { 'data-testid': 'fixture-content', style: { flex: 1 } })", `React.createElement('div', { 'data-testid': 'fixture-content', style: { flex: 1 } },
        window.workspaceRenderIsolation.withMainArea ? React.createElement(CountedMainArea) : null)`)
  .replace('store.set(activeTabIdAtom, activeId);', `store.set(activeTabIdAtom, activeId);
      // 主区保持在尚未加载 settings 的空会话态，不调用模型或读取用户历史。
      if (window.workspaceRenderIsolation.withMainArea) {
        store.set(tabsAtom, []); store.set(activeTabIdAtom, null);
      }`)
  .replace('root, calls,', 'root, calls, store,')

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(fixtureSource) }, 180_000)
afterAll(async () => { await renderer?.dispose() })

describe('工作区父布局与内容渲染隔离', () => {
  test('Given 真实侧栏与主区已挂载 When 父布局连续调整宽度 Then 两个无关组件不重复执行', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.workspaceRenderIsolation, sidebar=window.leftSidebarRegression;
      api.withMainArea=true;const fixture=await sidebar.mount();
      const before={...api.counts};
      for(let step=0;step<6;step++){api.resizeParent(600+step*8);await sidebar.delay()}
      const result={layout:api.counts.layout-before.layout,sidebar:api.counts.sidebar-before.sidebar,main:api.counts.main-before.main,errors:api.errors};
      fixture.root.unmount();return result;
    `)).toEqual({ layout: 6, sidebar: 0, main: 0, errors: [] })
  }, 30_000)

  test('Given 侧栏存在渲染边界 When 会话 atom 或 width prop 更新 Then 标题与宽度仍及时刷新', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.workspaceRenderIsolation, sidebar=window.leftSidebarRegression, fixture=await sidebar.mount();
      const before=api.counts.sidebar;
      api.rename(fixture,'parent','已更新的会话标题');await sidebar.until(()=>fixture.row('parent').textContent.includes('已更新的会话标题'));
      const atomUpdated=api.counts.sidebar>before,afterAtom=api.counts.sidebar;
      api.resizeSidebar(280);await sidebar.until(()=>document.querySelector('.gamma-sidebar').style.width==='280px');
      const result={atomUpdated,propUpdated:api.counts.sidebar>afterAtom,width:document.querySelector('.gamma-sidebar').style.width,errors:api.errors};
      fixture.root.unmount();return result;
    `)).toEqual({ atomUpdated: true, propUpdated: true, width: '280px', errors: [] })
  }, 30_000)

  test('Given 主区跳过父布局更新 When 自身视图 atom 切到 AGY Then 仍渲染真实 AGY 界面', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.workspaceRenderIsolation, sidebar=window.leftSidebarRegression;
      api.withMainArea=true;const fixture=await sidebar.mount(),before=api.counts.main;
      api.showAgy(fixture);await sidebar.until(()=>document.querySelector('section[aria-label="项目级 AGY 终端"]'));
      const result={updated:api.counts.main>before,rendered:!!document.querySelector('section[aria-label="项目级 AGY 终端"]'),errors:api.errors};
      fixture.root.unmount();return result;
    `)).toEqual({ updated: true, rendered: true, errors: [] })
  }, 30_000)
})
