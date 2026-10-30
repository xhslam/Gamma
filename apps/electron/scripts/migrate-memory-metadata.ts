#!/usr/bin/env bun
/**
 * 记忆元数据迁移 CLI 脚本
 *
 * 用法：
 * 1. 预览/生成迁移计划（默认 Dry Run）：
 *    bun run apps/electron/scripts/migrate-memory-metadata.ts --global-root ./memory --dry-run
 *    bun run apps/electron/scripts/migrate-memory-metadata.ts --workspace-slug my-project --plan ./migration-plan.json
 *
 * 2. 启用 LLM 自动补全/重写空泛 description：
 *    GAMMA_MEMORY_MIGRATION_API_KEY=sk-xxx bun run apps/electron/scripts/migrate-memory-metadata.ts --rewrite-descriptions --model gpt-4o-mini
 *
 * 3. 执行原子落盘应用迁移：
 *    bun run apps/electron/scripts/migrate-memory-metadata.ts --apply ./migration-plan.json --confirm
 */

import { resolve, relative, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { getMemoryDir, getAgentWorkspacePath } from '../src/main/lib/config-paths'
import {
  buildMemoryMigrationPlan,
  applyMemoryMigrationPlan,
  saveMemoryMigrationPlan,
  loadMemoryMigrationPlan,
  type MemoryMigrationRoot,
  type MemoryDescriptionRewriter,
  type MemoryMigrationPlan,
} from '../src/main/lib/memory-metadata-migration'

interface CliOptions {
  help: boolean
  globalRoot?: string
  workspaceRoot?: string
  workspaceSlug?: string
  dryRun: boolean
  planPath?: string
  applyPath?: string
  confirm: boolean
  rewriteDescriptions: boolean
  model: string
  baseUrl: string
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    dryRun: false,
    confirm: false,
    rewriteDescriptions: false,
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const valueFlags = ['--global-root', '--workspace-root', '--workspace-slug', '--plan', '--apply', '--model', '--base-url']
    if (arg && valueFlags.includes(arg) && (!args[i + 1] || args[i + 1]!.startsWith('--'))) throw new Error(`${arg} 缺少参数值`)
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--global-root') {
      options.globalRoot = args[++i]
    } else if (arg === '--workspace-root') {
      options.workspaceRoot = args[++i]
    } else if (arg === '--workspace-slug') {
      options.workspaceSlug = args[++i]
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--plan') {
      options.planPath = args[++i]
    } else if (arg === '--apply') {
      options.applyPath = args[++i]
    } else if (arg === '--confirm') {
      options.confirm = true
    } else if (arg === '--rewrite-descriptions') {
      options.rewriteDescriptions = true
    } else if (arg === '--model') {
      options.model = args[++i] || options.model
    } else if (arg === '--base-url') {
      options.baseUrl = args[++i] || options.baseUrl
    } else throw new Error(`未知参数：${arg}`)
  }
  if (options.dryRun && options.applyPath) throw new Error('--dry-run 不能与 --apply 同时使用')
  return options
}

function printHelp(): void {
  console.log(`
记忆元数据迁移脚本 (Gamma Memory Metadata Migration CLI)

用法:
  bun run apps/electron/scripts/migrate-memory-metadata.ts [选项]

选项:
  --global-root <path>        指定全局记忆根目录（若未指定，默认推导自 getMemoryDir()）
  --workspace-root <path>     指定工作区记忆根目录
  --workspace-slug <slug>     指定工作区 slug（通过 getAgentWorkspacePath(slug) 派生）
  --dry-run                   仅扫描并生成差异计划，不执行写入（默认行为）
  --plan <path>               显式保存迁移计划；未传时只输出预览，不写计划文件
  --apply <planPath>          读取已生成的迁移计划 JSON 并执行原子落盘
  --confirm                   确认执行写入（防止误操作，执行 --apply 时必须提供）
  --rewrite-descriptions      开启 LLM 异步改写过于笼统或缺失的 description 字段
  --model <model>             指定用于改写的 LLM 模型名称（默认: gpt-4o-mini）
  --base-url <url>            指定 OpenAI 兼容的 Base URL（默认: https://api.openai.com/v1）
  --help, -h                  显示帮助信息

环境变量:
  GAMMA_MEMORY_MIGRATION_API_KEY  LLM API Key（安全读取，绝不输出到日志或控制台）

注意:
  - 迁移工具绝不修改正文字节与未知 frontmatter 字段，绝不删除任何文件。
  - workspace 必须显式通过 --workspace-root 或 --workspace-slug 指定，默认不跨根扫描。
  - 敏感健康/财务/身份文件不会外发正文给 LLM，description 仅提主题。
`)
}

/**
 * 创建 OpenAI 兼容的描述改写回调
 * 严格遵循非敏感主题提取，敏感文件绝不外发正文
 */
