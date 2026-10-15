import { describe, expect, test } from 'bun:test'
import { formatMessageTime } from './message-time'

describe('公共消息时间格式', () => {
  test('Given 当年消息 When 格式化 Then 使用补零的月日与本地时间', () => {
    const year = new Date().getFullYear()
    expect(formatMessageTime(new Date(year, 0, 2, 3, 4).getTime())).toBe('01/02 03:04')
  })

  test('Given 跨年消息 When 格式化 Then 显示年份避免历史时间歧义', () => {
    const year = new Date().getFullYear() - 1
    expect(formatMessageTime(new Date(year, 10, 12, 13, 14).getTime())).toBe(`${year}/11/12 13:14`)
  })
})
