import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(String.raw`
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { Provider, createStore } from 'jotai'
    import { ProjectAgyTerminalView } from '@/components/tabs/ProjectAgyTerminalView'
    import { TerminalLifecycleObserver } from '@/components/tabs/TerminalLifecycleObserver'
    import { currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
    import { projectAgyTerminalsAtom, openProjectAgyTerminalAtom } from '@/atoms/project-agy-terminal-atoms'
    import { TooltipProvider } from '@/components/ui/tooltip'
    import '@/styles/globals.css'
    document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0}</style>')
    localStorage.clear()
    const delay = () => new Promise(resolve => setTimeout(resolve, 20))
    const until = async predicate => { for (let i=0;i<150;i++) { if(predicate()) return; await delay() } throw new Error('未达到预期状态：'+document.body.innerText) }
    const store = createStore()
    store.set(currentAgentWorkspaceIdAtom, 'a')
    store.set(agentWorkspacesAtom, [{ id:'a', name:'项目 A', slug:'a', projectRootPath:'C:\\Project A', createdAt:1, updatedAt:1 }, { id:'b', name:'项目 B', slug:'b', projectRootPath:'C:\\Project B', createdAt:1, updatedAt:1 }])
    const output = new Set(), exits = new Set(), closes = new Set()
    const states = new Map(), opened = [], killed = [], shellCreates = [], writes = [], resizes = []
    let sequence = 0, fails = false
    window.electronAPI = {
      openProjectAgyTerminal: async input => {
        opened.push(input)
        if (fails) throw new Error('未找到 agy 可执行文件')
        const terminalId = 'agy-'+input.workspaceId+'-'+(++sequence)
        const state = { terminalId, workspaceId:input.workspaceId, ownerId:'project-agy:'+input.workspaceId, title:'AGY', cwd:'C:\\Project '+input.workspaceId.toUpperCase(), profile:'default', pid:sequence }
        states.set(terminalId, { state, output:'AGY CLI READY', sequence:1 })
        return state
      },
      createTerminal: async input => { shellCreates.push(input) },
      getTerminalSnapshot: async id => states.get(id),
      resizeTerminal: async input => { resizes.push(input) }, acknowledgeTerminalOutput: () => {},
      writeTerminal: async input => { writes.push(input) },
      killTerminal: async terminalId => { killed.push(terminalId); states.delete(terminalId); closes.forEach(fn=>fn({sessionId:'project-agy:a',terminalId})) },
      onTerminalOutput: fn => { output.add(fn); return ()=>output.delete(fn) },
      onTerminalExit: fn => { exits.add(fn); return ()=>exits.delete(fn) },
      onAgentTerminalClose: fn => { closes.add(fn); return ()=>closes.delete(fn) },
      onAgentTerminalOpen: () => () => {},
    }
    const root = createRoot(document.getElementById('root'))
    const render = (visible, embedded = false) => root.render(React.createElement(Provider, {store}, React.createElement(TooltipProvider, {delayDuration:0}, React.createElement(React.Fragment, null, React.createElement(TerminalLifecycleObserver), visible ? React.createElement(ProjectAgyTerminalView, { embedded }) : null))))
    render(true)
    window.agyRegression = {
      store, opened, killed, shellCreates, writes, resizes, until, delay, render,
      entry: id => store.get(projectAgyTerminalsAtom).get(id),
      switchProject: id => store.set(currentAgentWorkspaceIdAtom,id),
      fail: value => { fails=value },
      click: text => { const button=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text); if(!button) throw new Error('找不到按钮：'+text); button.click() },
      exit: id => { const snapshot=states.get(id); snapshot.exitCode=0; exits.forEach(fn=>fn({terminalId:id,exitCode:0})) },
      emit: (id,data,sequence) => output.forEach(fn=>fn({terminalId:id,data,sequence})),
    }
  `)
}, 180_000)
afterAll(async () => { await renderer?.dispose() })

