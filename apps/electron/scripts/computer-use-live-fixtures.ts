import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ComputerFixtureState {
  clicks: number; text: string; key: string; scrollY: number
  selectionStart: number; selectionEnd: number; ticks: number; moved: boolean; pid: number
}
export const emptyComputerFixtureState = (): ComputerFixtureState => ({ clicks: 0, text: '', key: '', scrollY: 0, selectionStart: 0, selectionEnd: 0, ticks: 0, moved: false, pid: 0 })
function validateToken(token: string): void { if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('验收夹具必须使用本轮UUID') }

/** 网页自身只生成测试场景并回报真实状态，不调用click/focus或替原生工具设置输入值。 */
export function createComputerLiveFixture(token: string): { title: string; html: string } {
  validateToken(token)
  const title = `Gamma Computer Use Local Acceptance ${token}`
  const nested = '<div role="group">'.repeat(20)
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>${title}</title><style>body{font:20px system-ui;padding:60px;background:#faf8f4;color:#312b27}textarea{display:block;margin:20px 0;width:650px;height:110px;font:24px system-ui}button{padding:14px 24px;margin:8px;font:18px system-ui}#space{height:1600px}#clock{position:fixed;right:8px;top:8px;font-size:12px}</style><h1>电脑交互本地验收</h1><p>仅本地夹具；页面计时和标题持续变化。</p><output id="clock"></output>${nested}<textarea aria-label="中文输入验收框" id="input"></textarea>${'</div>'.repeat(20)}<button aria-label="单击验收按钮" id="click">单击验收按钮</button><button aria-label="安排目标移动" id="move">安排目标移动</button><p id="result">点击次数：0</p><div id="space"></div><script>
const input=document.getElementById('input');let clicks=0,key='',ticks=0,moved=false;
function report(){fetch('/state/${token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'web',clicks,text:input.value,key,scrollY:window.scrollY,selectionStart:input.selectionStart,selectionEnd:input.selectionEnd,ticks,moved,pid:0})}).catch(()=>{})}
window.addEventListener('scroll',report);input.addEventListener('input',report);input.addEventListener('select',report);input.addEventListener('keydown',e=>{key=e.key;setTimeout(report,0)});
document.getElementById('click').addEventListener('click',()=>{clicks++;document.getElementById('result').textContent='点击次数：'+clicks;report()});
document.getElementById('move').addEventListener('click',()=>{setTimeout(()=>{document.getElementById('click').style.transform='translateX(360px)';moved=true;report()},8000)});
setInterval(()=>{ticks++;document.getElementById('clock').textContent='动态更新 '+ticks;document.title=${JSON.stringify(title)}+' [动态 '+ticks+']';report()},200);
</script></html>`
  return { title, html }
}

/** 只编译夹具，不启动应用、不访问TCC，也不触发任何桌面输入。 */
export function buildComputerAppKitFixture(directory: string, token: string): { appPath: string; executable: string; bundleId: string; title: string } {
  validateToken(token)
  if (process.platform !== 'darwin') throw new Error('AppKit夹具仅支持macOS')
  const title = `Gamma Native Acceptance ${token}`
  const bundleId = `com.gamma.computer-fixture.${token}`
  const appPath = resolve(directory, `${title}.app`)
  const executable = resolve(appPath, 'Contents/MacOS/fixture')
  mkdirSync(resolve(appPath, 'Contents/MacOS'), { recursive: true })
  writeFileSync(resolve(appPath, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleName</key><string>${title}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`)
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-warnings-as-errors', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`, resolve(import.meta.dir, 'fixtures/computer-use-appkit.swift'), '-o', executable], { timeout: 120_000 })
  return { appPath, executable, bundleId, title }
}
