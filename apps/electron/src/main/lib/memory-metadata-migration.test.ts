import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  mkdirSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMemoryDocument } from './memory-metadata'

import {
  buildMemoryMigrationPlan,
  applyMemoryMigrationPlan,
  saveMemoryMigrationPlan,
  loadMemoryMigrationPlan,
  computeMemoryContentHash,
} from './memory-metadata-migration'

describe('BDD: 记忆元数据迁移工具 (memory-metadata-migration)', () => {
  let sandboxDir: string
  let globalRoot: string
  let workspaceRoot: string

  beforeEach(() => {
    // 严格限制于隔离临时沙箱目录，绝不接触 ~/.gamma 真实数据
    sandboxDir = mkdtempSync(join(tmpdir(), 'gamma-memory-migration-bdd-'))
    globalRoot = join(sandboxDir, 'global-memory')
    workspaceRoot = join(sandboxDir, 'workspace-memory')
    mkdirSync(globalRoot, { recursive: true })
    mkdirSync(workspaceRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(sandboxDir, { recursive: true, force: true })
  })

  test('BDD-1 [dry-run 零写入]: Given 待迁移文件 When 执行 dry-run Then 零文件写入且内容与时间戳完全未变', async () => {
    const filePath = join(globalRoot, 'profile.md')
    const originalContent = '---\ndescription: "用户常住地与语言偏好，在交互时作为语言选择依据"\n---\n- [stated] 喜欢简洁回答\n'
    writeFileSync(filePath, originalContent, 'utf-8')
    const beforeStat = statSync(filePath)

    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })

    expect(plan.summary.totalFiles).toBe(1)
    expect(plan.summary.pending).toBe(1)
    expect(plan.items[0]!.targetMetadata.name).toBe('profile.md')

    // 验证文件原样保留，零写入
    const afterContent = readFileSync(filePath, 'utf-8')
    const afterStat = statSync(filePath)
    expect(afterContent).toBe(originalContent)
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs)
  })

  test('BDD-2 [未知 frontmatter / CRLF 正文保留]: Given 包含未知 frontmatter 字段与 CRLF 换行的记忆正文 When 执行 apply Then 完整保留未知字段与 CRLF 换行字节', async () => {
    const filePath = join(globalRoot, 'custom.md')
    const rawContentWithCrlf =
      '---\r\n' +
      'extra_unknown_field: "preserve_me"\r\n' +
      'custom_number: 100\r\n' +
      'description: "编程语言专长记录，在涉及代码生成时参考"\r\n' +
      '---\r\n' +
      '## 第一行正文\r\n' +
      '- [stated] 熟练掌握 TypeScript 与 Rust\r\n' +
      '## 第二行正文\r\n'

    writeFileSync(filePath, rawContentWithCrlf, 'utf-8')

    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })

    expect(plan.summary.pending).toBe(1)
    const applyResult = await applyMemoryMigrationPlan(plan, { confirm: true })
    expect(applyResult.success).toBe(true)
    expect(applyResult.appliedCount).toBe(1)

    const afterContent = readFileSync(filePath, 'utf-8')

    // 校验未知 frontmatter 字段完整保留
    expect(afterContent).toContain('extra_unknown_field: "preserve_me"')
    expect(afterContent).toContain('custom_number: 100')

    // 校验补齐的字段
    expect(afterContent).toContain('name: "custom.md"')

    // 校验正文原字节与 CRLF 完整保留
    expect(afterContent).toContain('## 第一行正文\r\n- [stated] 熟练掌握 TypeScript 与 Rust\r\n## 第二行正文\r\n')
  })

  test('BDD-3 [双根不串写]: Given globalRoot 与 workspaceRoot 双根 When 扫描与应用迁移 Then 双根各自独立不串写', async () => {
    const globalFile = join(globalRoot, 'global-profile.md')
    const workspaceFile = join(workspaceRoot, 'workspace-notes.md')

    writeFileSync(
      globalFile,
      '---\ndescription: "全局用户身份与定位，通用对话时优先读取"\n---\n- [stated] 全局信息\n',
      'utf-8',
    )
    writeFileSync(
      workspaceFile,
      '---\ndescription: "项目架构设计准则，工程编码任务时读取"\n---\n- [stated] 工作区信息\n',
      'utf-8',
    )

    const plan = await buildMemoryMigrationPlan({
      roots: [
        { scope: 'global', root: globalRoot },
        { scope: 'workspace', root: workspaceRoot },
      ],
    })

    expect(plan.summary.totalFiles).toBe(2)
    const scopes = plan.items.map((i) => i.scope)
    expect(scopes).toContain('global')
    expect(scopes).toContain('workspace')

    const applyResult = await applyMemoryMigrationPlan(plan, { confirm: true })
    expect(applyResult.success).toBe(true)
    expect(applyResult.appliedCount).toBe(2)

    // 校验两个根目录文件未串写
    expect(readFileSync(globalFile, 'utf-8')).toContain('name: "global-profile.md"')
    expect(readFileSync(workspaceFile, 'utf-8')).toContain('name: "workspace-notes.md"')

    // 确认 global 目录下没有 workspace 文件，反之亦然
    expect(readFileSync(globalFile, 'utf-8')).not.toContain('工作区信息')
    expect(readFileSync(workspaceFile, 'utf-8')).not.toContain('全局信息')
  })

  test('BDD-4 [symlink 忽略/拒绝]: Given 软链接文件与软链接目录 When 扫描记忆根 Then 忽略并拒绝穿透', async () => {
    const realFile = join(globalRoot, 'real.md')
    writeFileSync(
      realFile,
      '---\ndescription: "真实有效记忆文件，对话上下文读取"\n---\n- [stated] 真实文件内容\n',
      'utf-8',
    )

    // 在外部目录创建 target 文件并软链接到 memory 根目录
    const outsideDir = join(sandboxDir, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    const outsideTarget = join(outsideDir, 'outside-target.md')
    writeFileSync(outsideTarget, '---\nname: outside.md\n---\n', 'utf-8')

    const symlinkFile = join(globalRoot, 'symlinked-file.md')
    try {
      symlinkSync(outsideTarget, symlinkFile)
    } catch {
      // 部分受限系统跳过软链接创建
    }

    // 创建指向外部目录的软链接目录
    const symlinkSubdir = join(globalRoot, 'symlink-dir')
    try {
      symlinkSync(outsideDir, symlinkSubdir, 'dir')
    } catch {
      // 跳过
    }

    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })

    // 扫描必须跳过所有软链接，仅包含普通真实文件
    expect(plan.summary.totalFiles).toBe(1)
    expect(plan.items[0]!.fullPath).toBe(realFile)
  })

  test('BDD-5 [aliases <= 8]: Given 拥有超过 8 个 aliases 的记忆文件 When 规划迁移 Then 自动截断至 <= 8 且不丢失原有内容', async () => {
    const filePath = join(globalRoot, 'many-aliases.md')
    const manyAliases = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12']
    const content =
      `---\n` +
      `description: "多种称呼与别名映射，在意图识别时参考"\n` +
      `aliases: [${manyAliases.map((a) => `"${a}"`).join(', ')}]\n` +
      `---\n` +
      `- [stated] 用户别名集合\n`

    writeFileSync(filePath, content, 'utf-8')

    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })

    expect(plan.items[0]!.targetMetadata.aliases.length).toBe(8)
    expect(plan.items[0]!.targetMetadata.aliases).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'])

    const applyResult = await applyMemoryMigrationPlan(plan, { confirm: true })
    expect(applyResult.success).toBe(true)

    const updated = readFileSync(filePath, 'utf-8')
    expect(parseMemoryDocument(updated).metadata.aliases).toEqual(manyAliases.slice(0, 8))
    expect(updated).toContain('aliases_overflow: ["a9","a10","a11","a12"]')
  })

  test('BDD-6 [泛 description 有无 callback]: Given 泛化 description When 无 callback 与有 callback 时 Then 分别呈现 needsDescription 阻止 apply 与改写成功', async () => {
    const filePath = join(globalRoot, 'generic-desc.md')
    const genericContent =
      '---\n' +
      'description: "用户个人信息"\n' +
      '---\n' +
      '- [stated] 经常在晚间 22:00 之后阅读技术书籍\n'

    writeFileSync(filePath, genericContent, 'utf-8')

    // Case A: 未提供 rewriteDescription 回调
    const planWithoutCallback = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })

    expect(planWithoutCallback.items[0]!.needsDescription).toBe(true)
    expect(planWithoutCallback.items[0]!.status).toBe('blocked')
    expect(planWithoutCallback.summary.canApply).toBe(false)
    expect(planWithoutCallback.summary.blocked).toBe(1)

    // 尝试 apply 被阻塞的计划必须被拒绝抛错
    await expect(applyMemoryMigrationPlan(planWithoutCallback, { confirm: true })).rejects.toThrow(
      /阻塞项.*拒绝执行应用/,
    )

    // Case B: 提供合法的 rewriteDescription 回调
    let callbackCalled = false
    const planWithCallback = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
      rewriteDescription: async (context) => {
        callbackCalled = true
        expect(context.path).toBe('generic-desc.md')
        return '用户晚间技术阅读习惯记录，在推荐作息或阅读书单时参考'
      },
    })

    expect(callbackCalled).toBe(true)
    expect(planWithCallback.items[0]!.needsDescription).toBe(false)
    expect(planWithCallback.items[0]!.status).toBe('pending')
    expect(planWithCallback.summary.canApply).toBe(true)
    expect(planWithCallback.items[0]!.targetMetadata.description).toBe(
      '用户晚间技术阅读习惯记录，在推荐作息或阅读书单时参考',
    )

    const applyResult = await applyMemoryMigrationPlan(planWithCallback, { confirm: true })
    expect(applyResult.success).toBe(true)

    const updated = readFileSync(filePath, 'utf-8')
    expect(updated).toContain('description: "用户晚间技术阅读习惯记录，在推荐作息或阅读书单时参考"')
  })

  test('BDD-7 [敏感描述不泄漏]: Given 敏感健康/财务记忆 When 生成迁移计划与调用 callback Then description 仅保留主题且绝不向外泄漏敏感正文', async () => {
    const healthDir = join(globalRoot, 'topics')
    mkdirSync(healthDir, { recursive: true })
    const filePath = join(healthDir, 'health.md')

    const sensitiveContent =
      '---\n' +
      'description: "长期记忆"\n' +
      '---\n' +
      '- [stated] 确诊高血压，每日服用降压药硝苯地平 30mg，银行卡余额 88000 元\n'

    writeFileSync(filePath, sensitiveContent, 'utf-8')

    let capturedSummary: string | undefined
    let isSensitiveFlag = false

    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
      rewriteDescription: async (context) => {
        isSensitiveFlag = context.isSensitive
        capturedSummary = context.contentSummary
        return '用户的长期健康状况与日常医疗档案，仅在医疗健康建议场景下参考'
      },
    })

    // 校验敏感文件标记与内容安全防护
    expect(isSensitiveFlag).toBe(false) // 敏感主题本地生成，不向LLM调用任何正文或旧描述。
    expect(capturedSummary).toBeUndefined() // 敏感文件正文严禁外发给 LLM callback

    // 检查迁移计划 JSON 与 Diff：绝无敏感药品名称与具体金额事实
    const planJson = JSON.stringify(plan)
    expect(planJson).not.toContain('硝苯地平')
    expect(planJson).not.toContain('88000')

    const applyResult = await applyMemoryMigrationPlan(plan, { confirm: true })
    expect(applyResult.success).toBe(true)

    const updated = readFileSync(filePath, 'utf-8')
    // 正文中的原始敏感事实依然原样保存在本地
    expect(updated).toContain('硝苯地平 30mg')
    // 但 description 仅为抽象主题
    expect(parseMemoryDocument(updated).metadata.description).toBe('健康笔记；用户明确涉及健康主题时读取')
  })

  test('BDD-8 [预览后文件变更 CAS 拒绝]: Given 预览生成的迁移计划 When 原文件在预览后被外部修改 Then CAS 版本校验拒绝应用并报告失败', async () => {
    const filePath = join(globalRoot, 'profile.md')
    writeFileSync(
      filePath,
      '---\ndescription: "初始用户画像，对话起步阶段参考"\n---\n- [stated] 初版内容\n',
      'utf-8',
    )

    // 1. 生成计划并计算当时的 version
    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })
    expect(plan.summary.pending).toBe(1)

    // 2. 模拟其他端或外部程序修改了文件
    writeFileSync(filePath, '---\ndescription: "已被另一端同步修改"\n---\n- [stated] 新内容\n', 'utf-8')

    // 3. 执行应用，CAS 版本比对应当发现冲突并安全拒绝覆盖
    const applyResult = await applyMemoryMigrationPlan(plan, { confirm: true })

    expect(applyResult.success).toBe(false)
    expect(applyResult.appliedCount).toBe(0)
    expect(applyResult.failureCount).toBe(1)
    expect(applyResult.results[0]!.success).toBe(false)
    expect(applyResult.results[0]!.error).toContain('CAS 版本校验失败')

    // 确保外部修改的内容未被回滚破坏
    const currentOnDisk = readFileSync(filePath, 'utf-8')
    expect(currentOnDisk).toContain('已被另一端同步修改')
  })

  test('BDD-9 [apply 无 confirm 拒绝]: Given 合法迁移计划 When apply 未明确 confirm: true Then 拒绝执行抛出错误', async () => {
    const filePath = join(globalRoot, 'note.md')
    writeFileSync(
      filePath,
      '---\ndescription: "普通工作笔记，开发任务时参考"\n---\n- [stated] 任务备忘\n',
      'utf-8',
    )

    const plan = await buildMemoryMigrationPlan({
      roots: [{ scope: 'global', root: globalRoot }],
    })

    // 未传递 confirm 参数或 confirm 为 false
    await expect(applyMemoryMigrationPlan(plan, { confirm: false })).rejects.toThrow(
      /必须明确指定 confirm: true/,
    )
  })

  test('BDD-10 [迁移计划持久化]: Given 迁移计划 When 调用 saveMemoryMigrationPlan 与 loadMemoryMigrationPlan Then 原子落盘并无损还原', () => {
    const planPath = join(sandboxDir, 'plan.json')
    const samplePlan = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      roots: [{ scope: 'global' as const, root: globalRoot }],
      items: [
        {
          scope: 'global' as const,
          path: 'profile.md',
          fullPath: join(globalRoot, 'profile.md'),
          currentVersion: 'hash-abc',
          originalMetadata: { name: '', description: 'test' },
          targetMetadata: { name: 'profile.md', description: 'test', sources: [], aliases: [] },
          diff: {
            name: { from: '', to: 'profile.md', changed: true },
            hasChanges: true,
          },
          needsDescription: false,
          isSensitive: false,
          status: 'pending' as const,
        },
      ],
      summary: {
        totalFiles: 1,
        upToDate: 0,
        pending: 1,
        blocked: 0,
        sensitiveFiles: 0,
        canApply: true,
      },
    }

    saveMemoryMigrationPlan(planPath, samplePlan)
    const loaded = loadMemoryMigrationPlan(planPath)

    expect(loaded.version).toBe(1)
    expect(loaded.items.length).toBe(1)
    expect(loaded.items[0]!.targetMetadata.name).toBe('profile.md')
    expect(loaded.summary.pending).toBe(1)
  })
})
