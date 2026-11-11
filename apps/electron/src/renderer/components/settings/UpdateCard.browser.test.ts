import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
beforeAll(async () => {
  renderer = await createElectronRendererHarness(`
    import React from 'react';import{createRoot}from'react-dom/client';import{createStore,Provider}from'jotai';
    import{UpdateCard}from'@/components/settings/AboutSettings';import{VersionHistory}from'@/components/settings/VersionHistory';
    import{updateStatusAtom,updaterAvailableAtom}from'@/atoms/updater';import'@/styles/globals.css';
    const store=createStore(),root=createRoot(document.getElementById('root')),calls=[];
    window.electronAPI={updater:{installWhenIdle:async()=>{calls.push('install');store.set(updateStatusAtom,s=>({...s,installScheduled:true}));return true},cancelIdleInstall:async()=>{calls.push('cancel');store.set(updateStatusAtom,s=>({...s,installScheduled:false}))},revealDownloadedUpdate:async()=>{calls.push('reveal');return true}},listReleases:async()=>{throw new Error(\"Error invoking remote method 'github-release:list': Error: GitHub API 请求过于频繁，请稍后再试\")}};
    window.updateTest={calls,store,statusAtom:updateStatusAtom,
      mount(reason,history=false){store.set(updateStatusAtom,{status:'downloaded',version:'0.19.260',manualInstallReason:reason});root.render(React.createElement(Provider,{store},React.createElement(history?VersionHistory:UpdateCard)))},
      async until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw new Error(document.body.innerText)}
    };
  `)
}, 120_000)
afterAll(async () => { await renderer?.dispose() })

describe('Given 已下载更新的真实设置界面', () => {
  test('When Mac 使用临时签名 Then 显示替换原因与安装包入口，不再提供无法工作的空闲安装', async () => {
    const result = await renderer.run<{ manual: boolean; noIdle: boolean; calls: string[] }>(`
      const t=window.updateTest;t.mount('当前为临时签名版本，请使用安装包替换应用。');
      await t.until(()=>document.body.innerText.includes('显示安装包'));
      const manual=document.body.innerText.includes('临时签名'),noIdle=!document.body.innerText.includes('空闲时更新');
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('显示安装包')).click();await t.until(()=>t.calls.length);
      return{manual,noIdle,calls:t.calls};
    `)
    expect(result).toEqual({ manual: true, noIdle: true, calls: ['reveal'] })
  }, 30_000)
  test('When 签名支持原生更新 Then 保留空闲安排与取消流程', async () => {
    const result = await renderer.run<string[]>(`
      const t=window.updateTest;t.mount();await t.until(()=>document.body.innerText.includes('空闲时更新'));
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('空闲时更新')).click();
      await t.until(()=>document.body.innerText.includes('取消安排'));
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('取消安排')).click();await t.until(()=>t.calls.length===2);return t.calls;
    `)
    expect(result).toEqual(['install', 'cancel'])
  }, 30_000)
  test('When 缓存包丢失或显示失败 Then 保留已下载状态并展示可恢复的错误', async () => {
    const result = await renderer.run<string>(`
      const t=window.updateTest;window.electronAPI.updater.revealDownloadedUpdate=async()=>{throw new Error('更新包不存在，请重新检查更新')};t.mount('临时签名');
      await t.until(()=>document.body.innerText.includes('显示安装包'));[...document.querySelectorAll('button')].find(b=>b.textContent.includes('显示安装包')).click();
      await t.until(()=>document.querySelector('[role=alert]'));return document.querySelector('[role=alert]').textContent;
    `)
    expect(result).toContain('更新包不存在')
  }, 30_000)
  test('When 检查成功且无更高版本 Then 显示已是最新版本而不是检查失败', async () => {
    const result = await renderer.run<string>(`
      const t=window.updateTest;t.mount();t.store.set(t.statusAtom,{status:'not-available'});
      await t.until(()=>document.body.innerText.includes('已是最新版本'));return document.body.innerText;
    `)
    expect(result).toContain('已是最新版本')
    expect(result).not.toContain('检查失败')
  }, 30_000)
  test('When 更新请求真正失败 Then 直接展示具体原因，不误报最新版本', async () => {
    const result = await renderer.run<string>(`
      const t=window.updateTest;t.mount();t.store.set(t.statusAtom,{status:'error',error:'无法连接更新服务器，请检查网络'});
      await t.until(()=>document.querySelector('[role=alert]'));return document.body.innerText;
    `)
    expect(result).toContain('检查失败')
    expect(result).toContain('无法连接更新服务器')
    expect(result).not.toContain('已是最新版本')
  }, 30_000)
  test('When 手动检查 IPC 异常 Then 捕获异常并显示可重试的错误', async () => {
    const result = await renderer.run<string>(`
      const t=window.updateTest;t.mount();t.store.set(t.statusAtom,{status:'idle'});
      window.electronAPI.updater.checkForUpdates=async()=>{throw new Error('更新服务暂时不可用')};
      await t.until(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('检查更新')));
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('检查更新')).click();
      await t.until(()=>document.querySelector('[role=alert]'));return document.querySelector('[role=alert]').textContent;
    `)
    expect(result).toContain('更新服务暂时不可用')
  }, 30_000)
  test('When 版本历史 IPC 通道包含冒号 Then 只显示中文错误，不泄漏 Electron 包装前缀', async () => {
    const result = await renderer.run<string>(`
      const t=window.updateTest;t.mount(undefined,true);await t.until(()=>document.body.innerText.includes('加载失败'));return document.body.innerText;
    `)
    expect(result).toContain('GitHub API 请求过于频繁')
    expect(result).not.toContain('Error invoking remote method')
  }, 30_000)
})
