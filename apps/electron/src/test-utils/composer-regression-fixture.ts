/** 输入回归使用真实 RichTextInput / Tiptap；IPC 仅返回隔离的内存数据。 */
export const composerRegressionFixture = `
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Provider, createStore } from 'jotai'
  import { RichTextInput } from '@/components/ai-elements/rich-text-input'
  import { TooltipProvider } from '@/components/ui/tooltip'
  import { richTextRenderingEnabledAtom } from '@/atoms/ui-preferences'
  import '@/styles/globals.css'
  const delay = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
    throw new Error('输入未达到预期：' + document.body.innerText);
  };
  window.composerRegression = {
    delay, until,
    async mount(options = {}) {
      let releaseSearch;
      window.electronAPI = {
        searchWorkspaceFiles: async () => {
          if (options.loading) await new Promise(resolve => { releaseSearch = resolve; });
          return { entries: options.empty ? [] : [{ name: '中文说明.md', path: '资料/中文说明.md', type: 'file', source: 'workspace' }, ...(options.multiple ? [{ name: '第二文件.md', path: '资料/第二文件.md', type: 'file', source: 'workspace' }] : [])] };
        },
        getWorkspaceCapabilities: async () => ({ skills: [{ name: '中文技能', slug: '中文技能', enabled: true, description: '测试' }, { name: '第二技能', slug: '第二技能', enabled: true, description: '测试' }], mcpServers: [{ name: '测试服务', type: 'stdio', enabled: true, lastTestResult: { success: true } }] }),
        searchAgentSessionReferences: async () => [{ sessionId: 'other', title: '中文会话' }],
      };
      const store = createStore(), root = createRoot(document.getElementById('root'));
      store.set(richTextRenderingEnabledAtom, true);
      const submissions = [], ref = React.createRef();
      function Fixture() {
        const [value, change] = React.useState('');
        return React.createElement(RichTextInput, { ref, value, onChange: change,
          onSubmit: text => submissions.push(text), enableMentions: true,
          workspacePath: '/fixture', workspaceSlug: 'fixture', sessionId: 'current',
          sendWithCmdEnter: !!options.cmd });
      }
      root.render(React.createElement(Provider, { store }, React.createElement(TooltipProvider, null, React.createElement(Fixture))));
      await until(() => document.querySelector('.tiptap')?.editor);
      const dom = document.querySelector('.tiptap'), editor = dom.editor;
      editor.commands.focus();
      return { root, dom, editor, submissions, ref,
        release: () => releaseSearch?.(),
        key: (key, extra = {}) => dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })),
      };
    }
  };
`;
