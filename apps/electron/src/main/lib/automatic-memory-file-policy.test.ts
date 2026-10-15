import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { assertPublicMemoryFilePath } from './automatic-memory-file-policy'

describe('自动记忆权威记录的普通编辑边界', () => {
  test('Given普通记忆文件 Then保持原有Markdown访问', () => {
    expect(() => assertPublicMemoryFilePath('/workspace/memory', '/workspace/memory/areas/math.md')).not.toThrow()
  })
  test('Given规范化、大小写变体或点段指向内部JSON Then拒绝普通编辑器访问', () => {
    for (const file of ['.automatic-memory.json', '.AUTOMATIC-MEMORY.JSON', 'areas/../.automatic-memory.json']) {
      expect(() => assertPublicMemoryFilePath('/workspace/memory', resolve('/workspace/memory', file))).toThrow('分类记忆管理器')
    }
  })
})
