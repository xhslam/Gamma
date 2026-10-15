import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { composerRegressionFixture } from '../../../test-utils/composer-regression-fixture'

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness(composerRegressionFixture) }, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 多段落和光标后仍有文字的真实 Tiptap 文档', () => {
  for (const trigger of ['@', '/', '#', '&']) {
    test(`When 句中输入 ${trigger} 并选择中文引用 Then 只替换当前 range 并支持撤销重做`, async () => {
      const result = await renderer.run<{ before: string; after: string; undone: number; redone: number; count: number; char: string; text: string }>(`
        const f = await window.composerRegression.mount();
        f.editor.commands.setContent('<p>第一段</p><p>请查看后面的文字</p>');
        // 第二段起点为 6；在“请查看”后输入触发符，尾部必须保留。
        const secondStart = f.editor.state.doc.child(0).nodeSize + 1;
        f.editor.commands.setTextSelection(secondStart + 3);
        f.editor.commands.insertContent(${JSON.stringify(trigger)});
        await window.composerRegression.until(() => document.querySelector('[role="option"], [role="treeitem"]'));
        f.key('Enter');
        const mention = f.dom.querySelector('[data-type="mention"]');
        const before = f.editor.state.doc.child(0).textContent;
        const after = f.editor.state.doc.child(1).textContent;
        const char = mention?.getAttribute('data-mention-suggestion-char');
        const text = f.ref.current.getMarkdown();
        const count = f.dom.querySelectorAll('[data-type="mention"]').length;
        f.editor.commands.undo();
        const undone = f.dom.querySelectorAll('[data-type="mention"]').length;
        f.editor.commands.redo();
        const redone = f.dom.querySelectorAll('[data-type="mention"]').length;
        f.root.unmount(); return { before, after, undone, redone, count, char, text };
      `)
      expect(result.before).toBe('第一段')
      expect(result.after).toBe('请查看 后面的文字')
      expect(result.char).toBe(trigger)
      expect(result.count).toBe(1)
      expect(result.undone).toBe(0)
      expect(result.redone).toBe(1)
      expect(result.text).toContain('后面的文字')
    }, 30_000)
  }
  test('When 连续两个触发片段 Then 分别替换，前一个 chip 和光标后的中文均保留', async () => {
    expect(await renderer.run<{ count: number; tail: string; text: string }>(`
      const f = await window.composerRegression.mount();
      f.editor.commands.setContent('<p>开头后文</p>');
      f.editor.commands.setTextSelection(3);
      for (let i = 0; i < 2; i++) {
        f.editor.commands.insertContent('@中文');
        await window.composerRegression.until(() => document.querySelector('[role="treeitem"]'));
        f.key('Enter');
        await window.composerRegression.delay();
      }
      const result = { count: f.dom.querySelectorAll('[data-type="mention"]').length,
        tail: f.editor.state.doc.textContent, text: f.ref.current.getMarkdown() };
      f.root.unmount(); return result;
    `)).toEqual({ count: 2, tail: '开头  后文', text: `开头@file:${encodeURIComponent('资料/中文说明.md')} @file:${encodeURIComponent('资料/中文说明.md')} 后文` })
  }, 30_000)

  test('When 查询未返回就移动到另一段 Then 晚到结果不能复活旧弹窗', async () => {
    expect(await renderer.run<{ mentions: number; popup: boolean; text: string }>(`
      const f = await window.composerRegression.mount({ loading: true });
      f.editor.commands.setContent('<p>前段</p><p>后段</p>');
      f.editor.commands.setTextSelection(3);
      f.editor.commands.insertContent('@中文');
      await window.composerRegression.delay(110);
      f.editor.commands.setTextSelection(f.editor.state.doc.content.size - 1);
      f.release(); await window.composerRegression.delay(150);
      const result = { mentions: f.dom.querySelectorAll('[data-type="mention"]').length,
        popup: !!document.querySelector('[role="tree"]'), text: f.editor.getText() };
      f.root.unmount(); return result;
    `)).toEqual({ mentions: 0, popup: false, text: '前段@中文\n\n后段' })
  }, 30_000)

})
