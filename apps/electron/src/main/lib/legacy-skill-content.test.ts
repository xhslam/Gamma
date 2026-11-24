import { describe, expect, test } from 'bun:test'
import { migrateLegacyBuiltinSkillContent } from './legacy-skill-content'

function migrate(content: string): string {
  return migrateLegacyBuiltinSkillContent(content, 'proma-build-ai-app', 'carpus-build-ai-app')
}

describe('旧内置 Skill 内容品牌迁移', () => {
  test('Given 旧内置模板与姐妹 Skill 引用 When 迁移 Then 同步名称、可见品牌和版本并保持幂等', () => {
    const source = [
      '---',
      'name: proma-build-ai-app',
      'description: Proma Cloud LLM API 调用，Proma Agent 使用 proma-cloud-sdk。',
      'version: 1.2.0',
      '---',
      '# Proma AI 应用生成器',
      'Proma 客户端 → Proma 设置面板',
      'PROMA · AI TOOL',
      '`proma-cloud-sdk/references/responses.md`、proma-generate-image、proma-gpt-image-2、proma-coach',
      "const PROMA_API_KEY = '{{API_KEY}}'; fetch(PROMA_API_BASE, {key: PROMA_API_KEY, model: PROMA_MODEL})",
    ].join('\n')

    const result = migrate(source)

    expect(result).toContain('name: carpus-build-ai-app')
    expect(result).toContain('description: 云端 LLM API 调用，Carpus Agent 使用 carpus-cloud-sdk。')
    expect(result).toContain('version: 1.2.1')
    expect(result).toContain('# Carpus AI 应用生成器')
    expect(result).toContain('Carpus 客户端 → Carpus 设置面板')
    expect(result).toContain('CARPUS · AI TOOL')
    expect(result).toContain('`carpus-cloud-sdk/references/responses.md`、carpus-generate-image、carpus-gpt-image-2、carpus-coach')
    expect(result).toContain("const CARPUS_API_KEY = '{{API_KEY}}'; fetch(CARPUS_API_BASE, {key: CARPUS_API_KEY, model: CARPUS_MODEL})")
    expect(migrate(result)).toBe(result)
  })

  test('Given 外部调用契约与用户普通原文 When 迁移 Then 保留域名、工具、header、凭据和已有文件链接', () => {
    const unchanged = [
      '用户原文：我以前叫 Proma，现在正在对比 Proma。',
      'https://api.proma.cool/v1/messages?skill=proma-cloud-sdk',
      'https://github.com/proma-ai/Proma',
      '`mcp__proma-cloud__get_credentials` `mcp__proma_cloud__get_credentials`',
      '`proma-agent-inner` `X-Proma-Trace-ID`',
      '`references/proma-cloud-api-summary.md`',
      '`custom-proma-cloud-sdk` `proma-cloud-sdk-custom`',
    ].join('\n')

    expect(migrate(unchanged)).toBe(unchanged)
  })

  for (const quote of ['', '"', "'"]) {
    test(`Given ${quote || '不带引号'} 版本与 CRLF When 迁移 Then 仅提升 patch 并保留 BOM、换行与引号`, () => {
      const source = `\uFEFF---\r\nname: 'proma-build-ai-app'\r\nversion: ${quote}1.2.9${quote} # 保留注释\r\n---\r\n用户原文 Proma\r\n`
      const result = migrate(source)
      expect(result).toBe(`\uFEFF---\r\nname: 'carpus-build-ai-app'\r\nversion: ${quote}1.2.10${quote} # 保留注释\r\n---\r\n用户原文 Proma\r\n`)
      expect(migrate(result)).toBe(result)
    })
  }

  test('Given 无 frontmatter 的 reference When 迁移 Then 改写模板品牌与缓存示例但不凭空添加版本', () => {
    const source = '# Proma Cloud API 速查\nProma 余额不足\n`.proma-models.json` `/tmp/proma-models-raw.json`\n'
    expect(migrate(source)).toBe('# 云端 API 速查\n云端服务余额不足\n`.carpus-models.json` `/tmp/carpus-models-raw.json`\n')
  })

  test('Given description 自带版本说明 When 迁移 Then 与 frontmatter 版本一同更新', () => {
    const source = '---\nname: proma-gpt-image-2\ndescription: 默认生图工具。版本 1.1.0。\nversion: 1.1.0\n---\n'
    const result = migrateLegacyBuiltinSkillContent(source, 'proma-gpt-image-2', 'carpus-gpt-image-2')
    expect(result).toContain('description: 默认生图工具。版本 1.1.1。')
    expect(result).toContain('version: 1.1.1')
    expect(migrateLegacyBuiltinSkillContent(result, 'proma-gpt-image-2', 'carpus-gpt-image-2')).toBe(result)
  })

  test('Given 姐妹 Skill 尚未迁移成功 When 按可用路径改名 Then 保留不可用新路径的旧引用', () => {
    const source = '---\nname: proma-build-ai-app\nversion: 1.2.0\n---\n`proma-cloud-sdk/references/responses.md`、proma-generate-image\n'
    const result = migrateLegacyBuiltinSkillContent(source, 'proma-build-ai-app', 'carpus-build-ai-app', new Set(['carpus-build-ai-app', 'carpus-generate-image']))
    expect(result).toContain('name: carpus-build-ai-app')
    expect(result).toContain('version: 1.2.1')
    expect(result).toContain('`proma-cloud-sdk/references/responses.md`、carpus-generate-image')
    expect(result).not.toContain('carpus-cloud-sdk')
    expect(migrateLegacyBuiltinSkillContent(source, 'proma-build-ai-app', 'carpus-build-ai-app', new Set())).toContain('name: carpus-build-ai-app')
  })

  test('Given 版本之外的内容没有旧品牌 When 迁移 Then 不提升版本且不修改未知命名对', () => {
    const source = '---\nname: carpus-build-ai-app\nversion: "1.2.1"\n---\nCarpus 应用\n'
    expect(migrate(source)).toBe(source)
    expect(migrateLegacyBuiltinSkillContent('name: proma-custom\nProma Agent', 'proma-custom', 'carpus-custom')).toBe('name: proma-custom\nProma Agent')
    expect(migrateLegacyBuiltinSkillContent('name: proma-coach', 'proma-coach', 'carpus-other')).toBe('name: proma-coach')
  })
})
