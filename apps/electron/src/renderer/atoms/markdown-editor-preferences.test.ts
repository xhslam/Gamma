import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const preferencesPath = fileURLToPath(new URL('./markdown-editor-preferences.ts', import.meta.url))

/** 每个场景在子进程中模拟 preload，避免污染其他 renderer 测试的 window。 */
function verifyPreferencesScenario(scenario: string): void {
  const result = Bun.spawnSync([process.execPath, '--eval', `
    import assert from 'node:assert/strict'
    import { createStore } from 'jotai'
    import {
      DEFAULT_MARKDOWN_EDITOR_PREFERENCES as defaults,
      normalizeMarkdownEditorPreferences as normalize,
    } from '@gamma/shared'
    import {
      markdownEditorPreferencesAtom as preferencesAtom,
      markdownEditorPreferencesErrorAtom as errorAtom,
      markdownEditorPreferencesSavingAtom as savingAtom,
      loadMarkdownEditorPreferencesAtom as loadAtom,
      updateMarkdownEditorPreferencesAtom as updateAtom,
    } from ${JSON.stringify(preferencesPath)}
    const deferred = () => {
      let resolve, reject
      const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
      return { promise, resolve, reject }
    }
    const flush = async () => {
      for (let index = 0; index < 8; index++) await Promise.resolve()
    }
    ${scenario}
  `], { cwd: fileURLToPath(new URL('../../../../../', import.meta.url)) })
  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
}