function createOpenAiRewriter(options: {
  apiKey: string
  model: string
  baseUrl: string
}): MemoryDescriptionRewriter {
  return async (context) => {
    const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const systemPrompt = [
      '你是一个专业的记忆元数据优化助手。',
      '任务：为给定的长期记忆 Markdown 文件生成单行 description。',
      '规范约束：',
      '1. 必须是单行文本，总字数严格控制在 150 字符以内。',
      '2. 说明该记忆文件“覆盖什么内容 + 具体细分主题 + 何时应当检索阅读”。',
      '3. 严禁使用“用户个人信息”、“用户偏好”这类泛化无信息量的词汇。',
      '4. 敏感文件约束：如果文件标记为敏感（涉及健康/医疗、财务/资产、身份凭证等），描述仅允许总结抽象主题，绝不可提及任何具体事实、数值、卡号或隐私细节！',
      '直接输出纯文本描述，不带任何 Markdown 标记或前后引号。',
    ].join('\n')

    const userPrompt = [
      `文件路径: ${context.path}`,
      `当前描述: ${context.existingDescription || '(缺失)'}`,
      `文件类别: ${context.scope === 'global' ? '全局记忆' : '工作区记忆'}`,
      `敏感文件: ${context.isSensitive ? '是 (仅总结主题，禁提具体事实)' : '否'}`,
      context.topicHint ? `主题提示: ${context.topicHint}` : '',
      // 敏感文件绝对不发送正文摘要！
      !context.isSensitive && context.contentSummary
        ? `正文非敏感摘要参考:\n${context.contentSummary}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 120,
      }),
    })

    if (!response.ok) {
      throw new Error(`LLM 请求失败 (HTTP ${response.status})`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const rawDesc = payload.choices?.[0]?.message?.content?.trim() ?? ''
    return rawDesc.replace(/\r?\n+/g, ' ').slice(0, 150)
  }
}

/**
 * 打印迁移计划的纯 Frontmatter 差异预览（绝不泄漏正文）
 */
function renderPlanPreview(plan: MemoryMigrationPlan): void {
  console.log(`\n========== 记忆元数据迁移计划预览 ==========`)
  console.log(`计划创建时间: ${plan.createdAt}`)
  console.log(`扫描根目录数: ${plan.roots.length}`)
  for (const r of plan.roots) {
    console.log(`  - [${r.scope}] ${r.root}`)
  }
  console.log(`\n扫描文件项详情 (共 ${plan.items.length} 项):`)

  for (const item of plan.items) {
    const statusBadge =
      item.status === 'up-to-date'
        ? '✓ 已是最新'
        : item.status === 'pending'
          ? '→ 待更新'
          : '✗ 阻塞 (需LLM/待补全)'
    const sensitiveBadge = item.isSensitive ? ' [🔒 敏感主题]' : ''

    console.log(`\n[${item.scope}] ${item.path} ${statusBadge}${sensitiveBadge}`)
    console.log(`  当前哈希: ${item.currentVersion.slice(0, 12)}...`)

    if (item.status === 'blocked') {
      console.log(`  阻塞原因: ${item.reason ?? '未配置 description 改写'}`)
    }

    if (item.diff.hasChanges) {
      console.log(`  元数据差异:`)
      if (item.diff.name?.changed) {
        console.log(`    name: "${item.diff.name.from ?? ''}" → "${item.diff.name.to}"`)
      }
      if (item.diff.description?.changed) {
        console.log(`    description: "${item.diff.description.from ?? ''}" → "${item.diff.description.to}"`)
      }
      if (item.diff.sources?.changed) {
        console.log(
          `    sources: [${(item.diff.sources.from ?? []).join(', ')}] → [${item.diff.sources.to.join(', ')}]`,
        )
      }
      if (item.diff.aliases?.changed) {
        console.log(
          `    aliases: [${(item.diff.aliases.from ?? []).join(', ')}] → [${item.diff.aliases.to.join(', ')}]`,
        )
      }
    }
  }

  console.log(`\n========== 汇总统计 ==========`)
  console.log(`总文件数: ${plan.summary.totalFiles}`)
  console.log(`已是最新: ${plan.summary.upToDate}`)
  console.log(`待更新项: ${plan.summary.pending}`)
  console.log(`阻塞项数: ${plan.summary.blocked}`)
  console.log(`敏感文件: ${plan.summary.sensitiveFiles}`)
  console.log(`可否应用: ${plan.summary.canApply ? '可以执行 apply' : '否 (存在阻塞项)'}`)
  console.log(`=========================================\n`)
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  // 模式 1: 执行迁移应用 (--apply <planPath>)
  if (options.applyPath) {
    const planFile = resolve(options.applyPath)
    if (!existsSync(planFile)) {
      console.error(`❌ 错误：指定的计划文件不存在: ${planFile}`)
      process.exit(1)
    }

    if (!options.confirm) {
      console.error(`❌ 错误：应用记忆元数据迁移必须明确指定 --confirm 标志！`)
      console.error(`示例: bun run apps/electron/scripts/migrate-memory-metadata.ts --apply "${options.applyPath}" --confirm`)
      process.exit(1)
    }

    let plan: MemoryMigrationPlan
    try {
      plan = loadMemoryMigrationPlan(planFile)
    } catch (err) {
      console.error(`❌ 错误：加载迁移计划失败:`, err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    if (plan.summary.blocked > 0) {
      console.error(`❌ 拒绝执行：该计划包含 ${plan.summary.blocked} 个未解决的阻塞项。请先处理缺失的 description 后再生成新计划！`)
      process.exit(1)
    }

    console.log(`正在应用记忆元数据迁移 (共 ${plan.summary.pending} 个待更新项)...`)
    const result = await applyMemoryMigrationPlan(plan, { confirm: true })

    console.log(`\n========== 应用结果 ==========`)
    for (const r of result.results) {
      if (r.success) {
        console.log(`✓ [成功] [${r.scope}] ${r.path}`)
      } else {
        console.error(`✗ [失败] [${r.scope}] ${r.path}: ${r.error}`)
      }
    }

    console.log(`\n统计: 成功应用 ${result.appliedCount} 个, 失败 ${result.failureCount} 个`)
    if (result.success) {
      console.log(`🎉 全部元数据原子迁移更新成功！`)
      process.exit(0)
    } else {
      console.error(`部分文件应用失败；已成功的文件保留更新，失败项已跳过，请查看逐项结果。`)
      process.exit(1)
    }
  }

  // 模式 2: 构建迁移计划 (Dry Run 预览)
  const roots: MemoryMigrationRoot[] = []

  // 1. 全局记忆根目录
  if (options.globalRoot) {
    roots.push({ scope: 'global', root: resolve(options.globalRoot) })
  } else {
    try {
      const defaultGlobal = getMemoryDir()
      if (existsSync(defaultGlobal)) {
        roots.push({ scope: 'global', root: defaultGlobal })
      }
    } catch {
      // 无法获取默认路径时允许用户显式传入
    }
  }

  // 2. 工作区记忆根目录（必须显式传入 slug 或 root）
  if (options.workspaceRoot) {
    roots.push({ scope: 'workspace', root: resolve(options.workspaceRoot) })
  } else if (options.workspaceSlug) {
    try {
      const wsPath = getAgentWorkspacePath(options.workspaceSlug)
      const wsMemDir = resolve(wsPath, 'memory')
      roots.push({
        scope: 'workspace',
        root: wsMemDir,
      })
    } catch (err) {
      console.error(`❌ 无法解析 workspaceSlug "${options.workspaceSlug}":`, err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }

  if (roots.length === 0) {
    console.error(`❌ 错误：未找到有效的记忆根目录。请显式传入 --global-root 或 --workspace-root / --workspace-slug。`)
    process.exit(1)
  }

  // 3. 配置 LLM 重写回调
  let rewriter: MemoryDescriptionRewriter | undefined

  if (options.rewriteDescriptions) {
    const apiKey = process.env.GAMMA_MEMORY_MIGRATION_API_KEY
    if (!apiKey || apiKey.trim().length === 0) {
      console.error(`❌ 错误：显式指定了 --rewrite-descriptions，但未配置环境变量 GAMMA_MEMORY_MIGRATION_API_KEY。`)
      console.error(`出于安全规范，API Key 仅通过环境变量读取，禁止在 CLI 参数或日志中暴露。`)
      process.exit(1)
    }

    rewriter = createOpenAiRewriter({
      apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
    })
    console.log(`[配置] 已启用 LLM 异步改写 (模型: ${options.model}, 兼容接口: ${options.baseUrl})`)
  }

  console.log(`正在扫描与构建元数据迁移计划...`)
  const plan = await buildMemoryMigrationPlan({
    roots,
    rewriteDescription: rewriter,
  })

  // 渲染 Diff 预览（无敏感正文）
  renderPlanPreview(plan)

  // 保存迁移计划到磁盘
  const targetPlanPath = options.planPath ? resolve(options.planPath) : undefined
  if (targetPlanPath) {
    if (roots.some(root => { const rel = relative(root.root, targetPlanPath); return !rel.startsWith('..') && !isAbsolute(rel) })) throw new Error('迁移计划必须保存在记忆根之外，避免覆盖现有记忆文件')
    saveMemoryMigrationPlan(targetPlanPath, plan)
    console.log(`迁移计划已原子保存至: ${targetPlanPath}`)
  } else console.log('本次仅预览，未写入任何计划文件；需要留存时传 --plan <path>。')

  if (plan.summary.blocked > 0) {
    console.warn(`\n⚠️ 注意: 计划中有 ${plan.summary.blocked} 个文件存在缺失或空泛的 description。`)
    console.warn(`未配置 LLM 改写或改写未通过，apply 操作将被拒绝。`)
    console.warn(`若要通过 LLM 自动改写，请设置 GAMMA_MEMORY_MIGRATION_API_KEY 并传入 --rewrite-descriptions。`)
  } else if (plan.summary.pending > 0) {
    console.log(`\n💡 若确认应用更新，请运行以下命令进行原子落盘:`)
    console.log(`   bun run apps/electron/scripts/migrate-memory-metadata.ts --apply "${targetPlanPath}" --confirm\n`)
  } else {
    console.log(`✨ 全部记忆文件元数据均为最新，无需迁移更新。`)
  }
}

main().catch((err) => {
  console.error(`❌ 迁移脚本异常退出:`, err instanceof Error ? err.message : String(err))
  process.exit(1)
})