describe('项目级 AGY 原生终端 Chromium 验证', () => {
  test('Given 右侧工作区栏目形态 When 启动 AGY Then 使用紧凑标题栏且终端占满栏目高度', async () => {
    const measured = await renderer.run<{ headerHeight: number; hasProjectTitle: boolean; closeButton: boolean; terminalHeight: number }>(`
      const api=window.agyRegression;
      await api.until(()=>document.querySelector('[role="alertdialog"]')); api.click('接受风险并启动');
      await api.until(()=>api.entry('a')?.terminal && document.querySelector('.xterm-helper-textarea'));
      api.render(true, true);
      await api.until(()=>!document.querySelector('section[aria-label="项目级 AGY 终端"] header'));
      const section=document.querySelector('section[aria-label="项目级 AGY 终端"]');
      const screen=document.querySelector('.xterm-screen').getBoundingClientRect();
      return {
        headerHeight: Math.round(section.firstElementChild.getBoundingClientRect().height),
        hasProjectTitle: section.textContent.includes('项目 A'),
        closeButton: !!document.querySelector('button[aria-label="关闭终端"]'),
        terminalHeight: Math.round(screen.height),
      };
    `)
    // 嵌入形态不再重复大标题，仅保留 32px 工具栏；终端占据剩余高度。
    expect(measured.hasProjectTitle).toBe(false)
    expect(measured.headerHeight).toBeLessThanOrEqual(34)
    expect(measured.closeButton).toBe(true)
    expect(measured.terminalHeight).toBeGreaterThan(200)
  }, 30_000)

  test('Given 视图宽度可容纳更多列 When 附着既有 PTY Then 终端列数跟随真实视图而非固定 100 列', async () => {
    const measured = await renderer.run<{ resizedCols: number; screenWidth: number; viewWidth: number }>(`
      const api=window.agyRegression;
      await api.until(()=>document.querySelector('[role="alertdialog"]')); api.click('接受风险并启动');
      await api.until(()=>api.entry('a')?.terminal && document.querySelector('.xterm-helper-textarea'));
      await api.until(()=>api.resizes.length>0);
      const screen=document.querySelector('.xterm-screen').getBoundingClientRect();
      return { resizedCols:api.resizes.at(-1).cols, screenWidth:Math.round(screen.width), viewWidth:Math.round(document.querySelector('section[aria-label="项目级 AGY 终端"]').getBoundingClientRect().width) };
    `)
    // 初始创建为 100 列；附着真实 DOM 后必须按视口宽度重新计算。
    expect(measured.resizedCols).toBeGreaterThan(100)
    expect(measured.screenWidth).toBeGreaterThan(0)
    expect(measured.screenWidth).toBeLessThan(measured.viewWidth)
  }, 30_000)

  test('Given 首次进入 When 取消再接受风险 Then 确认前不启动，确认后直接附着 CLI 而不创建 shell', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyRegression;
      await api.until(()=>document.body.innerText.includes('接受风险并启动'));
      const before=api.opened.length;
      api.click('取消');
      await api.until(()=>!document.querySelector('[role="alertdialog"]'));
      const cancelled=api.opened.length;
      api.click('启动 AGY'); await api.until(()=>document.querySelector('[role="alertdialog"]'));
      api.click('接受风险并启动');
      await api.until(()=>api.entry('a')?.terminal && document.querySelector('.xterm-helper-textarea'));
      return { before, cancelled, launches:api.opened.length, confirmed:api.opened[0].skipPermissionsConfirmed, shellCreates:api.shellCreates.length, cwd:api.entry('a').terminal.cwd, warning:document.body.innerText.includes('跳过权限确认') };
    `)).toEqual({ before: 0, cancelled: 0, launches: 1, confirmed: true, shellCreates: 0, cwd: 'C:\\Project A', warning: true })
  }, 30_000)

  test('Given 已运行项目终端 When 隐藏并切换项目 Then 不终止旧进程且后台解析器继续响应终端查询', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyRegression;
      await api.until(()=>document.querySelector('[role="alertdialog"]')); api.click('接受风险并启动');
      await api.until(()=>api.entry('a')?.terminal && document.querySelector('.xterm-helper-textarea'));
      const original=api.entry('a').terminal.terminalId;
      api.render(false); await api.until(()=>!document.querySelector('.xterm-helper-textarea'));
      api.emit(original,'\\x1b[6n',2);
      await api.until(()=>api.writes.some(input=>input.terminalId===original));
      api.switchProject('b'); api.render(true);
      await api.until(()=>document.querySelector('[role="alertdialog"]')); api.click('接受风险并启动');
      await api.until(()=>api.entry('b')?.terminal);
      return { projects:api.opened.map(input=>input.workspaceId), killed:api.killed.length, originalRetained:api.entry('a').terminal.terminalId===original, cwdB:api.entry('b').terminal.cwd, shellCreates:api.shellCreates.length };
    `)).toEqual({ projects: ['a', 'b'], killed: 0, originalRetained: true, cwdB: 'C:\\Project B', shellCreates: 0 })
  }, 30_000)

  test('Given CLI 退出 When 显式重新启动再关闭 Then 仅用户操作重建进程且关闭后不自动复活', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyRegression;
      await api.until(()=>document.querySelector('[role="alertdialog"]')); api.click('接受风险并启动');
      await api.until(()=>!document.querySelector('[role="alertdialog"]'));
      await api.until(()=>api.entry('a')?.terminal);
      const original=api.entry('a').terminal.terminalId; api.exit(original);
      await api.until(()=>document.body.innerText.includes('重新启动'));
      const before=api.opened.length; api.click('重新启动');
      await api.until(()=>api.entry('a')?.terminal?.terminalId!==original && api.entry('a')?.status==='ready');
      const after=api.opened.length; api.click('关闭');
      await api.until(()=>api.entry('a')?.status==='closed'); await api.delay();
      return { before, after, killed:api.killed.length, status:api.entry('a').status, launches:api.opened.length };
    `)).toEqual({ before: 1, after: 2, killed: 2, status: 'closed', launches: 2 })
  }, 30_000)

  test('Given AGY 未安装 When 启动失败后修复并重试 Then 显示错误且可直接重试', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyRegression; api.fail(true);
      await api.until(()=>document.querySelector('[role="alertdialog"]')); api.click('接受风险并启动');
      await api.until(()=>document.body.innerText.includes('未找到 agy'));
      const failed=api.entry('a').status; api.fail(false); api.click('重试启动');
      await api.until(()=>api.entry('a')?.status==='ready');
      return { failed, status:api.entry('a').status, launches:api.opened.length, shellCreates:api.shellCreates.length };
    `)).toEqual({ failed: 'error', status: 'ready', launches: 2, shellCreates: 0 })
  }, 30_000)
})
