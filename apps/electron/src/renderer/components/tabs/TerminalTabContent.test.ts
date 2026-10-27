import { describe, expect, test } from 'bun:test'
import { formatTerminalPath } from './TerminalTabContent'

describe('终端路径格式化与粘贴格式', () => {
  test('Given 普通无空格路径 When formatTerminalPath Then 返回无引号路径并带有末尾空格', () => {
    expect(formatTerminalPath('/Users/apple/Desktop/image.png')).toBe('/Users/apple/Desktop/image.png ')
    expect(formatTerminalPath('/var/folders/xx/paste-123.png')).toBe('/var/folders/xx/paste-123.png ')
  })

  test('Given 包含空格的路径 When formatTerminalPath Then 正确用单引号包裹并保留末尾空格', () => {
    expect(formatTerminalPath('/Users/apple/My Documents/shot.png')).toBe("'/Users/apple/My Documents/shot.png' ")
    expect(formatTerminalPath('C:\\Users\\John Doe\\file.txt')).toBe("'C:\\Users\\John Doe\\file.txt' ")
  })

  test('Given 包含单引号的路径 When formatTerminalPath Then 正确转义单引号以符合 POSIX shell', () => {
    expect(formatTerminalPath("/Users/apple/it's a photo.png")).toBe("'/Users/apple/it'\\''s a photo.png' ")
  })

  test('Given 包含特殊 shell 符号（如 $ & ( ) 等）的路径 When formatTerminalPath Then 进行安全转义包裹', () => {
    expect(formatTerminalPath('/Users/apple/project(1)/$test.png')).toBe("'/Users/apple/project(1)/$test.png' ")
    expect(formatTerminalPath('/Users/apple/foo&bar/image.png')).toBe("'/Users/apple/foo&bar/image.png' ")
  })
})
