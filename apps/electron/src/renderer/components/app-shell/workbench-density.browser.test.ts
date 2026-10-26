import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'
import { leftSidebarFixtureSource } from '../../../test-utils/left-sidebar-fixture'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(leftSidebarFixtureSource
    .replace('import { productivityToolsAtom }', 'import { workbenchDensityAtom, productivityToolsAtom }')
    .replace('root, calls,', 'root, calls, setDensity: value => store.set(workbenchDensityAtom, value),') + `
    import { RichTextInput } from '@/components/ai-elements/rich-text-input';
    import { InputToolbarOverflow } from '@/components/ai-elements/InputToolbarOverflow';
    import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
    window.mountWorkbench=async()=>{
      const store=createStore(),root=createRoot(document.getElementById('root')),writes=[];
      let fail=false;
      window.electronAPI={getSettings:async()=>({appIconVariant:'default'}),updateSettings:async update=>{if(fail)throw new Error('磁盘错误');writes.push(update);return update}};
      function Fixture(){
        const density=useAtomValue(workbenchDensityAtom),[value,setValue]=React.useState('保留我的草稿');
        return React.createElement('section',{'data-workbench-density':density},
          React.createElement('div',{'data-input-mode':'agent'},
            React.createElement('div',{className:'gamma-composer'},React.createElement(RichTextInput,{value,onChange:setValue,onSubmit:()=>{}})),
            React.createElement(InputToolbarOverflow,{items:[{key:'attach',node:React.createElement('button',{type:'button'},'附件')}],trailing:React.createElement('button',{type:'button'},'发送')})),
          React.createElement(AppearanceSettings));
      }
      root.render(React.createElement(Provider,{store},React.createElement(TooltipProvider,null,React.createElement(Fixture))));
      await until(()=>document.querySelector('.tiptap'));
      return {root,writes,setDensity:value=>store.set(workbenchDensityAtom,value),fail:value=>{fail=value}};
    };
  `)
}, 240_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 真实 Chromium 中的工作台密度', () => {
  test('When 在浅深主题切换密度 Then 会话、项目及工具导航行统一为34px 且保留键盘焦点', async () => {
    const results = await renderer.run<Array<{ row: number; project: number; nav: number; focused: boolean; dark: boolean }>>(`
      const api=window.leftSidebarRegression,results=[];
      for(const dark of [false,true]){
        const f=await api.mount({dark});
        await api.until(()=>f.row('parent'));
        const row=f.row('parent');row.focus();
        for(const density of ['compact','comfortable']){
          f.setDensity(density);await api.delay(80);
          results.push({row:row.getBoundingClientRect().height,project:document.querySelector('.gamma-sidebar-project-row').getBoundingClientRect().height,nav:document.querySelector('.gamma-sidebar-nav-item').getBoundingClientRect().height,focused:document.activeElement===row,dark:document.documentElement.classList.contains('dark')});
        }
        f.root.unmount();await api.delay();
      }
      return results;
    `)
    expect(results).toEqual([
      { row: 34, project: 34, nav: 34, focused: true, dark: false },
      { row: 34, project: 34, nav: 34, focused: true, dark: false },
      { row: 34, project: 34, nav: 34, focused: true, dark: true },
      { row: 34, project: 34, nav: 34, focused: true, dark: true },
    ])
  }, 30_000)

  test('When 切换密度 Then 输入圆角为 12/14px、底部行独立且编辑焦点草稿不丢失', async () => {
    const result = await renderer.run<{ before: string; after: string; focus: boolean; draft: boolean; independent: boolean; theme: boolean }>(`
      document.documentElement.classList.add('dark','theme-ocean-dark');
      const f=await window.mountWorkbench(),dom=document.querySelector('.tiptap');
      dom.focus();const before=getComputedStyle(document.querySelector('.gamma-composer')).borderRadius;
      f.setDensity('comfortable');await window.leftSidebarRegression.delay(80);
      const after=getComputedStyle(document.querySelector('.gamma-composer')).borderRadius;
      const result={before,after,focus:document.activeElement===dom,draft:dom.textContent.includes('保留我的草稿'),independent:document.querySelector('.gamma-composer-footer').previousElementSibling.classList.contains('gamma-composer'),theme:document.documentElement.classList.contains('theme-ocean-dark')};
      f.root.unmount();return result;
    `)
    expect(result).toEqual({ before: '12px', after: '14px', focus: true, draft: true, independent: true, theme: true })
  }, 30_000)

  test('When 外观设置保存失败再重试 Then 显示错误、保持旧密度且仅持久化密度字段', async () => {
    const result = await renderer.run<{ failure: boolean; retained: boolean; saved: boolean; writes: unknown[] }>(`
      const f=await window.mountWorkbench(),api=window.leftSidebarRegression;
      const button=[...document.querySelectorAll('button')].find(node=>node.textContent==='舒适');
      f.fail(true);button.click();await api.delay(80);
      const failure=document.body.textContent.includes('工作台密度保存失败'),retained=document.querySelector('section[data-workbench-density]').dataset.workbenchDensity==='compact';
      f.fail(false);button.click();await api.delay(80);
      const saved=document.querySelector('section[data-workbench-density]').dataset.workbenchDensity==='comfortable';
      const result={failure,retained,saved,writes:f.writes};f.root.unmount();return result;
    `)
    expect(result).toEqual({ failure: true, retained: true, saved: true, writes: [{ workbenchDensity: 'comfortable' }] })
  }, 30_000)
})
