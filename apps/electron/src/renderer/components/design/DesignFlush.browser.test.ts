import { afterAll, beforeAll, expect, test } from 'bun:test'
import { DESIGN_EDITOR_FLUSH_SCRIPT } from '../../../main/lib/design-editor-flush'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => { renderer = await createElectronRendererHarness('') })
afterAll(async () => { await renderer?.dispose() })

test('Given 编辑器尚未初始化或脚本失败 When 请求保存屏障 Then 不把无监听器的空白页面误判为已保存', async () => {
  const result = await renderer.run<boolean>(`return await ${DESIGN_EDITOR_FLUSH_SCRIPT}`)
  expect(result).toBe(false)
})

test('Given 已渲染编辑器有未保存更改 When beforeunload 触发异步保存 Then 等待保存完成而非立即通过', async () => {
  const result = await renderer.run<{ saved: boolean; writes: number }>(`
    document.body.innerHTML='<div id="root"><button>Save</button></div>';
    let dirty=true,writes=0,started=false;
    const listener=event=>{if(dirty){event.preventDefault();if(!started){started=true;setTimeout(()=>{writes++;dirty=false},100)}}};
    window.addEventListener('beforeunload',listener);
    const saved=await ${DESIGN_EDITOR_FLUSH_SCRIPT};
    window.removeEventListener('beforeunload',listener);
    return {saved,writes};
  `)
  expect(result).toEqual({ saved: true, writes: 1 })
})

test('Given 历史预览或仍在加载的占位编辑器 When 交付 Then 不静默导出另一个版本', async () => {
  const result = await renderer.run<boolean[]>(`
    document.body.innerHTML='<div id="root"><button>Save</button></div>';
    window.__baoyuHistory={preview:true};
    const historyResult=await ${DESIGN_EDITOR_FLUSH_SCRIPT};
    window.__baoyuHistory={preview:false};
    document.querySelector('#root').insertAdjacentHTML('beforeend','<p data-placeholder>Loading</p>');
    return [historyResult,await ${DESIGN_EDITOR_FLUSH_SCRIPT}];
  `)
  expect(result).toEqual([false, false])
})
