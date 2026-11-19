import { describe, expect, test } from 'bun:test'
import { resolveInstalledComputerApp } from './computer-installed-app'

const systemRoot = 'C:\\Windows'
const notepad = 'C:\\Windows\\System32\\notepad.exe'
const chrome = 'D:\\Apps\\Chrome\\chrome.exe'
const files = new Map([
  [notepad.toLowerCase(), notepad],
  [chrome.toLowerCase(), chrome],
])
const options = {
  windowsSystemRoot: systemRoot,
  windowsPathEntries: ['D:\\Apps\\Chrome'],
  windowsCanonicalize: async (path: string) => files.get(path.toLowerCase()),
}

describe('Given Windows launch 需要规范可执行文件身份', () => {
  test('When 使用绝对路径或省略扩展名 Then 都解析为同一规范路径', async () => {
    for (const identifier of [notepad, 'notepad', 'NOTEPAD.EXE']) {
      await expect(resolveInstalledComputerApp(identifier, 'win32', options)).resolves.toEqual({ appName: 'notepad.exe', bundleId: notepad })
    }
  })

  test('When PATH 中存在应用 Then 不运行 where 或 shell，直接解析文件并返回路径', async () => {
    await expect(resolveInstalledComputerApp('chrome', 'win32', options)).resolves.toEqual({ appName: 'chrome.exe', bundleId: chrome })
  })

  test('When 相对路径、非 exe 或文件不存在 Then 失败关闭', async () => {
    for (const identifier of ['..\\Windows\\notepad.exe', 'missing', 'C:\\Windows\\System32\\cmd.exe']) {
      await expect(resolveInstalledComputerApp(identifier, 'win32', options)).resolves.toBeUndefined()
    }
  })
})
