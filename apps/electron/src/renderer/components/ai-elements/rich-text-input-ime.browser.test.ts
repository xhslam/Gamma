import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { composerRegressionFixture } from '../../../test-utils/composer-regression-fixture'

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(composerRegressionFixture) }, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given Chromium 中的真实富文本输入', () => {
  test('When composition ref / 原生标志 / compositionend 后 229 确认候选 Then 不发送，后续 Enter 正常发送', async () => {
    expect(await renderer.run<{ protectedCount: number; submissions: string[] }>(`
      const f = await window.composerRegression.mount();
      f.editor.commands.insertContent('中文草稿');
      f.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      f.key('Enter');
      f.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      f.key('Enter', { isComposing: true });
      f.key('Enter', { keyCode: 229 });
      const protectedCount = f.submissions.length;
      await window.composerRegression.delay(30);
      f.key('Enter', { keyCode: 13 });
      const result = { protectedCount, submissions: f.submissions };
      f.root.unmount(); return result;
    `)).toEqual({ protectedCount: 0, submissions: ['中文草稿'] })
  }, 30_000)

  test('When 文件建议正在等待 IPC 或列表为空 Then Enter/Tab 不发送；IME 也不选中建议', async () => {
    expect(await renderer.run<{ loading: number; imeMentionCount: number; submissions: number; mentions: number }>(`
      const f = await window.composerRegression.mount({ loading: true });
      f.editor.commands.insertContent('@中文');
      await window.composerRegression.delay(110);
      f.key('Enter'); f.key('Tab');
      const loading = f.submissions.length;
      f.release();
      await window.composerRegression.until(() => document.querySelector('[role="option"], [role="treeitem"]'));
      f.key('Enter', { keyCode: 229 });
      const imeMentionCount = f.dom.querySelectorAll('[data-type="mention"]').length;
      f.key('Enter');
      const result = { loading, imeMentionCount, submissions: f.submissions.length, mentions: f.dom.querySelectorAll('[data-type="mention"]').length };
      f.root.unmount(); return result;
    `)).toEqual({ loading: 0, imeMentionCount: 0, submissions: 0, mentions: 1 })
  }, 30_000)

  test('When Cmd/Ctrl+Enter 偏好或代码块/列表换行 Then 保留原有行为', async () => {
    expect(await renderer.run<{ plainEnter: number; sent: number }>(`
      const f = await window.composerRegression.mount({ cmd: true });
      f.editor.commands.insertContent('草稿'); f.key('Enter');
      const plainEnter = f.submissions.length;
      f.key('Enter', { ctrlKey: true });
      f.editor.commands.setContent('<pre><code>代码</code></pre>');
      f.editor.commands.setTextSelection(2); f.key('Enter', { ctrlKey: true });
      const result = { plainEnter, sent: f.submissions.length };
      f.root.unmount(); return result;
    `)).toEqual({ plainEnter: 0, sent: 1 })
  }, 30_000)
  test('When IPC 返回空建议 Then Enter/Tab 不发送也不拆分草稿，Escape 仍可关闭', async () => {
    expect(await renderer.run<{ count: number; text: string; expanded: boolean }>(`
      const f = await window.composerRegression.mount({ empty: true });
      f.editor.commands.insertContent('@无匹配');
      await window.composerRegression.delay(150);
      f.key('Enter'); f.key('Tab');
      const text = f.editor.getText();
      f.key('Escape');
      await window.composerRegression.delay();
      const result = { count: f.submissions.length, text, expanded: !!document.querySelector('[role="tree"]') };
      f.root.unmount(); return result;
    `)).toEqual({ count: 0, text: '@无匹配', expanded: false })
  }, 30_000)

  test('When 输入框为空按 Backspace Then 触发 onBackspaceEmpty 回调；包含 @文件 或文本时不拦截', async () => {
    expect(await renderer.run<{ nonEmptyIntercepted: boolean; emptyIntercepted: boolean }>(`
      let backspaceInterceptCount = 0;
      const f = await window.composerRegression.mount({
        onBackspaceEmpty: () => {
          backspaceInterceptCount++;
          return true;
        }
      });

      // 输入框有内容或 @文件 提及
      f.editor.commands.setContent('@说明.md');
      f.key('Backspace');
      const nonEmptyIntercepted = backspaceInterceptCount > 0;

      // 清空富文本框
      f.editor.commands.clearContent();
      f.key('Backspace');
      const emptyIntercepted = backspaceInterceptCount === 1;

      const result = { nonEmptyIntercepted, emptyIntercepted };
      f.root.unmount();
      return result;
    `)).toEqual({ nonEmptyIntercepted: false, emptyIntercepted: true })
  }, 30_000)
})
