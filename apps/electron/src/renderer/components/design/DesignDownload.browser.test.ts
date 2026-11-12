import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DESIGN_BUNDLE_REVISION } from '@gamma/shared'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gamma-native-design-download-'))
  const module = join(directory, 'controller.cjs')
  await build({
    stdin: { contents: 'export { BrowserController } from "./browser-controller";export {flushDesignEditor} from "./design-editor-flush"; export { registerDesignEditorOrigin } from "./design-browser-policy"; export { buildGammaBrowserUserAgent } from "./browser-identity";', resolveDir: resolve(import.meta.dir, '../../../main/lib'), loader: 'ts' },
    outfile: module, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    plugins: [{ name: 'isolated-design-settings', setup(builder) { builder.onLoad({ filter: /[/\\]settings-service\.ts$/ }, () => ({ contents: 'export const getSettings = () => ({browserRiskDisclaimerVersion:999})', loader: 'ts' })) } }],
  })
  const share = resolve(import.meta.dir, '../../../../resources/design-bundle', DESIGN_BUNDLE_REVISION, 'skills/claude-design/scripts/editor/share-ui.js')
  renderer = await createElectronRendererHarness('window.downloadTests={};', {
    preloadSource: `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('designDownloads',{run:kind=>ipcRenderer.invoke('download:run',kind)});`,
    mainProcessSetup: `
      const {ipcMain,WebContentsView,session}=require('electron');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
      const {BrowserController,registerDesignEditorOrigin,buildGammaBrowserUserAgent,flushDesignEditor}=require(${JSON.stringify(module)});
      const controller=new BrowserController();const traces=[];controller.trace=(...args)=>traces.push(args.slice(2));
      const payload=Buffer.from('complete design bytes');const requests=[];let view;let profile;let currentKind;let complete;let dialogOptions;
      const server=http.createServer((req,res)=>{
        requests.push([req.method,req.url]);
        if(req.url==='/share-ui.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fs.readFileSync(${JSON.stringify(share)}));return}
        if(req.url==='/__share/archive'){
          res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition','attachment; filename="whole-design.zip"');res.setHeader('Content-Length',payload.length);res.end(req.method==='HEAD'?undefined:payload);return
        }
        if(req.url==='/_api/write'){setTimeout(()=>{res.statusCode=currentKind==='writefail'?500:200;res.end('saved')},120);return}
        if(req.url==='/stream'){res.setHeader('Content-Disposition','attachment; filename="stream.bin"');res.write(payload.subarray(0,8));setImmediate(()=>res.end(payload.subarray(8)));return}
        if(req.url.includes('__share')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({role:'owner',links:{},lan:false}));return}
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><body><script>window.scriptErrors=[];window.onerror=(message)=>window.scriptErrors.push(String(message));window.__baoyuShare={role:"owner"}</script><script src="/share-ui.js"></script></body></html>');
      });
      app.once('will-quit',()=>server.close());
      ipcMain.handle('download:run',async(_,kind)=>{
        currentKind=kind;requests.length=0;traces.length=0;dialogOptions=undefined;
        const editor='http://127.0.0.1:'+server.address().port+'/design/artifact/';registerDesignEditorOrigin(editor);
        await view.webContents.loadURL(editor);
        if(kind==='write'||kind==='writefail'){
          await view.webContents.executeJavaScript(${JSON.stringify('document.body.insertAdjacentHTML("beforeend", \'<div id="root"><button>Save</button></div>\'); void fetch("/_api/write", {method:"POST",body:"changed"})')});
          try{await flushDesignEditor(view.webContents,editor,()=>controller.designSaveTrackers.get(profile).wait(view.webContents.id));return {saved:true,requests:[...requests]}}catch(error){return {saved:false,error:error.message}}
        }
        const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('下载未完成')),10000);complete=result=>{clearTimeout(timer);resolve(result)}});
        if(kind==='archive'){const ready=await view.webContents.executeJavaScript('({archive:typeof window.__baoyuArchive,errors:window.scriptErrors,share:window.__baoyuShare})');if(ready.archive==='undefined')throw new Error(JSON.stringify(ready));await view.webContents.executeJavaScript('window.__baoyuArchive.download()')}
        else await view.webContents.executeJavaScript('(()=>{const a=document.createElement("a");a.download="'+kind+'.bin";a.href='+JSON.stringify(kind==='blob'?'':kind==='data'?'data:application/octet-stream;base64,'+payload.toString('base64'):'http://127.0.0.1:'+server.address().port+'/stream')+';'+(kind==='blob'?'a.href=URL.createObjectURL(new Blob(['+JSON.stringify(payload.toString())+']));':'')+'document.body.append(a);a.click();a.remove()})()');
        const result=await done;return {...result,requests:[...requests],dialogOptions,traces:[...traces]};
      });
    `,
    mainProcessReady: `await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));`,
    mainWindowSetup: `
      profile=session.fromPartition('design-download-test');profile.setUserAgent(buildGammaBrowserUserAgent(profile.getUserAgent(),'test'));
      view=new WebContentsView({webPreferences:{session:profile,sandbox:true,nodeIntegration:false,contextIsolation:true}});
      const tab={tabId:'editor',view};const record={sessionId:'session',browserSession:profile,tabs:new Map([['editor',tab]])};controller.sessions.set('session',record);
      controller.installSessionGuards(profile);controller.installDownloadGuard(profile);
      // 不弹出无人值守的系统对话框；记录生产配置，再由测试选择临时保存路径。
      profile.on('will-download',(_,item)=>{
        dialogOptions=item.getSaveDialogOptions();const output=path.join(${JSON.stringify(directory)},currentKind+'.bin');item.setSavePath(output);
        item.once('done',(_,state)=>complete({state,bytes:fs.existsSync(output)?fs.readFileSync(output).toString():null,path:item.getSavePath()}));
      });
    `,
  })
}, 120_000)
afterAll(async () => { await renderer?.dispose(); if (directory) await rm(directory, { recursive: true, force: true }) })

