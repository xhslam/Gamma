import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { userProfileAtom } from '@/atoms/user-profile'
import { WelcomeEmptyState } from './WelcomeEmptyState'

describe('新 Agent 会话欢迎页', () => {
  test('Given 用户已设置昵称 When 渲染空会话 Then 问候语下方显示附件拖拽提示', () => {
    const store = createStore()
    store.set(userProfileAtom, { ...store.get(userProfileAtom), userName: '测试用户' })

    const html = renderToStaticMarkup(<Provider store={store}><WelcomeEmptyState /></Provider>)

    expect(html).toMatch(/<h1[^>]*>测试用户，(?:夜深了|早上好|下午好|晚上好)<\/h1>.*支持拖拽文件到输入框直接上传附件/)
    expect(html).toContain('aria-hidden="true"')
  })

  test('Given 用户未设置昵称 When 渲染空会话 Then 保留默认称呼和附件提示', () => {
    const store = createStore()
    store.set(userProfileAtom, { ...store.get(userProfileAtom), userName: '' })

    const html = renderToStaticMarkup(<Provider store={store}><WelcomeEmptyState /></Provider>)

    expect(html).toContain('>用户，')
    expect(html).toContain('支持拖拽文件到输入框直接上传附件')
  })
})
