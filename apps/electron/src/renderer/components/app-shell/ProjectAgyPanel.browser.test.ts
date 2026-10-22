import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness, type ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { projectAgyPanelFixture } from '../../../test-utils/project-agy-panel-fixture'

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(projectAgyPanelFixture) }, 180_000)
afterAll(async () => { await renderer?.dispose() })

describe('真实项目 AGY 工作区集成', () => {
  for (const platform of ['Win32', 'MacIntel']) {
    test(`Given ${platform} 的真实侧栏与 RightSidePanel When 点击 AGY Then 激活栏目并支持键盘输入和中文粘贴`, async () => {
      const result = await renderer.run<{ selected: string; before: number; launched: number; shellCreates: number; data: string[]; focus: boolean; errors: string[] }>(`
        const api=window.agyPanel;api.setPlatform(${JSON.stringify(platform)});
        await api.until(()=>api.sidebar());api.sidebar().click();
        await api.until(()=>api.selected()==='AGY' && document.querySelector('[role="alertdialog"]'));
        const before=api.opens.length;api.click('接受风险并启动');
        await api.until(()=>!document.querySelector('[role="alertdialog"]') && document.querySelector('.xterm-helper-textarea'));
        const textarea=document.querySelector('.xterm-helper-textarea');
        textarea.closest('.xterm').parentElement.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));
        textarea.dispatchEvent(new KeyboardEvent('keypress',{key:'g',charCode:103,keyCode:103,which:103,bubbles:true,cancelable:true}));
        const data=new DataTransfer();data.setData('text/plain','中文输入，不发送');
        textarea.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
        await api.until(()=>api.writes.some(input=>input.data.includes('中文输入')));
        return {selected:api.selected(),before,launched:api.launched(),shellCreates:api.shellCreates.length,data:api.writes.map(input=>input.data),focus:document.activeElement===textarea,errors:api.errors};
      `)
      expect(result).toMatchObject({ selected: 'AGY', before: 0, launched: 1, shellCreates: 0, focus: true, errors: [] })
      expect(result.data).toContain('g')
      expect(result.data.join('')).toContain('中文输入，不发送')
    }, 30_000)
  }

  test('Given 正在运行的终端 When 关闭栏目并重新点击侧栏 Then 原实例保留、隐藏仍响应协议查询且重新输入可用', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyPanel;await api.boot();
      const id=api.entry('a').terminal.terminalId,textarea=document.querySelector('.xterm-helper-textarea');
      document.querySelector('button[aria-label="关闭 AGY"]').click();
      await api.until(()=>!document.querySelector('.xterm-helper-textarea') && !api.tab('AGY'));
      api.emitQuery(id);await api.until(()=>api.writes.some(input=>input.terminalId===id && input.data.endsWith('R')));
      api.sidebar().click();await api.until(()=>api.selected()==='AGY' && document.querySelector('.xterm-helper-textarea'));
      const restored=document.querySelector('.xterm-helper-textarea');
      restored.closest('.xterm').parentElement.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));
      restored.dispatchEvent(new KeyboardEvent('keypress',{key:'r',charCode:114,keyCode:114,which:114,bubbles:true,cancelable:true}));
      await api.until(()=>api.writes.some(input=>input.data==='r'));
      return {sameDom:restored===textarea,sameId:api.entry('a').terminal.terminalId===id,launched:api.launched(),kills:api.kills.length,hasOriginalScreen:document.querySelector('.xterm').textContent.includes('AGY_READY'),errors:api.errors};
    `)).toEqual({ sameDom: true, sameId: true, launched: 1, kills: 0, hasOriginalScreen: true, errors: [] })
  }, 30_000)

  test('Given 会话归属 A 但全局选中 B When 打开 AGY 再切到 B 会话 Then 两个项目目录与进程始终独立', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyPanel;api.selectProjectOnly('b');await api.boot();
      const a=api.entry('a').terminal;
      api.switchSession('s-b');await api.boot();const b=api.entry('b').terminal;
      api.switchSession('s-a');await api.until(()=>api.selected()==='AGY' && document.querySelector('.xterm-helper-textarea'));
      return {projects:api.opens.map(input=>input.workspaceId).filter((id,index,list)=>index===0||list[index-1]!==id),cwdA:a.cwd,cwdB:b.cwd,independent:a.terminalId!==b.terminalId,returned:api.entry('a').terminal.terminalId===a.terminalId,launched:api.launched(),kills:api.kills.length,errors:api.errors};
    `)).toMatchObject({ cwdA: 'C:/Project A', cwdB: 'C:/Project B', independent: true, returned: true, launched: 2, kills: 0, errors: [] })
  }, 30_000)

  test('Given AGY 与文件 Tab When 实际拖动到右侧并调整宽度 Then 形成双 Pane、正确 resize 且不启动第二个终端', async () => {
    const measured = await renderer.run<{ split: boolean; narrowCols: number; fullCols: number; launched: number; kills: number; errors: string[] }>(`
      const api=window.agyPanel;await api.boot();
      api.stage='initial-resize';await api.until(()=>api.resizes.length>0);const fullCols=api.resizes.at(-1).cols;
      api.stage='select-files';api.tab('文件').click();await api.until(()=>api.selected()==='文件');
      api.stage='drag';await api.dragToRight();
      try { await api.until(()=>document.querySelector('section[aria-label="右侧 Pane：agy-terminal"]') && document.querySelector('.xterm-helper-textarea')); }
      catch(error){throw new Error(String(error)+' DRAG='+JSON.stringify(api.dragDebug));}
      api.stage='resize-split';await api.until(()=>api.resizes.at(-1).cols<fullCols);
      const narrowCols=api.resizes.at(-1).cols;api.size(620);await api.delay(80);
      return {split:!!document.querySelector('[role="separator"][aria-label^="调整并排宽度"]'),narrowCols,fullCols,launched:api.launched(),kills:api.kills.length,errors:api.errors};
    `)
    expect(measured.split).toBe(true)
    expect(measured.narrowCols).toBeLessThan(measured.fullCols)
    expect(measured).toMatchObject({ launched: 1, kills: 0, errors: [] })
  }, 30_000)

  test('Given 面板隐藏和再显示 When 用户已经转到其他输入框 Then 后台恢复不得抢走焦点，主动点击终端仍可聚焦', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyPanel;await api.boot();api.closePanel();await api.delay();
      const editor=document.createElement('input');editor.setAttribute('aria-label','其他输入');document.body.appendChild(editor);editor.focus();
      api.openPanel();await api.delay(100);const preserved=document.activeElement===editor;
      const textarea=document.querySelector('.xterm-helper-textarea');
      textarea.closest('.xterm').parentElement.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));
      return {preserved,clickFocus:document.activeElement===textarea,launched:api.launched(),errors:api.errors};
    `)).toEqual({ preserved: true, clickFocus: true, launched: 1, errors: [] })
  }, 30_000)

  test('Given 退出事件早于启动响应 When 恢复快照 Then 合并退出状态并显示可操作的重启按钮', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyPanel;api.exitEarly();await api.boot();
      await api.until(()=>document.querySelector('button[aria-label="重新启动 AGY"]'));
      const entry=api.entry('a');
      return {status:entry.status,exitCode:entry.terminal.exitCode,launched:api.launched(),errors:api.errors};
    `)).toEqual({ status: 'ready', exitCode: 9, launched: 1, errors: [] })
  }, 30_000)

  test('Given CLI 已退出 When 重新启动再结束进程 Then 只有显式操作创建新实例且无自动复活', async () => {
    expect(await renderer.run<Record<string, unknown>>(`
      const api=window.agyPanel;await api.boot();const first=api.entry('a').terminal.terminalId;api.exit(first);
      await api.until(()=>document.querySelector('button[aria-label="重新启动 AGY"]'));
      document.querySelector('button[aria-label="重新启动 AGY"]').click();
      await api.until(()=>api.entry('a')?.terminal?.terminalId!==first && api.entry('a')?.status==='ready');
      document.querySelector('button[aria-label="关闭终端"]').click();await api.until(()=>api.entry('a')?.status==='closed');
      await api.delay(80);
      return {launched:api.launched(),kills:api.kills.length,status:api.entry('a').status,errors:api.errors};
    `)).toEqual({ launched: 2, kills: 2, status: 'closed', errors: [] })
  }, 30_000)
})