describe('Markdown 编辑器偏好持久化', () => {
  test('Given 旧设置没有编辑器偏好 When 初始化 Then 使用完整默认值且不写入设置', () => {
    verifyPreferencesScenario(`
      let writes = 0
      globalThis.window = { electronAPI: {
        getSettings: async () => ({ markdownFontSize: 'small' }),
        updateSettings: async () => { writes++; throw new Error('加载不能写入') },
      } }
      const store = createStore()
      assert.deepEqual(store.get(preferencesAtom), defaults)
      await store.set(loadAtom)
      assert.deepEqual(store.get(preferencesAtom), defaults)
      assert.equal(store.get(errorAtom), null)
      assert.equal(store.get(savingAtom), false)
      assert.equal(writes, 0)
    `)
  })

  test('Given 旧配置包含局部值和无效字段 When 加载 Then 合法值保留其余回退默认', () => {
    verifyPreferencesScenario(`
      const oldPreferences = { theme: 'paper', fontSize: 19, sourceWordWrap: false, shortcuts: { toggleEdit: 'F2', sourcePeek: 'bad-key' } }
      globalThis.window = { electronAPI: { getSettings: async () => ({ markdownEditor: oldPreferences }) } }
      const store = createStore()
      await store.set(loadAtom)
      assert.deepEqual(store.get(preferencesAtom), normalize(oldPreferences))
      assert.equal(store.get(preferencesAtom).theme, 'paper')
      assert.equal(store.get(preferencesAtom).fontSize, defaults.fontSize)
      assert.equal(store.get(preferencesAtom).sourceWordWrap, false)
      assert.equal(store.get(preferencesAtom).shortcuts.toggleEdit, 'F2')
      assert.equal(store.get(preferencesAtom).shortcuts.sourcePeek, defaults.shortcuts.sourcePeek)
    `)
  })

  test('Given 连续修改多项偏好 When 前一项保存尚未完成 Then 乐观值立即可见且完整快照串行保存', () => {
    verifyPreferencesScenario(`
      const calls = [], pending = [deferred(), deferred()]
      globalThis.window = { electronAPI: { getSettings: async () => ({}), updateSettings: ({ markdownEditor }) => {
        calls.push(markdownEditor)
        return pending[calls.length - 1].promise
      } } }
      const store = createStore()
      const first = store.set(updateAtom, { theme: 'paper', shortcuts: { toggleSource: 'F3' } })
      const second = store.set(updateAtom, { fontSize: 24 })
      assert.equal(store.get(preferencesAtom).theme, 'paper')
      assert.equal(store.get(preferencesAtom).fontSize, 24)
      assert.equal(store.get(savingAtom), true)
      await flush()
      assert.equal(calls.length, 1)
      assert.deepEqual(Object.keys(calls[0]).sort(), Object.keys(defaults).sort())
      pending[0].resolve({ markdownEditor: calls[0] })
      await first
      await flush()
      assert.equal(calls.length, 2)
      assert.equal(store.get(preferencesAtom).fontSize, 24)
      assert.equal(store.get(savingAtom), true)
      assert.equal(calls[1].theme, 'paper')
      assert.equal(calls[1].fontSize, 24)
      assert.deepEqual(calls[1].shortcuts, { ...defaults.shortcuts, toggleSource: 'F3' })
      pending[1].resolve({ markdownEditor: calls[1] })
      await second
      assert.deepEqual(store.get(preferencesAtom), calls[1])
      assert.equal(store.get(savingAtom), false)
      assert.equal(store.get(errorAtom), null)
    `)
  })

  test('Given 中间保存失败且还有后续修改 When 后续保存成功 Then 不回滚新界面且保留全部用户修改', () => {
    verifyPreferencesScenario(`
      const calls = [], pending = [deferred(), deferred()]
      globalThis.window = { electronAPI: { getSettings: async () => ({}), updateSettings: ({ markdownEditor }) => {
        calls.push(markdownEditor)
        return pending[calls.length - 1].promise
      } } }
      const store = createStore()
      const first = store.set(updateAtom, { theme: 'night' })
      const failure = assert.rejects(first, /磁盘暂不可用/)
      const second = store.set(updateAtom, { contentWidth: 64 })
      await flush()
      pending[0].reject(new Error('磁盘暂不可用'))
      await failure
      await flush()
      assert.equal(store.get(preferencesAtom).theme, 'night')
      assert.equal(store.get(preferencesAtom).contentWidth, 64)
      assert.equal(store.get(errorAtom), '磁盘暂不可用')
      assert.equal(store.get(savingAtom), true)
      assert.equal(calls[1].theme, 'night')
      assert.equal(calls[1].contentWidth, 64)
      pending[1].resolve({ markdownEditor: calls[1] })
      await second
      assert.equal(store.get(preferencesAtom).theme, 'night')
      assert.equal(store.get(preferencesAtom).contentWidth, 64)
      assert.equal(store.get(errorAtom), null)
      assert.equal(store.get(savingAtom), false)
    `)
  })

  test('Given 已有确认偏好 When 最后一次保存失败 Then 回滚确认值并显示错误且请求拒绝', () => {
    verifyPreferencesScenario(`
      const saved = normalize({ theme: 'paper', fontSize: 20 }), pending = deferred()
      globalThis.window = { electronAPI: {
        getSettings: async () => ({ markdownEditor: saved }),
        updateSettings: () => pending.promise,
      } }
      const store = createStore()
      await store.set(loadAtom)
      const saving = store.set(updateAtom, { theme: 'night', fontSize: 24 })
      const failure = assert.rejects(saving, /保存失败/)
      assert.equal(store.get(preferencesAtom).theme, 'night')
      assert.equal(store.get(savingAtom), true)
      await flush()
      pending.reject(new Error('保存失败'))
      await failure
      assert.deepEqual(store.get(preferencesAtom), saved)
      assert.equal(store.get(errorAtom), '保存失败')
      assert.equal(store.get(savingAtom), false)
    `)
  })

  test('Given 旧设置正在加载 When 用户修改且保存失败 Then 旧加载不覆盖乐观值并成为失败恢复值', () => {
    verifyPreferencesScenario(`
      const saved = normalize({ theme: 'paper', fontSize: 20 }), loading = deferred(), writing = deferred()
      let calls = 0
      globalThis.window = { electronAPI: {
        getSettings: () => loading.promise,
        updateSettings: () => { calls++; return writing.promise },
      } }
      const store = createStore()
      const load = store.set(loadAtom)
      const save = store.set(updateAtom, { theme: 'night' })
      const failure = assert.rejects(save, /保存失败/)
      await flush()
      assert.equal(calls, 0)
      loading.resolve({ markdownEditor: saved })
      await load
      await flush()
      assert.equal(store.get(preferencesAtom).theme, 'night')
      assert.equal(store.get(preferencesAtom).fontSize, 20)
      assert.equal(calls, 1)
      writing.reject(new Error('保存失败'))
      await failure
      assert.deepEqual(store.get(preferencesAtom), saved)
    `)
  })

  test('Given 加载失败 When 再次更新偏好 Then 错误可见且队列继续执行', () => {
    verifyPreferencesScenario(`
      let loads = 0
      globalThis.window = { electronAPI: {
        getSettings: async () => { if (loads++ === 0) throw new Error('加载失败'); return {} },
        updateSettings: async ({ markdownEditor }) => ({ markdownEditor }),
      } }
      const store = createStore()
      await assert.rejects(store.set(loadAtom), /加载失败/)
      assert.equal(store.get(errorAtom), '加载失败')
      assert.deepEqual(store.get(preferencesAtom), defaults)
      await store.set(updateAtom, { theme: 'mint' })
      assert.equal(store.get(preferencesAtom).theme, 'mint')
      assert.equal(store.get(errorAtom), null)
    `)
  })

  test('Given 两个独立 Jotai store When 一个 store 正在保存 Then 另一个可独立保存且不共享偏好', () => {
    verifyPreferencesScenario(`
      const blocked = deferred(), calls = []
      globalThis.window = { electronAPI: { getSettings: async () => ({}), updateSettings: ({ markdownEditor }) => {
        calls.push(markdownEditor)
        return markdownEditor.theme === 'paper' ? blocked.promise : Promise.resolve({ markdownEditor })
      } } }
      const firstStore = createStore(), secondStore = createStore()
      const first = firstStore.set(updateAtom, { theme: 'paper' })
      await secondStore.set(updateAtom, { theme: 'mint' })
      assert.equal(calls.length, 2)
      assert.equal(firstStore.get(savingAtom), true)
      assert.equal(firstStore.get(preferencesAtom).theme, 'paper')
      assert.equal(secondStore.get(savingAtom), false)
      assert.equal(secondStore.get(preferencesAtom).theme, 'mint')
      blocked.resolve({ markdownEditor: calls.find(value => value.theme === 'paper') })
      await first
      assert.equal(firstStore.get(preferencesAtom).theme, 'paper')
      assert.equal(secondStore.get(preferencesAtom).theme, 'mint')
    `)
  })

  test('Given 首次直接修改偏好尚未加载 When 保存 Then 先读取磁盘底稿并保留未修改项', () => {
    verifyPreferencesScenario(`
      const saved = normalize({ fontSize: 22, contentWidth: 64, shortcuts: { toggleEdit: 'F2' } })
      const calls = [], loading = deferred()
      globalThis.window = { electronAPI: {
        getSettings: () => { calls.push('load'); return loading.promise },
        updateSettings: async ({ markdownEditor }) => { calls.push(markdownEditor); return { markdownEditor } },
      } }
      const store = createStore()
      const save = store.set(updateAtom, { theme: 'paper' })
      assert.equal(store.get(preferencesAtom).theme, 'paper')
      await flush()
      assert.deepEqual(calls, ['load'])
      loading.resolve({ markdownEditor: saved })
      await save
      assert.equal(calls.length, 2)
      assert.equal(calls[1].theme, 'paper')
      assert.equal(calls[1].fontSize, 22)
      assert.equal(calls[1].contentWidth, 64)
      assert.equal(calls[1].shortcuts.toggleEdit, 'F2')
      assert.deepEqual(store.get(preferencesAtom), calls[1])
    `)
  })

  test('Given 中间保存失败且队列中插入重新加载 When 下一次保存成功 Then 重放全部未确认修改', () => {
    verifyPreferencesScenario(`
      const saved = normalize({ fontSize: 22 }), firstWrite = deferred(), reload = deferred()
      let loads = 0
      const writes = []
      globalThis.window = { electronAPI: {
        getSettings: () => loads++ === 0 ? Promise.resolve({ markdownEditor: saved }) : reload.promise,
        updateSettings: ({ markdownEditor }) => {
          writes.push(markdownEditor)
          return writes.length === 1 ? firstWrite.promise : Promise.resolve({ markdownEditor })
        },
      } }
      const store = createStore()
      await store.set(loadAtom)
      const first = store.set(updateAtom, { theme: 'night' })
      const failure = assert.rejects(first, /保存失败/)
      const loading = store.set(loadAtom)
      const second = store.set(updateAtom, { contentWidth: 64 })
      await flush()
      firstWrite.reject(new Error('保存失败'))
      await failure
      await flush()
      reload.resolve({ markdownEditor: saved })
      await loading
      await second
      assert.equal(writes[1].theme, 'night')
      assert.equal(writes[1].fontSize, 22)
      assert.equal(writes[1].contentWidth, 64)
      assert.deepEqual(store.get(preferencesAtom), writes[1])
    `)
  })
})
