import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { composerRegressionFixture } from '../../../test-utils/composer-regression-fixture'

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(composerRegressionFixture) }, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实编辑器与 portal 引用建议', () => {
  for (const [trigger, role] of [['@', 'tree'], ['/', 'listbox'], ['#', 'listbox'], ['&', 'listbox']]) {
    test(`When ${trigger} 列表打开、导航和关闭 Then combobox 指向实际 ${role} 与高亮项且焦点留在编辑器`, async () => {
      expect(await renderer.run<{ opened: boolean; active: boolean; focus: boolean; moved: boolean; closed: boolean }>(`
        const f = await window.composerRegression.mount({ multiple: true });
        f.editor.commands.insertContent(${JSON.stringify(trigger)});
        await window.composerRegression.until(() => f.dom.getAttribute('aria-activedescendant'));
        const id = f.dom.getAttribute('aria-controls');
        const opened = f.dom.getAttribute('role') === 'combobox' && f.dom.getAttribute('aria-expanded') === 'true'
          && f.dom.getAttribute('aria-haspopup') === ${JSON.stringify(role)} && document.getElementById(id)?.getAttribute('role') === ${JSON.stringify(role)};
        const activeId = f.dom.getAttribute('aria-activedescendant');
        const active = document.getElementById(id).contains(document.getElementById(activeId)) && document.getElementById(activeId).getAttribute('aria-selected') === 'true';
        f.key('ArrowDown'); await window.composerRegression.delay();
        const moved = ${trigger === '@' || trigger === '/'} ? f.dom.getAttribute('aria-activedescendant') !== activeId : true;
        const focus = document.activeElement === f.dom;
        f.key('Escape'); await window.composerRegression.delay();
        const closed = f.dom.getAttribute('aria-expanded') === 'false' && !f.dom.hasAttribute('aria-controls')
          && !f.dom.hasAttribute('aria-activedescendant') && f.dom.getAttribute('role') !== 'combobox';
        f.root.unmount(); return { opened, active, focus, moved, closed };
      `)).toEqual({ opened: true, active: true, focus: true, moved: true, closed: true })
    }, 30_000)
  }

  test('When 查询重新加载且光标随后移出 Then 清除旧 active descendant，晚到结果不残留 ARIA', async () => {
    expect(await renderer.run<{ loadingCleared: boolean; closed: boolean }>(`
      const f = await window.composerRegression.mount({ loading: true });
      f.editor.commands.insertContent('@'); await window.composerRegression.delay(110); f.release();
      await window.composerRegression.until(() => f.dom.hasAttribute('aria-activedescendant'));
      f.editor.commands.insertContent('中文');
      const loadingCleared = !f.dom.hasAttribute('aria-activedescendant') && f.dom.getAttribute('aria-busy') === 'true';
      await window.composerRegression.delay(110);
      f.editor.commands.setTextSelection(1); f.release();
      await window.composerRegression.delay(160);
      const closed = f.dom.getAttribute('aria-expanded') === 'false' && !f.dom.hasAttribute('aria-controls') && !f.dom.hasAttribute('aria-activedescendant');
      f.root.unmount(); return { loadingCleared, closed };
    `)).toEqual({ loadingCleared: true, closed: true })
  }, 30_000)

  test('When 文件查询未完成就改为 Skill Then 旧 popup 清理不能移除新列表关系', async () => {
    expect(await renderer.run<{ current: boolean; selected: boolean }>(`
      const f = await window.composerRegression.mount({ loading: true });
      f.editor.commands.insertContent('@'); await window.composerRegression.delay(110);
      f.editor.commands.setContent('<p>/</p>'); f.editor.commands.setTextSelection(2);
      await window.composerRegression.until(() => f.dom.getAttribute('aria-haspopup') === 'listbox' && f.dom.hasAttribute('aria-activedescendant'));
      const id = f.dom.getAttribute('aria-controls'); f.release(); await window.composerRegression.delay(140);
      const current = f.dom.getAttribute('aria-expanded') === 'true' && f.dom.getAttribute('aria-controls') === id && document.getElementById(id)?.getAttribute('role') === 'listbox';
      const selected = !!document.getElementById(f.dom.getAttribute('aria-activedescendant'));
      f.root.unmount(); return { current, selected };
    `)).toEqual({ current: true, selected: true })
  }, 30_000)

  test('When 列表为空或失焦清理 Then 不保留失效 active descendant', async () => {
    expect(await renderer.run<{ empty: boolean; blurred: boolean }>(`
      const f = await window.composerRegression.mount({ empty: true });
      f.editor.commands.insertContent('@'); await window.composerRegression.delay(160);
      const empty = f.dom.getAttribute('aria-expanded') === 'true' && !!document.getElementById(f.dom.getAttribute('aria-controls')) && !f.dom.hasAttribute('aria-activedescendant');
      const button = document.createElement('button'); document.body.appendChild(button); button.focus();
      // harness 的 BrowserWindow 隐藏运行，不派发原生 blur；显式交付相同 DOM 事件。
      f.dom.dispatchEvent(new FocusEvent('blur', { relatedTarget: button }));
      await window.composerRegression.delay(140);
      const blurred = f.dom.getAttribute('aria-expanded') === 'false' && !f.dom.hasAttribute('aria-controls') && !f.dom.hasAttribute('aria-activedescendant');
      f.root.unmount(); return { empty, blurred };
    `)).toEqual({ empty: true, blurred: true })
  }, 30_000)
})