describe('Given 已登记 Design 页面与真实 Electron 下载事件', () => {
  for (const kind of ['blob', 'data', 'stream', 'archive']) {
    test(`When 下载 ${kind} Then 保存字节正确，提供原生保存对话框选项并返回真实路径`, async () => {
      const result = await renderer.run<{ state: string; bytes: string; path: string; dialogOptions: { title: string; properties: string[] }; requests: string[][]; traces: unknown[][] }>(`return await window.designDownloads.run(${JSON.stringify(kind)})`)
      expect(result.state).toBe('completed')
      expect(result.bytes).toBe('complete design bytes')
      expect(result.path).toBe(join(directory, `${kind}.bin`))
      expect(result.dialogOptions.title).toBe('保存设计稿')
      expect(result.dialogOptions).toHaveProperty('defaultPath')
      if (kind === 'archive') {
        expect(result.requests).toContainEqual(['HEAD', '/__share/archive'])
        expect(result.requests).toContainEqual(['GET', '/__share/archive'])
      }
      expect(result.traces.some(trace => String(trace[1]).includes(result.path))).toBe(true)
    }, 30_000)
  }
})

for (const kind of ['write','writefail']) {
  test(`Given 真实编辑器写请求 ${kind} When 下载前等待保存 Then 未完成或失败的网络写入不能被跳过`, async () => {
    const result = await renderer.run<{ saved: boolean; error?: string; requests?: string[][] }>(`return await window.designDownloads.run(${JSON.stringify(kind)})`)
    expect(result.saved).toBe(kind === 'write')
    if (kind === 'write') expect(result.requests).toContainEqual(['POST', '/_api/write'])
    else expect(result.error).toContain('写入失败')
  }, 30_000)
}
