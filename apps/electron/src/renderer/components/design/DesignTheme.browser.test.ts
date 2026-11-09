import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

let renderer: ElectronRendererHarness
let temporary: string
const theme = { mode: 'dark', background: '#1f1e1d', panel: '#262624', inset: '#30302e', text: '#f0eee6', secondary: '#b0aea5', tertiary: '#85837b', border: '#f0eee61f', accent: '#d97757', accentText: '#141413', danger: '#d97757', ring: '#d97757', fontFamily: 'system-ui, sans-serif', radius: 6 }

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'gamma-design-native-theme-'))
  const modulePath = join(temporary, 'theme-host.cjs')
  await build({ entryPoints: [resolve(import.meta.dir, '../../../main/lib/design-theme-host.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: modulePath })
  const content = `<!doctype html><html class="cds-root"><head><style>.cds-root{--cds-surface-2:#fff;--cds-text-primary:#111;--cds-radius:20px;--cds-font-sans:serif}body{margin:0}#chrome{background:var(--cds-surface-2);color:var(--cds-text-primary);border-radius:var(--cds-radius);font-family:var(--cds-font-sans);height:40px}</style></head><body><div id="chrome" class="cds-root"><button id="action">原版编辑操作</button><output id="count">0</output></div><iframe id="artwork" srcdoc="<!doctype html><html class='cds-root'><style>:root{--cds-surface-2:rgb(252,232,192)}body{background:var(--cds-surface-2);color:rgb(12,34,56);font-family:serif}</style><body>作品独立配色</body></html>"></iframe><script>document.getElementById('action').onclick=()=>{document.getElementById('count').textContent=String(Number(document.getElementById('count').textContent)+1)}</script></body></html>`
  renderer = await createElectronRendererHarness(`window.themeSmoke={theme:${JSON.stringify(theme)}};`, {
    preloadSource: `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('nativeTheme',{open:kind=>ipcRenderer.invoke('theme:open',kind),apply:value=>ipcRenderer.invoke('theme:apply',value),inspect:()=>ipcRenderer.invoke('theme:inspect'),reload:()=>ipcRenderer.invoke('theme:reload'),action:()=>ipcRenderer.invoke('theme:action')});`,
    mainProcessSetup: `
      const {ipcMain,WebContentsView}=require('electron');const http=require('node:http');
      const {createDesignThemeHost}=require(${JSON.stringify(modulePath)});const host=createDesignThemeHost();let editor,editorUrl,lastTheme;
      const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(${JSON.stringify(content)})});
      app.once('will-quit',()=>server.close());
      ipcMain.handle('theme:open',async(_,kind)=>{editorUrl='http://127.0.0.1:'+server.address().port+'/'+kind+'/artifact/';await editor.webContents.loadURL(editorUrl)});
      ipcMain.handle('theme:apply',async(_,value)=>{lastTheme=value;await host.setTheme(editor.webContents,editorUrl,value)});
      ipcMain.handle('theme:reload',async()=>{await new Promise(resolve=>{editor.webContents.once('did-finish-load',resolve);editor.webContents.reload()});for(let i=0;i<100;i++){const color=await editor.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--cds-surface-2').trim()");if(color===lastTheme.panel)return;await new Promise(resolve=>setImmediate(resolve))}throw new Error('重载未恢复主题')});
      ipcMain.handle('theme:action',()=>editor.webContents.executeJavaScript("document.getElementById('action').click()"));
      ipcMain.handle('theme:inspect',()=>editor.webContents.executeJavaScript(
        "(()=>{const chrome=getComputedStyle(document.getElementById('chrome')),frame=document.getElementById('artwork').contentDocument,art=getComputedStyle(frame.body);return {background:chrome.backgroundColor,color:chrome.color,radius:chrome.borderRadius,font:chrome.fontFamily,artBackground:art.backgroundColor,artColor:art.color,artFont:art.fontFamily,count:document.getElementById('count').textContent,artMode:frame.defaultView.matchMedia('(prefers-color-scheme: dark)').matches}})()"));
    `,
    mainProcessReady: `await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));`,
    mainWindowSetup: `editor=new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});window.contentView.addChildView(editor);editor.setBounds({x:0,y:0,width:900,height:600});`,
  })
}, 120_000)
afterAll(async () => { await renderer?.dispose(); if (temporary) await rm(temporary, { recursive: true, force: true }) })

describe('Given Chromium 原生 WebContentsView 中的编辑器外壳与作品 iframe', () => {
  test('When 五类工作台应用 Gamma 深浅主题 Then 只改变外壳，不改变作品配色字体且原版按钮仍可用', async () => {
    const results = await renderer.run<Array<{ background: string; color: string; radius: string; artBackground: string; artColor: string; artFont: string; count: string }>>(`
      const api=window.nativeTheme,results=[];
      for(const kind of ['design','slides','design-system','dashboard','motion']){
        await api.open(kind);await api.apply(window.themeSmoke.theme);await api.action();const dark=await api.inspect();
        await api.apply({...window.themeSmoke.theme,mode:'light',panel:'#ffffff',text:'#141413',radius:2});const light=await api.inspect();if(dark.artMode!==light.artMode)throw Error('外壳改变了作品媒体查询');
        if(dark.background!=='rgb(38, 38, 36)'||dark.color!=='rgb(240, 238, 230)')throw Error(JSON.stringify(dark));
        results.push(light);
      }return results;
    `)
    expect(results).toHaveLength(5)
    for (const result of results) {
      expect(result.background).toBe('rgb(255, 255, 255)')
      expect(result.color).toBe('rgb(20, 20, 19)')
      expect(result.radius).toBe('2px')
      expect(result.artBackground).toBe('rgb(252, 232, 192)')
      expect(result.artColor).toBe('rgb(12, 34, 56)')
      expect(result.artFont).toBe('serif')
      expect(result.count).toBe('1')
    }
  }, 30_000)
  test('When 编辑器重新加载 Then 主进程恢复主题，不需要把 CSS 写入作品', async () => {
    const result = await renderer.run<{ background: string; radius: string; artBackground: string }>(`
      const api=window.nativeTheme;await api.open('design');await api.apply(window.themeSmoke.theme);await api.reload();return await api.inspect();
    `)
    expect(result.background).toBe('rgb(38, 38, 36)')
    expect(result.radius).toBe('6px')
    expect(result.artBackground).toBe('rgb(252, 232, 192)')
  }, 30_000)
})
