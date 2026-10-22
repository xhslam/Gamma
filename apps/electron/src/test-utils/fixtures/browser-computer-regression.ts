import { app, BrowserWindow, type WebContentsView } from 'electron'
import { createServer } from 'node:http'
import { strict as assert } from 'node:assert'
import { BrowserController } from '../../main/lib/browser-controller'

async function main(): Promise<void> {
app.setPath('userData', `${process.argv[2]}/profile`)
app.commandLine.appendSwitch('site-per-process')
app.commandLine.appendSwitch('disable-gpu')
const checks: string[] = []
const check = async (name: string, run: () => Promise<void>): Promise<void> => { await run(); checks.push(name) }
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  const port = (server.address() as { port: number }).port
  if (req.url === '/frame') res.end('<label>Frame field<input value="old"></label><button onclick="document.body.dataset.clicked=\'yes\'">Frame button</button>')
  else if (req.url === '/nested') res.end(`<iframe src="http://localhost:${port}/frame" style="margin:20px;width:350px;height:150px"></iframe>`)
  else res.end(`<!doctype html><style>button{padding:12px}iframe{display:block;margin:20px;border:3px solid;width:500px;height:220px}</style>
    <label>Field<input value="old"></label><label>Area<textarea>old</textarea></label><div role="textbox" aria-label="Editor" contenteditable="true">old</div>
    <label>Controlled<input id="controlled" value="old" oninput="this.value=this.value.toUpperCase()"></label>
    <button id="under" onclick="document.body.dataset.under='yes'">Under</button>
    <button id="over" style="position:absolute" onclick="document.body.dataset.over='yes'">Over</button>
    <button disabled>Disabled</button><button id="plain" onclick="document.body.dataset.plain='yes'">Plain<span> child</span></button>
    <iframe id="same" src="/frame"></iframe><iframe id="cross" src="http://localhost:${port}/nested"></iframe>
    <script>const r=under.getBoundingClientRect();Object.assign(over.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});</script>`)
})
await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve))
await app.whenReady()
const controller = new BrowserController()
const owner = new BrowserWindow({ show: false, width: 1100, height: 1000 })
controller.setOwnerWindow(owner)
try {
  const port = (server.address() as { port: number }).port
  await controller.navigate('regression', `http://127.0.0.1:${port}/`)
  const sessions = Reflect.get(controller, 'sessions') as Map<string, { tabs: Map<string, { view: WebContentsView }> }>
  const tab = [...sessions.get('regression')!.tabs.values()][0]!
  owner.contentView.addChildView(tab.view)
  tab.view.setBounds({ x: 0, y: 0, width: 1000, height: 950 })
  tab.view.setVisible(true)
  owner.showInactive()
  tab.view.webContents.focus()
  const contents = tab.view.webContents
  await new Promise<void>(resolve => { if (!contents.isLoading()) resolve(); else contents.once('did-stop-loading', resolve) })
  await contents.loadURL(`http://127.0.0.1:${port}/`)
  const evaluate = (expression: string): Promise<unknown> => contents.executeJavaScript(expression)
  const find = async (name: string, index = 0): Promise<string> => {
    const result = await controller.find('regression', { name, role: ['Field','Area','Editor','Controlled','Frame field'].includes(name) ? 'textbox' : 'button', exact: true, maxResults: 50 })
    const ref = result.elements[index]?.ref
    assert.ok(ref, `未发现 ${name} 第 ${index} 个：${JSON.stringify(result.elements)}`)
    return ref
  }
  for (const [name, selector] of [['Field', 'input'], ['Area', 'textarea'], ['Editor', '[contenteditable]']]) {
    await check(`Given ${name} 原值 When fill Then 完整替换并可清空`, async () => {
      try { await controller.fill('regression', await find(name!), 'new中文') } catch (error) { throw new Error(String(error) + ' fixture=' + JSON.stringify(await evaluate('Array.from(document.querySelectorAll("input,textarea,[contenteditable]")).map(e=>({value:e.value??e.innerText,start:e.selectionStart,end:e.selectionEnd}))'))) }
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value ?? document.querySelector(${JSON.stringify(selector)}).innerText`), 'new中文')
      await controller.fill('regression', await find(name!), '')
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value ?? document.querySelector(${JSON.stringify(selector)}).innerText`), '')
    })
  }
  await check('Given 控件自行改写输入 When fill Then 报告不匹配且不重试', async () => {
    await assert.rejects(controller.fill('regression', await find('Controlled'), 'new'), /不一致/)
    assert.equal(await evaluate('controlled.value'), 'NEW')
  })
  await check('Given 目标被覆盖 When click Then 不点击覆盖层', async () => {
    await assert.rejects(controller.click('regression', await find('Under')), /遮挡/)
    assert.equal(await evaluate('document.body.dataset.over'), undefined)
    assert.equal(await evaluate('document.body.dataset.under'), undefined)
    await evaluate('over.remove()')
  })
  await check('Given 控件已禁用 When click Then 不投递', async () => {
    await assert.rejects(controller.click('regression', await find('Disabled')), /禁用/)
  })
  await check('Given 无验证条件 When act Then 只记录 dispatched', async () => {
    const response = await controller.act('regression', await find('Plain child'), undefined).catch(async error => { throw new Error(String(error)+' hit='+JSON.stringify(await evaluate('(()=>{const r=plain.getBoundingClientRect();return {r:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,w:innerWidth,h:innerHeight}})()'))) })
    assert.equal(response.state.trace.at(-1)?.status, 'dispatched')
    assert.equal(await evaluate('document.body.dataset.plain'), 'yes')
  })
  await check('Given 匹配或失败的条件 When act Then 状态分别为 verified 和 failed', async () => {
    const yes = await controller.act('regression', await find('Plain child'), { kind: 'selector', value: 'body[data-plain="yes"]' })
    assert.equal(yes.state.trace.at(-1)?.status, 'verified')
    const no = await controller.act('regression', await find('Plain child'), { kind: 'selector', value: '#missing' }, 250)
    assert.equal(no.state.trace.at(-1)?.status, 'failed')
  })
  await check('Given 同源与跨源嵌套 iframe When observe/find Then 所有 frame 控件均有引用', async () => {
    const observed = await controller.observe('regression', undefined, 400)
    assert.equal(observed.elements.filter(e => e.name === 'Frame field' && e.editable).length, 2, JSON.stringify({elements:observed.elements,tree:await contents.debugger.sendCommand('Page.getFrameTree'), targets: await contents.debugger.sendCommand('Target.getTargets')}))
    const fields = await controller.find('regression', { role: 'textbox', name: 'Frame field', exact: true })
    assert.equal(fields.elements.length, 2)
  })
  await check('Given 同源与跨源嵌套 iframe When fill/click Then 作用于正确 frame', async () => {
    await controller.fill('regression', await find('Frame field', 0), 'same')
    await controller.fill('regression', await find('Frame field', 1), 'cross')
    const field = await controller.find('regression', { role: 'textbox', name: 'Frame field', exact: true })
    assert.equal(field.elements.length, 2)
    await controller.click('regression', await find('Frame button', 0))
    await controller.click('regression', await find('Frame button', 1))
    assert.equal(await evaluate('same.contentDocument.querySelector("input").value'), 'same')
    assert.equal(await evaluate('same.contentDocument.body.dataset.clicked'), 'yes')
    const crossFrame = contents.mainFrame.frames.find(frame => frame.url.includes('/nested'))!.frames[0]!
    assert.equal(await crossFrame.executeJavaScript('document.querySelector("input").value'), 'cross')
    assert.equal(await crossFrame.executeJavaScript('document.body.dataset.clicked'), 'yes')

  })
  await check('Given 跨源嵌套iframe被缩放 When click Then 坐标仍命中目标', async () => {
    const crossFrame = contents.mainFrame.frames.find(frame => frame.url.includes('/nested'))!.frames[0]!
    await crossFrame.executeJavaScript('delete document.body.dataset.clicked')
    await evaluate('cross.style.transformOrigin="top left";cross.style.transform="scale(0.8)"')
    await controller.click('regression', await find('Frame button', 1))
    assert.equal(await crossFrame.executeJavaScript('document.body.dataset.clicked'), 'yes')
    await evaluate('cross.style.transform="none"')
  })
  await check('Given iframe上方被父文档遮挡 When click Then 不向内部控件投递', async () => {
    const crossFrame = contents.mainFrame.frames.find(frame => frame.url.includes('/nested'))!.frames[0]!
    await crossFrame.executeJavaScript('delete document.body.dataset.clicked')
    await evaluate('const mask=document.createElement("div");mask.id="mask";mask.style="position:fixed;inset:0;z-index:9999;background:white";document.body.append(mask)')
    await assert.rejects(controller.click('regression', await find('Frame button', 1)), /遮挡/)
    assert.equal(await crossFrame.executeJavaScript('document.body.dataset.clicked===undefined'), true)
    await evaluate('mask.remove()')
  })
  await check('Given iframe 导航 When 使用旧 ref Then 在投递前拒绝', async () => {
    const old = await find('Frame button', 0)
    await evaluate('new Promise(resolve=>{same.onload=resolve;same.src="/frame?changed"})')
    await assert.rejects(controller.click('regression', old), /失效/)
  })
  process.stdout.write(`GAMMA_BROWSER_RESULT:${JSON.stringify({ checks })}\n`)
} catch (error) {
  process.stdout.write(`GAMMA_BROWSER_RESULT:${JSON.stringify({ checks, error: String(error instanceof Error ? error.stack : error) })}\n`)
  process.exitCode = 1
} finally { controller.dispose(); owner.destroy(); server.close(); app.quit() }

}
void main().catch(error => { console.error(error); app.exit(1) })
