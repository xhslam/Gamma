import { describe, expect, test } from 'bun:test'
import { getDiffProjectTitle } from './diff-project-title'

describe('改动面板项目显示名称', () => {
  test('Given 项目名Carpus与旧磁盘目录Proma When显示主仓库 Then使用项目名而不改路径', () => {
    expect(getDiffProjectTitle('/Users/apple/Desktop/Proma', '/Users/apple/Desktop/Proma', 'Carpus')).toBe('Carpus')
  })
  test('Given 附加仓库 When显示标题 Then不冒用当前项目名称', () => {
    expect(getDiffProjectTitle('/work/other', '/work/Proma', 'Carpus')).toBe('other')
    expect(getDiffProjectTitle('/work/Proma-copy', '/work/Proma', 'Carpus')).toBe('Proma-copy')
  })
  test('Given 名称或项目根缺失 When显示标题 Then保留目录名称', () => {
    expect(getDiffProjectTitle('/work/Proma', '/work/Proma', '  ')).toBe('Proma')
    expect(getDiffProjectTitle('/work/Proma', undefined, 'Carpus')).toBe('Proma')
    expect(getDiffProjectTitle('/work/Proma')).toBe('Proma')
  })
  test('Given 尾斜杠与Windows分隔符 When匹配项目 Then正确显示名称', () => {
    expect(getDiffProjectTitle('/work/Proma/', '/work/Proma', ' Carpus ')).toBe('Carpus')
    expect(getDiffProjectTitle('C:\\Work\\Proma', 'c:/work/proma/', 'Carpus', true)).toBe('Carpus')
    expect(getDiffProjectTitle('C:\\Work\\other\\', 'c:/work/proma', 'Carpus', true)).toBe('other')
  })
  test('Given POSIX大小写不同或空根 When显示标题 Then不错误匹配项目', () => {
    expect(getDiffProjectTitle('/work/proma', '/work/Proma', 'Carpus')).toBe('proma')
    expect(getDiffProjectTitle('', '', 'Carpus')).toBe('/')
    expect(getDiffProjectTitle('/')).toBe('/')
  })
})
