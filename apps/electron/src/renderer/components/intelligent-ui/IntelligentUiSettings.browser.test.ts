import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import {createRoot} from 'react-dom/client';import {createStore,Provider} from 'jotai';
    import {GeneralSettings} from '@/components/settings/GeneralSettings';
    import {intelligentUiEnabledAtom,initializeUiPreferences} from '@/atoms/ui-preferences';
    import {Toaster} from 'sonner';import '@/styles/globals.css';
    const store=createStore(),root=createRoot(document.getElementById('root')),calls=[];
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    let resolveSave,rejectSave;
    window.electronAPI={getSettings:async()=>({intelligentUiEnabled:true,productivityTools:{todosEnabled:true,calendarEnabled:true}}),updateSettings:update=>{calls.push(update);return new Promise((resolve,reject)=>{resolveSave=resolve;rejectSave=reject})}};
    window.uiSettings={store,calls,sleep,
      resolve:()=>resolveSave({intelligentUiEnabled:true}),reject:()=>rejectSave(new Error('磁盘只读')),
      async mount(){await initializeUiPreferences(undefined,undefined,undefined,undefined,undefined,value=>store.set(intelligentUiEnabledAtom,value));root.render(React.createElement(Provider,{store},React.createElement(React.Fragment,null,React.createElement(GeneralSettings),React.createElement(Toaster))))},
      async until(predicate){for(let i=0;i<100;i++){if(predicate())return;await sleep(15)}throw new Error('设置未达到预期:'+document.body.innerText)}
    };
  `, { moduleStubs: {
    'components/computer-use/ComputerAuthorizationSetting.tsx': 'export const ComputerAuthorizationSetting=()=>null',
    'components/computer-use/ComputerRiskPolicySetting.tsx': 'export const ComputerRiskPolicySetting=()=>null',
  } })
}, 120000)
afterAll(async () => { await renderer?.dispose() })

describe('Intelligent UI 设置交互', () => {
  test('Given 已保存的开启设置 When 初始化与保存失败 Then 正确显示、保存中禁用且失败保持原状态', async () => {
    const result = await renderer.run<{ loaded: boolean; saving: boolean; failed: boolean; calls: number; feedback: boolean }>(`
      const g=window.uiSettings;await g.mount();await g.until(()=>document.querySelector('button[aria-label="Intelligent UI"]'));
      const button=document.querySelector('button[aria-label="Intelligent UI"]');const loaded=button.getAttribute('aria-checked')==='true';
      button.click();await g.until(()=>button.disabled);const saving=button.disabled;button.click();g.reject();
      await g.until(()=>!button.disabled&&document.body.innerText.includes('Intelligent UI 设置保存失败'));
      return {loaded,saving,failed:button.getAttribute('aria-checked')==='true',calls:g.calls.length,feedback:!!document.querySelector('[data-sonner-toast]')};
    `)
    expect(result).toEqual({ loaded: true, saving: true, failed: true, calls: 1, feedback: true })
  }, 30000)
})
