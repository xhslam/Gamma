import { afterAll, beforeAll, expect, test } from 'bun:test'
import { build } from 'esbuild'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DESIGN_BUNDLE_REVISION } from '@gamma/shared'
import type { DesignArtifactKind } from '@gamma/shared'
import { createDesignArtifactService } from '../../../main/lib/design-artifacts'
import { prepareDesignLocaleBundle } from '../../../main/lib/design-locale-bundle'
import { getElectronExecutablePath } from '../../../test-utils/electron-executable'
import { createElectronRendererHarness } from '../../../test-utils/electron-renderer'
import type { ElectronRendererHarness } from '../../../test-utils/electron-renderer'

const kinds: DesignArtifactKind[] = ['canvas', 'slides', 'system', 'dashboard', 'motion', 'whiteboard']
const skills = { canvas: 'claude-design', slides: 'claude-slides', system: 'claude-design-system', dashboard: 'claude-dashboard', motion: 'claude-motion', whiteboard: 'claude-whiteboard' }
let renderer: ElectronRendererHarness
let directory: string
let stop: () => Promise<void>
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gamma-design-locale-pages-'))
  const bundle = resolve(import.meta.dir, '../../../../resources/design-bundle', DESIGN_BUNDLE_REVISION)
  await prepareDesignLocaleBundle(bundle)
  const project = join(directory, 'project'), storage = join(directory, 'storage')
  await mkdir(project); await mkdir(storage)
  const service = createDesignArtifactService({
    getWorkspace: () => ({ id: 'workspace', slug: 'workspace', projectRootPath: project }), getSession: () => ({ workspaceId: 'workspace' }),
    getWorkspacePath: () => storage, getSkillPath: kind => join(bundle, 'skills', skills[kind]),
    probe: async url => { const response = await fetch(url); await response.body?.cancel(); return response.ok },
    run: async (kind, args) => {
      const child = Bun.spawn([getElectronExecutablePath(), join(bundle, 'skills', skills[kind], 'scripts/artifact.mjs'), ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      if (code !== 0) throw new Error(`${kind}: ${stderr} ${stdout}`)
      return stdout
    },
  })
  stop = service.stopDesignEditors
  const urls: Partial<Record<DesignArtifactKind, string>> = {}
  for (const kind of kinds) {
    const artifact = await service.createDesignArtifact({ workspaceId: 'workspace', sessionId: 'session', kind, title: 'Fixture plain title' })
    urls[kind] = (await service.openDesignArtifact('workspace', artifact.id)).url
  }
  const module = join(directory, 'locale.cjs')
  await build({ stdin: { contents: 'export {createDesignLocaleHost} from "./design-locale-host";export {DESIGN_EDITOR_FLUSH_SCRIPT} from "./design-editor-flush";', resolveDir: resolve(import.meta.dir, '../../../main/lib'), loader: 'ts' }, outfile: module, bundle: true, platform: 'node', format: 'cjs' })
  renderer = await createElectronRendererHarness('', {
    preloadSource: `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('localePages',{run:(kind,language)=>ipcRenderer.invoke('locale:run',kind,language)});`,
    mainProcessSetup: `
      const {ipcMain,WebContentsView,session}=require('electron');
      const {createDesignLocaleHost,DESIGN_EDITOR_FLUSH_SCRIPT}=require(${JSON.stringify(module)});
      const urls=${JSON.stringify(urls)};
      ipcMain.handle('locale:run',async(_,kind,language)=>{
        const profile=session.fromPartition('locale-'+kind+'-'+language);const view=new WebContentsView({webPreferences:{session:profile,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
        try{
          await view.webContents.loadURL(urls[kind]);
          await createDesignLocaleHost().setLocale(view.webContents,urls[kind],[language]);
          await view.webContents.executeJavaScript('new Promise((resolve,reject)=>{const ready=()=>document.querySelector("#root button,#root [role=button],#root canvas")&&!document.querySelector("#root [data-placeholder]");if(ready()){resolve();return}const observer=new MutationObserver(()=>{if(ready()){clearTimeout(timer);observer.disconnect();resolve()}});const timer=setTimeout(()=>{observer.disconnect();reject(new Error("编辑器未就绪"))},15000);observer.observe(document,{childList:true,subtree:true})})');
          const initial=await view.webContents.executeJavaScript('({locale:globalThis.__gammaDesignLocale,native:globalThis.__appifact_i18n?.lang,title:document.title,text:document.querySelector("#root").innerText,labels:[...document.querySelectorAll("#root button,#root [role=button]")].map(el=>[el.getAttribute("aria-label"),el.getAttribute("title"),el.textContent].filter(Boolean).join(" ")).join(" | ")})');
          const flushed=await view.webContents.executeJavaScript(DESIGN_EDITOR_FLUSH_SCRIPT);
          return {...initial,flushed};
        }finally{view.webContents.close()}
      });
    `,
    timeoutMs: 50_000,
  })
}, 120_000)
afterAll(async () => { await renderer?.dispose(); await stop?.(); if (directory) await rm(directory, { recursive: true, force: true }) })

for (const kind of kinds) {
  for (const language of ['zh-CN', 'en-US']) {
    test(`Given ${kind} 的真实编辑器 When 系统首选语言为 ${language} Then 原生消息采用该语言且当前稿可通过就绪检查`, async () => {
      const result = await renderer.run<{ locale: string; native: string; text: string; labels: string; flushed: boolean }>(`return await window.localePages.run(${JSON.stringify(kind)},${JSON.stringify(language)})`)
      expect(result.locale).toBe(language)
      expect(result.native).toBe(language)
      expect(result.flushed).toBe(true)
      expect(result.text + result.labels).not.toContain('Untranslated UI sentinel')
      if (language === 'zh-CN') expect(result.labels).toMatch(/[\u4e00-\u9fff]/)
      else expect(result.labels).toMatch(/[A-Za-z]/)
    }, 60_000)
  }
}
