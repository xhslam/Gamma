import { describe, expect, test } from 'bun:test'

/** Electron mock 仅在子进程内存在，避免污染同轮其它主进程测试。 */
async function runDialogScenario(scenario: string): Promise<unknown> {
  const source = `
    import { mock } from 'bun:test';
    import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';import { join } from 'node:path';
    const calls=[];let focused={id:'focused',isDestroyed:()=>false};
    let result={canceled:true,filePaths:[]};let fail=false;
    mock.module('electron',()=>({BrowserWindow:{getFocusedWindow:()=>focused},dialog:{
      showOpenDialog:async(...args)=>{calls.push({parent:args.length===2?args[0].id:null,options:args.at(-1)});if(fail)throw new Error('选择器失败');return result;},
      showMessageBox:async()=>({response:0})
    }}));
    const {openFileOrFolderDialog}=await import(${JSON.stringify(new URL('./attachment-service.ts', import.meta.url).pathname)});
    const directory=mkdtempSync(join(tmpdir(),'gamma-attachment-dialog-'));
    try {const output=await(async()=>{${scenario}})();console.log('DIALOG_RESULT:'+JSON.stringify(output));}
    finally{rmSync(directory,{recursive:true,force:true});}
  `
  const child = Bun.spawn([process.execPath, '-e', source], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr)
  const line = stdout.split('\n').find((value) => value.startsWith('DIALOG_RESULT:'))
  if (!line) throw new Error(`附件测试未返回结果：${stdout}`)
  return JSON.parse(line.slice('DIALOG_RESULT:'.length)) as unknown
}

describe('Given Composer 的原生文件选择器', () => {
  test('When 菜单关闭导致窗口焦点改变 Then 选择器仍绑定 IPC 发起窗口并正确返回文件及目录', async () => {
    const result = await runDialogScenario(`
      const file=join(directory,'附件.txt'),folder=join(directory,'资料');
      writeFileSync(file,'test');mkdirSync(folder);
      result={canceled:false,filePaths:[file,folder]};
      const response=await openFileOrFolderDialog({id:'sender',isDestroyed:()=>false});
      return {parent:calls[0].parent,files:response.files.map(f=>({name:f.filename,data:f.data,size:f.size})),directories:response.directories.map(d=>d.name)};
    `)
    expect(result).toEqual({ parent: 'sender', files: [{ name: '附件.txt', data: 'dGVzdA==', size: 4 }], directories: ['资料'] })
  })

  test('When 发起窗口已销毁且用户取消 Then 安全回退到当前窗口并返回空结果', async () => {
    const result = await runDialogScenario(`
      const response=await openFileOrFolderDialog({id:'destroyed',isDestroyed:()=>true});
      return {parent:calls[0].parent,response};
    `)
    expect(result).toEqual({ parent: 'focused', response: { files: [], directories: [] } })
  })

  test('When 没有父窗口且选择器失败 Then 不静默吞错，下一次调用仍可取消', async () => {
    const result = await runDialogScenario(`
      focused=null;fail=true;let message='';
      try{await openFileOrFolderDialog();}catch(error){message=error.message;}
      fail=false;const response=await openFileOrFolderDialog();
      return {message,parents:calls.map(c=>c.parent),response};
    `)
    expect(result).toEqual({ message: '选择器失败', parents: [null, null], response: { files: [], directories: [] } })
  })

  test('When 附着父窗口打开失败 Then 优雅回退到无父窗口打开并返回结果', async () => {
    const result = await runDialogScenario(`
      let first = true;
      mock.module('electron', () => ({
        BrowserWindow: { getFocusedWindow: () => focused },
        dialog: {
          showOpenDialog: async (...args) => {
            calls.push({ parent: args.length === 2 ? args[0].id : null, options: args.at(-1) });
            if (first && args.length === 2) {
              first = false;
              throw new Error('Sheet presentation failed');
            }
            return result;
          },
          showMessageBox: async () => ({ response: 0 })
        }
      }));
      const file = join(directory, 'fallback.txt');
      writeFileSync(file, 'ok');
      result = { canceled: false, filePaths: [file] };
      const response = await openFileOrFolderDialog({ id: 'parent-error', isDestroyed: () => false });
      return { parents: calls.map(c => c.parent), fileNames: response.files.map(f => f.filename) };
    `)
    expect(result).toEqual({ parents: ['parent-error', null], fileNames: ['fallback.txt'] })
  })
})
