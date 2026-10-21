/** 只迁移应用曾分发的这五个 Skill，不推断用户自定义 Skill 的命名。 */
const LEGACY_BUILTIN_SUFFIXES = new Set([
  'coach',
  'build-ai-app',
  'cloud-sdk',
  'generate-image',
  'gpt-image-2',
])

/**
 * 仅替换已知模板文字；URL、MCP 名称、HTTP header 和凭据标识属于外部契约。
 * 保留旧 reference 文件名，避免把仍在目录中的文件链接改成不存在的新路径。
 */
const PRESERVED_CONTRACTS = /(https?:\/\/[^\s<>"'`]+|mcp__(?:proma-cloud|proma_cloud)__[\w-]+|X-Proma-Trace-ID|proma-agent-inner|references\/proma-cloud-api-summary\.md)/g

function rewriteTemplateText(content: string, availableCurrentSlugs?: ReadonlySet<string>): string {
  return content
    .replace(/(?<![\w-])proma-(coach|build-ai-app|cloud-sdk|generate-image|gpt-image-2)(?![\w-])/g,
      (legacyReference: string, suffix: string) => {
        const currentReference = `gamma-${suffix}`
        return availableCurrentSlugs === undefined || availableCurrentSlugs.has(currentReference) ? currentReference : legacyReference
      },
    )
    .replace(/\bProma[ \t]+Cloud[ \t]+LLM\b/g, '云端 LLM')
    .replace(/\bProma[ \t]+Cloud[ \t]+API\b/g, '云端 API')
    .replace(/\bProma[ \t]+Cloud\b/g, '云端服务')
    .replace(/\bProma(?=[ \t]+(?:Agent\b|Coach\b|AI 应用生成器|客户端|设置|Chat\b))/g, 'Gamma')
    .replace(/\bProma[ \t]+API\b/g, '云端 API')
    .replace(/\bProma[ \t]+平台/g, '云端平台')
    .replace(/\bProma[ \t]+积分体系/g, '云端积分体系')
    .replace(/\bProma[ \t]+余额不足/g, '云端服务余额不足')
    .replace(/\bProma(?=[ \t]+会在响应头返回|[ \t]+会按模型配置自动计费|[ \t]+已通过 API Key 记账|[ \t]+层)/g, '云端服务')
    .replace(/\bPROMA([ \t]*·[ \t]*AI TOOL)\b/g, 'GAMMA$1')
    .replace(/\bPROMA_(API_KEY|API_BASE|MODEL)\b/g, 'GAMMA_$1')
    .replace(/\.proma-models\.json\b/g, '.gamma-models.json')
    .replace(/\/tmp\/proma-models-raw\.json\b/g, '/tmp/gamma-models-raw.json')
}

/**
 * 在完整目录备份后迁移旧内置 Skill 的 Markdown。未知命名对保持原样。
 * 版本仅在实际改名时递增，重复启动不会不断提升；普通用户原文中的 Proma 不变。
 */
export function migrateLegacyBuiltinSkillContent(
  content: string,
  legacySlug: string,
  currentSlug: string,
  availableCurrentSlugs?: ReadonlySet<string>,
): string {
  const suffix = legacySlug.startsWith('proma-') ? legacySlug.slice('proma-'.length) : ''
  if (!LEGACY_BUILTIN_SUFFIXES.has(suffix) || currentSlug !== `gamma-${suffix}`) return content

  // 自身已进入改名流程；姐妹 Skill 仅在新路径确实可用时更新引用。
  const availableReferences = availableCurrentSlugs === undefined ? undefined : new Set([...availableCurrentSlugs, currentSlug])
  const parts = content.split(PRESERVED_CONTRACTS)
  const rewritten = parts.map((part, index) => index % 2 === 0 ? rewriteTemplateText(part, availableReferences) : part).join('')
  if (rewritten === content) return content

  const frontmatter = rewritten.match(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---(?:[ \t]*\r?\n|[ \t]*$)/)
  if (!frontmatter) return rewritten

  let previousVersion: string | undefined
  let currentVersion: string | undefined
  let upgraded = frontmatter[0].replace(
    /^(version:[ \t]*)(["']?)(\d+)\.(\d+)\.(\d+)\2([ \t]*(?:#[^\r\n]*)?\r?)$/m,
    (_match, prefix: string, quote: string, major: string, minor: string, patch: string, suffixText: string) => {
      previousVersion = `${major}.${minor}.${patch}`
      currentVersion = `${major}.${minor}.${Number(patch) + 1}`
      return `${prefix}${quote}${currentVersion}${quote}${suffixText}`
    },
  )
  if (previousVersion && currentVersion) {
    upgraded = upgraded.replace(/^description:[^\r\n]*$/m, (description) =>
      description.replaceAll(`版本 ${previousVersion}。`, `版本 ${currentVersion}。`),
    )
  }
  return upgraded + rewritten.slice(frontmatter[0].length)
}
