import { describe, expect, it } from 'bun:test'
import { selectMemoryCandidates, buildMemoryRetrievalRules } from './memory-retrieval-policy'
import type { MemoryCatalogFile } from './memory-catalog'
function file(path: string, aliases: string[], description: string, sensitive = false): MemoryCatalogFile {
  return { path, name: path.split('/').pop() ?? '', description, aliases, sensitive, updatedAt: 0, version: 'v1', size: 0, content: '', readOnly: false }
}
const catalog = [file('workspace:/areas/exam.md', ['秋考'], '数学考试复习计划与科目，安排复习时读'), file('global:/topics/health.md', ['健康'], '健康笔记，涉及健康时读', true), file('global:/preferences.md', ['偏好'], '回复语言和格式偏好'), file('global:/people/wang.md', ['小王'], '同事小王的交接职责'), file('workspace:/areas/handover.md', ['交接'], '小王的项目交接说明')]
describe('提取预检是精确兜底，不是相似主题自动读取', () => {
  it('Given 通用编程、翻译或晚餐 When 检查 Then 不应读', () => {
    for (const query of ['Python 里怎么反转列表？', '翻译这个健康宣传语', '推荐个晚餐菜谱']) expect(selectMemoryCandidates(query, catalog)).toEqual([])
  })
  it('Given 项目别名与个人问题 When 命中 Then 要求对应文件', () => {
    expect(selectMemoryCandidates('帮我安排秋考复习', catalog).map(item => item.path)).toEqual(['workspace:/areas/exam.md'])
  })
  it('Given 问题涉及同事与交接 When 命中 Then 两个文件均被选中', () => {
    const paths = selectMemoryCandidates('给同事小王写个交接说明', catalog).map(item => item.path)
    expect(paths).toContain('global:/people/wang.md'); expect(paths).toContain('workspace:/areas/handover.md')
  })
  it('Given 已常驻偏好或没有相关文件 When 检查 Then 不发无意义读取提醒', () => {
    expect(selectMemoryCandidates('我的偏好是什么', catalog)).toEqual([])
    expect(selectMemoryCandidates('我的电影口味是什么', catalog)).toEqual([])
  })
  it('Given 通用问题与敏感文件仅同主题 When 检查 Then 不应读', () => {
    expect(selectMemoryCandidates('解释健康饮食的一般原则', catalog)).toEqual([])
    expect(selectMemoryCandidates('我的健康情况上次怎么说的', catalog).map(item => item.path)).toEqual(['global:/topics/health.md'])
  })
  it('Given 两个作用域同一别名 When 读取 Then 都是候选，不隐式覆盖', () => {
    const files = [file('global:/areas/exam.md', ['秋考'], '秋考复习计划'), file('workspace:/areas/exam.md', ['秋考'], '秋考复习计划')]
    expect(selectMemoryCandidates('我的秋考安排', files)).toHaveLength(2)
  })
  it('Given profile因预算截断未完整注入 When 问到具体别名 Then 不跳过应读文件', () => {
    const files = [file('global:/profile.md', ['职业经历'], '职业经历的详细背景，涉及职业经历时读取')]
    expect(selectMemoryCandidates('我的职业经历是什么', files, new Set())).toHaveLength(1)
    expect(selectMemoryCandidates('我的职业经历是什么', files, new Set(['global:/profile.md']))).toEqual([])
  })
  it('Given 系统规则 When 生成 Then 包含完整决策、敏感边界、批量及6个示例', () => {
    const rules = buildMemoryRetrievalRules()
    expect(rules).toContain('<memory_rules>'); expect(rules).toContain('<memory_examples>'); expect(rules).toContain('例6'); expect(rules).toContain('本轮为准'); expect(rules).toContain('不要凭一行描述猜正文')
  })
})
