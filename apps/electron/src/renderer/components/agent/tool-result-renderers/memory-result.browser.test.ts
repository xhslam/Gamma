import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryResultRenderer} from '@/components/agent/tool-result-renderers/memory-result';
    import {getProcessActionLabel} from '@/components/agent/process-timeline-presentation';
    import '@/styles/globals.css';
    const root=createRoot(document.getElementById('root'));
    window.memoryResultTest={label:getProcessActionLabel,mount:async(props)=>{root.render(React.createElement(MemoryResultRenderer,props));await new Promise(r=>setTimeout(r,80));}};
  `)
}, 60_000)
afterAll(async () => { await renderer?.dispose() })

describe('真实工具结果的记忆呈现', () => {
  test('Given 两个成功版本头 When 展开 Then 数量为2、默认收起且可查看正文', async () => {
    expect(await renderer.run<unknown>(`
      const result='global:/topics/a.md\\n[version: abc] [size: 12 bytes] [offset: 0]\\n第一份正文\\n\\nworkspace:/topics/b.md\\n[version: def] [size: 12 bytes] [offset: 0]\\n第二份正文';
      await window.memoryResultTest.mount({toolName:'memory_read',result,isError:false});
      const details=document.querySelector('details');const collapsed=!details.open;
      document.querySelector('summary').click();
      return {collapsed,open:details.open,label:document.querySelector('summary').textContent,content:details.textContent.includes('第二份正文')};
    `)).toEqual({ collapsed: true, open: true, label: '已读取 2 条记忆', content: true })
  }, 30_000)

  test('Given 失败或无版本正文 When 渲染 Then 不显示已读取或已更新', async () => {
    expect(await renderer.run<unknown>(`
      await window.memoryResultTest.mount({toolName:'memory_read',result:'version conflict',isError:true});
      const error=document.body.innerText;
      await window.memoryResultTest.mount({toolName:'memory_write',result:'saved. [version: abc]',isError:true});
      return {read:!error.includes('已读取'),write:!document.body.innerText.includes('已更新')};
    `)).toEqual({ read: true, write: true })
  }, 30_000)

  test('Given 批量请求 When 生成动作 Then 保留双作用域、不声称成功', async () => {
    expect(await renderer.run<unknown>(`return window.memoryResultTest.label({name:'memory_read',input:{path:['global:/topics/a.md','workspace:/topics/a.md']}})`))
      .toEqual({ action: '读取记忆', object: 'global:/topics/a.md、workspace:/topics/a.md', monospace: true })
  }, 30_000)
})
