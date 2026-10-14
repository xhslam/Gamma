import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { WorkspacePanels } from '@/components/app-shell/WorkspacePanels'
    import { Panel } from '@/components/app-shell/Panel'
    import '@/styles/globals.css'
    document.documentElement.classList.add('gamma-main-window');
    const delay = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.viewportRegression = async options => {
      document.documentElement.classList.toggle('dark', !!options.dark);
      const root = createRoot(document.getElementById('root'));
      let clicks = 0;
      const history = React.createElement('div', { 'data-history': true, className: 'min-h-0 flex-1 overflow-y-auto' },
        React.createElement('div', { style: { height: options.longAgent ? 3200 : 20 } }, '历史内容'));
      const agent = React.createElement(Panel, null,
        React.createElement('header', { className: 'h-11 shrink-0' }, '当前会话'),
        React.createElement('div', { className: 'flex min-h-0 flex-1 flex-col overflow-hidden' }, history,
          React.createElement('input', { 'aria-label': '输入消息', className: 'h-12 shrink-0', onClick: () => clicks++ })));
      const workspace = options.open ? React.createElement('div', { className: 'flex h-full min-h-0 flex-col overflow-hidden', style: { width: 240 } },
        React.createElement('header', { className: 'h-11 shrink-0' }, '工作区'),
        React.createElement('div', { 'data-files': true, className: 'min-h-0 flex-1 overflow-y-auto' },
          React.createElement('div', { style: { height: options.longWorkspace ? 4800 : 20 } }, '项目文件'))) : null;
      root.render(React.createElement('div', { 'data-viewport': true, className: 'flex h-screen w-screen overflow-hidden', style: options.compact ? { width: 760, height: 360 } : undefined },
        options.collapsed ? null : React.createElement('aside', { className: 'h-full shrink-0', style: { width: 256 } }, '侧栏'),
        React.createElement('main', { className: 'flex min-w-0 min-h-0 flex-1 flex-col' },
          options.collapsed ? React.createElement('header', { className: 'h-11 shrink-0' }, '展开侧栏') : null,
          React.createElement(WorkspacePanels, { agent, workspace, workspaceSide: options.side, workspaceOpen: options.open, workspaceWidth: 240, minimumWidth: 200, maximumWidth: 400, onResizeStart: () => {}, onResizeKeyDown: () => {} }))));
      await delay();
      const input = document.querySelector('input'), rect = input.getBoundingClientRect();
      const viewport = document.querySelector('[data-viewport]').getBoundingClientRect();
      const visible = rect.top >= 0 && rect.bottom <= viewport.bottom;
      const reachable = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
      input.click(); input.focus(); input.value = '未发送草稿';
      const historyNode = document.querySelector('[data-history]'); historyNode.scrollTop = 100;
      const files = document.querySelector('[data-files]'); if (files) files.scrollTop = 100;
      const result = { visible, reachable, editable: document.activeElement === input && input.value === '未发送草稿' && clicks === 1,
        historyScrolls: !options.longAgent || historyNode.scrollTop > 0,
        filesScroll: !options.open || !options.longWorkspace || files.scrollTop > 0,
        contained: document.querySelector('[data-testid="agent-workspace-layout"]').getBoundingClientRect().bottom <= viewport.bottom,
        documentStill: document.documentElement.scrollTop === 0 && document.body.scrollTop === 0 };
      root.unmount(); return result;
    };
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 有界窗口中的 Agent 与展示工作区', () => {
  for (const collapsed of [false, true]) {
    for (const side of ['left', 'right']) {
      test(`When ${collapsed ? '收起' : '展开'}侧栏且工作区在${side}、双方内容很长 Then 输入可见可编辑且滚动留在面板内`, async () => {
        const result = await renderer.run(`return window.viewportRegression(${JSON.stringify({ collapsed, side, open: true, longAgent: true, longWorkspace: true })})`)
        expect(result).toEqual({ visible: true, reachable: true, editable: true, historyScrolls: true, filesScroll: true, contained: true, documentStill: true })
      }, 30_000)
    }
  }
  test('When 空会话且工作区关闭 Then 输入仍位于窗口内并可获得焦点', async () => {
    const result = await renderer.run(`return window.viewportRegression({collapsed:true,side:'right',open:false,longAgent:false,longWorkspace:false})`)
    expect(result).toEqual({ visible: true, reachable: true, editable: true, historyScrolls: true, filesScroll: true, contained: true, documentStill: true })
  }, 30_000)
  test('When 深浅主题的低高度窗口只有单侧内容很长 Then 长内容不影响另一侧输入和独立滚动', async () => {
    const results = await renderer.run(`
      const results = [];
      for (const dark of [false, true]) {
        for (const longAgent of [false, true]) {
          results.push(await window.viewportRegression({collapsed:true,side:'left',open:true,longAgent,longWorkspace:!longAgent,compact:true,dark}));
        }
      }
      return results;
    `)
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ visible: true, reachable: true, editable: true, historyScrolls: true, filesScroll: true, contained: true, documentStill: true })))
  }, 30_000)
})
