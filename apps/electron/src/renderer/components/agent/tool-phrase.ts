/**
 * 工具语义化短语生成器
 *
 * 将工具名 + 输入参数合成为一句连贯、可读的中文短语，
 * 用于工具活动行的收起态展示和 Loading 态展示。
 */

import { computeDiffStats } from './tool-utils'

const INTERNAL_TOOL_INPUT_PREFIX = '_'

/** 判断工具输入是否提供了可帮助用户识别本次调用的额外上下文。 */
function hasMeaningfulToolInput(input: Record<string, unknown>): boolean {
  return Object.entries(input).some(([key, value]) => {
    if (key.startsWith(INTERNAL_TOOL_INPUT_PREFIX)) {
      return key === '_intent' && typeof value === 'string' && value.trim().length > 0
    }
    if (typeof value === 'string') return value.trim().length > 0
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.length > 0
    return typeof value === 'object' && value !== null
  })
}

/** 去掉常见分隔符后比较名称和描述，兼容 MCP 工具名称格式。 */
function normalizeToolLabel(label: string): string {
  return label.toLocaleLowerCase().replace(/[\s/_.·-]+/g, '')
}

/**
 * 判断工具行是否需要显示工具类型前缀。
 *
 * 没有调用上下文时，名称后的短语只是工具的泛化描述，显示名称只会造成重复。
 */
export function shouldShowToolKindLabel(
  toolName: string,
  input: Record<string, unknown>,
  kindLabel: string,
  phraseLabel: string,
): boolean {
  // MCP 工具的语义化短语已经包含完整的 "SERVER / TOOL" 名称，
  // 再叠加 toolKindLabel 前缀会形成 "名称 · 名称 + 参数" 的重复，直接隐藏前缀。
  if (toolName.startsWith('mcp__')) return false
  if (!hasMeaningfulToolInput(input)) return false
  if (!kindLabel.trim() || !phraseLabel.trim()) return false
  if (normalizeToolLabel(kindLabel) === normalizeToolLabel(phraseLabel)) return false
  return normalizeToolLabel(toolName) !== normalizeToolLabel(phraseLabel)
}

/** 工具短语 */
export interface ToolPhrase {
  /** 完成态/收起态短语，如 "读取 foo.ts 第 10-60 行" */
  label: string
  /** Loading 态短语，如 "正在读取 foo.ts..." */
  loadingLabel: string
  /** 编辑/写入的增删行数统计，独立于 label，便于 UI 单独渲染且不被路径截断 */
  diffStats?: { additions: number; deletions: number }
}

/**
 * 优先使用 Agent 为工具调用提供的短意图。
 * `_intent` 是内部展示元数据；Bash 的 `description` 兼容旧的语义化调用格式。
 */
function getExplicitToolIntent(toolName: string, input: Record<string, unknown>): string | null {
  const intent = input._intent
  if (typeof intent === 'string' && intent.trim()) return truncate(intent.trim(), 96)

  if (toolName === 'Bash') {
    const description = input.description
    if (typeof description === 'string' && description.trim()) {
      return truncate(description.trim(), 96)
    }
  }

  return null
}

/** 从路径中提取文件名（同时兼容 POSIX `/` 与 Windows `\` 分隔符） */
function filename(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/**
 * 从 Gamma Skill 入口文件路径中提取 Skill 名称。
 *
 * Pi Agent 以普通 Read 工具加载 Skill，因此需在展示层识别
 * `<workspace>/skills/<skill-name>/SKILL.md`，避免标题只显示泛化的 SKILL.md。
 */
function skillNameFromEntryPath(path: string): string | null {
  const normalizedPath = path.replace(/\\/g, '/')
  const match = normalizedPath.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i)
  return match?.[1] ?? null
}

/** 截断文本 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** 桌面操作动作类型到中文意图映射 */
function getComputerActionIntent(action: string, input: Record<string, unknown>): string {
  const coordinate = (input.coordinate as [number, number]) ?? (input.x !== undefined && input.y !== undefined ? [input.x, input.y] : undefined)
  switch (action) {
    case 'screenshot': return '截取屏幕'
    case 'get_app_state': return '观察应用状态'
    case 'list_apps': return '查看运行中的应用'
    case 'set_value': return input.text === '' ? '清空文本控件' : '替换控件文本'
    case 'focus': return '聚焦文本或控件'
    case 'select_text': return '选择文本或定位光标'
    case 'perform_secondary_action': return '执行控件辅助动作'
    case 'paste': return '粘贴文本并保护剪贴板'
    case 'open_app': return typeof input.app === 'string' ? `打开应用 ${input.app}` : '打开应用'
    case 'click':
    case 'left_click': return coordinate ? `点击 [${coordinate[0]}, ${coordinate[1]}]` : '点击'
    case 'double_click': return coordinate ? `双击 [${coordinate[0]}, ${coordinate[1]}]` : '双击'
    case 'triple_click': return '三击'
    case 'right_click': return coordinate ? `右键点击 [${coordinate[0]}, ${coordinate[1]}]` : '右键点击'
    case 'middle_click': return '中键点击'
    case 'mouse_move':
    case 'move': return coordinate ? `移动到 [${coordinate[0]}, ${coordinate[1]}]` : '移动鼠标'
    case 'type_text':
    case 'type': {
      const text = typeof input.text === 'string' ? truncate(input.text, 20) : ''
      return text ? `输入“${text}”` : '输入文本'
    }
    case 'press_key':
    case 'key': return typeof input.key === 'string' ? `按下 ${input.key}` : '按键'
    case 'scroll': {
      const delta = (input.delta_y ?? input.deltaY ?? input.scroll_amount) as number | undefined
      return delta && delta > 0 ? '向上滚动' : '向下滚动'
    }
    case 'drag':
    case 'left_click_drag': return '拖拽'
    case 'wait': {
      const d = input.duration
      return typeof d === 'number' ? `等待 ${d} 秒` : '等待'
    }
    case 'list_windows': return '查看窗口列表'
    case 'focus_window': return '切换窗口'
    default: return action
  }
}

/**
 * 根据工具名和输入参数生成语义化短语
 *
 * 返回的 label 应读起来像一个完整动宾短语，无冗余信息。
 */
export function getToolPhrase(toolName: string, input: Record<string, unknown>, isError = false): ToolPhrase {
  const explicitIntent = getExplicitToolIntent(toolName, input)
  if (explicitIntent && toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'computer') {
    return phrase(explicitIntent)
  }

  switch (toolName) {
    case 'computer': {
      const explicitIntent = getExplicitToolIntent(toolName, input)
      const app = (input.app ?? input.appName ?? input.app_name) as string | undefined
      const action = (input.action as string) || '桌面操作'
      const target = app ? `${app}` : '系统'
      const actionIntent = getComputerActionIntent(action, input)
      const intent = explicitIntent ?? actionIntent
      return {
        label: `操作 ${target}：${intent}`,
        loadingLabel: `正在操作 ${target}：${intent}...`,
      }
    }

    case 'memory_write':
    case 'memory_append':
    case 'memory_str_replace': {
      return {
        label: isError ? '记忆更新失败' : '已更新记忆',
        loadingLabel: '正在更新记忆...',
      }
    }

    case 'memory_read': {
      const fp = input.path
      const name = Array.isArray(fp) ? fp.filter((value): value is string => typeof value === 'string').map(filename).join('、') : typeof fp === 'string' ? filename(fp) : '文件'
      return {
        label: isError ? `读取记忆失败 ${name}` : `读取记忆 ${name}`,
        loadingLabel: '正在读取记忆...',
      }
    }

    case 'memory_search': return { label: isError ? '搜索记忆失败' : '搜索记忆', loadingLabel: '正在搜索记忆...' }
    case 'memory_delete': return { label: isError ? '删除记忆失败' : '已删除记忆', loadingLabel: '正在删除记忆...' }
    case 'memory_list': {
      return {
        label: isError ? '查阅记忆清单失败' : '查阅记忆清单',
        loadingLabel: '正在检索记忆清单...',
      }
    }

    case 'Read': {
      const fp = input.file_path ?? input.filePath
      if (typeof fp === 'string') {
        const skillName = skillNameFromEntryPath(fp)
        if (skillName) return phrase(`读取技能 ${skillName}`)

        const name = filename(fp)
        const offset = typeof input.offset === 'number' ? input.offset : undefined
        const limit = typeof input.limit === 'number' ? input.limit : undefined
        if (offset !== undefined && limit !== undefined) {
          return phrase(`读取 ${name} 第 ${offset}-${offset + limit} 行`)
        }
        if (offset !== undefined) {
          return phrase(`读取 ${name} 从第 ${offset} 行`)
        }
        return phrase(`读取 ${name}`)
      }
      return phrase('读取文件')
    }

    case 'Edit': {
      const fp = input.file_path ?? input.filePath
      const name = typeof fp === 'string' ? filename(fp) : '文件'
      const diff = computeDiffStats('Edit', input)
      const explicitIntent = getExplicitToolIntent(toolName, input)
      const basePhrase = explicitIntent
        ? phrase(explicitIntent)
        : phrase(`编辑 ${name}`)
      if (diff && (diff.additions > 0 || diff.deletions > 0)) {
        return { ...basePhrase, diffStats: diff }
      }
      return basePhrase
    }

    case 'Write': {
      const fp = input.file_path ?? input.filePath
      const name = typeof fp === 'string' ? filename(fp) : '文件'
      const content = input.content
      const explicitIntent = getExplicitToolIntent(toolName, input)
      const basePhrase = explicitIntent
        ? phrase(explicitIntent)
        : phrase(`写入 ${name}`)
      if (typeof content === 'string' && content.length > 0) {
        const lines = content.split('\n').length
        return { ...basePhrase, diffStats: { additions: lines, deletions: 0 } }
      }
      return basePhrase
    }

    case 'Bash': {
      const cmd = input.command
      const intent = getExplicitToolIntent(toolName, input)
      if (intent) return phrase(intent)
      if (typeof cmd === 'string') {
        return phrase(`执行 ${truncate(cmd, 80)}`)
      }
      return phrase('执行命令')
    }

    case 'Grep': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        const parts = [`搜索内容 /${pattern}/`]
        const path = input.path
        const glob = input.glob
        if (typeof glob === 'string') {
          parts.push(`in ${glob}`)
        } else if (typeof path === 'string') {
          parts.push(`in ${path}`)
        }
        return phrase(parts.join(' '))
      }
      return phrase('搜索内容')
    }

    case 'Glob': {
      const pattern = input.pattern
      if (typeof pattern === 'string') {
        const parts = [`搜索文件 ${pattern}`]
        const path = input.path
        if (typeof path === 'string') {
          parts.push(`in ${path}`)
        }
        return phrase(parts.join(' '))
      }
      return phrase('搜索文件')
    }

    case 'WebFetch': {
      const url = input.url
      if (typeof url === 'string') {
        return phrase(`抓取 ${truncate(url, 60)}`)
      }
      return phrase('抓取网页')
    }

    case 'WebSearch': {
      const query = input.query
      if (typeof query === 'string') {
        return phrase(`搜索 "${truncate(query, 60)}"`)
      }
      return phrase('搜索网页')
    }

    case 'Skill': {
      const skill = input.skill
      if (typeof skill === 'string') {
        return phrase(`使用技能 ${skill}`)
      }
      return phrase('使用技能')
    }

    case 'NotebookEdit': {
      const fp = input.notebook_path
      if (typeof fp === 'string') {
        return phrase(`编辑笔记本 ${filename(fp)}`)
      }
      return phrase('编辑笔记本')
    }

    case 'Task': {
      const desc = input.description ?? input.prompt
      if (typeof desc === 'string') {
        return phrase(`子任务 ${truncate(desc, 80)}`)
      }
      return phrase('子任务')
    }

    case 'Agent': {
      const name = input.name
      const desc = input.description ?? input.prompt
      if (typeof name === 'string' && typeof desc === 'string') {
        return phrase(`Agent ${name} · ${truncate(desc, 60)}`)
      }
      if (typeof desc === 'string') return phrase(`Agent ${truncate(desc, 80)}`)
      if (typeof name === 'string') return phrase(`Agent ${name}`)
      return phrase('Agent')
    }

    case 'TaskCreate': {
      const subject = input.subject
      if (typeof subject === 'string') {
        return phrase(`创建任务 ${truncate(subject, 80)}`)
      }
      return phrase('创建任务')
    }

    case 'TaskUpdate': {
      // TaskUpdate 是自描述工具，label 即完整语义
      const statusMap: Record<string, string> = {
        pending: '待处理',
        in_progress: '进行中',
        completed: '已完成',
        cancelled: '已取消',
        blocked: '已阻塞',
        error: '出错',
        deleted: '已删除',
      }
      const parts: string[] = []
      if (typeof input.taskId === 'string') parts.push(`任务 #${input.taskId}`)
      if (typeof input.status === 'string') parts.push(statusMap[input.status] ?? input.status)
      if (typeof input.subject === 'string') parts.push(truncate(input.subject, 60))
      if (parts.length > 0) return phrase(parts.join(' '))
      return phrase('更新任务')
    }

    case 'TaskGet': {
      const taskId = input.taskId
      if (typeof taskId === 'string') return phrase(`查看任务 #${taskId}`)
      return phrase('查看任务')
    }

    case 'TaskList': {
      return phrase('查看任务列表')
    }

    case 'TodoWrite': {
      const todos = input.todos
      if (Array.isArray(todos)) {
        return phrase(`更新待办 ${todos.length} 项`)
      }
      return phrase('更新待办')
    }

    case 'TodoRead': {
      return phrase('读取待办')
    }

    case 'EnterPlanMode': {
      return phrase('进入计划模式')
    }

    case 'ExitPlanMode': {
      return phrase('退出计划模式')
    }

    case 'generate_image': {
      const prompt = input.prompt
      if (typeof prompt === 'string') return phrase(`生成图片 ${truncate(prompt, 60)}`)
      return phrase('生成图片')
    }

    case 'TaskOutput': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return phrase(`获取任务 #${taskId} 输出`)
      return phrase('获取任务输出')
    }

    case 'TaskStop': {
      const taskId = input.task_id ?? input.taskId
      if (typeof taskId === 'string') return phrase(`停止任务 #${taskId}`)
      return phrase('停止任务')
    }

    case 'AskUserQuestion': {
      const questions = input.questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0] as Record<string, unknown>
        if (typeof first.question === 'string') {
          return phrase(`询问 ${truncate(first.question, 60)}`)
        }
      }
      return phrase('等待用户输入')
    }

    case 'REPL': {
      const description = input.description
      const code = input.code
      if (typeof description === 'string' && description.trim()) return phrase(`执行 REPL ${truncate(description, 50)}`)
      if (typeof code === 'string') return phrase(`执行 REPL ${truncate(code, 50)}`)
      return phrase('执行 REPL')
    }

    case 'Workflow': {
      const name = input.name
      const scriptPath = input.scriptPath
      if (typeof name === 'string') return phrase(`运行工作流 ${name}`)
      if (typeof scriptPath === 'string') return phrase(`运行工作流 ${filename(scriptPath)}`)
      return phrase('运行工作流')
    }

    case 'ScheduleWakeup': {
      const delaySeconds = input.delaySeconds
      const reason = input.reason
      if (typeof delaySeconds === 'number' && typeof reason === 'string') {
        return phrase(`安排 ${delaySeconds}s 后唤醒 · ${truncate(reason, 40)}`)
      }
      if (typeof delaySeconds === 'number') return phrase(`安排 ${delaySeconds}s 后唤醒`)
      return phrase('安排唤醒')
    }

    case 'Monitor': {
      const description = input.description
      if (typeof description === 'string') return phrase(`监控 ${truncate(description, 50)}`)
      return phrase('监控任务')
    }

    case 'PushNotification': {
      const message = input.message
      if (typeof message === 'string') return phrase(`发送通知 ${truncate(message, 50)}`)
      return phrase('发送通知')
    }

    case 'CronCreate': {
      const cron = input.cron
      const prompt = input.prompt
      if (typeof cron === 'string' && typeof prompt === 'string') {
        return phrase(`创建定时任务 ${cron} · ${truncate(prompt, 40)}`)
      }
      if (typeof cron === 'string') return phrase(`创建定时任务 ${cron}`)
      return phrase('创建定时任务')
    }

    case 'CronDelete': {
      const id = input.id
      if (typeof id === 'string') return phrase(`删除定时任务 ${id}`)
      return phrase('删除定时任务')
    }

    case 'CronList': {
      return phrase('列出定时任务')
    }

    case 'RemoteTrigger': {
      const action = input.action
      const triggerId = input.trigger_id
      const actionMap: Record<string, string> = {
        list: '列出',
        get: '获取',
        create: '创建',
        update: '更新',
        run: '运行',
      }
      const actionLabel = typeof action === 'string' ? (actionMap[action] ?? action) : undefined
      if (actionLabel && typeof triggerId === 'string') {
        return phrase(`${actionLabel}远程触发器 ${triggerId}`)
      }
      if (actionLabel) return phrase(`${actionLabel}远程触发器`)
      return phrase('远程触发器')
    }

    case 'EnterWorktree': {
      const name = input.name
      if (typeof name === 'string') return phrase(`进入 Worktree ${name}`)
      return phrase('进入 Worktree')
    }

    case 'ExitWorktree': {
      const action = input.action
      if (action === 'remove') return phrase('退出并删除 Worktree')
      if (action === 'keep') return phrase('退出 Worktree')
      return phrase('退出 Worktree')
    }

    case 'ReadMcpResourceTool': {
      const server = input.server
      const uri = input.uri
      if (typeof server === 'string' && typeof uri === 'string') {
        return phrase(`读取 MCP 资源 ${server} / ${truncate(uri, 40)}`)
      }
      if (typeof uri === 'string') return phrase(`读取 MCP 资源 ${truncate(uri, 60)}`)
      return phrase('读取 MCP 资源')
    }

    case 'ListMcpResourcesTool': {
      const server = input.server
      if (typeof server === 'string') return phrase(`列出 ${server} 的 MCP 资源`)
      return phrase('列出 MCP 资源')
    }

    case 'SendMessage': {
      const to = input.to
      if (typeof to === 'string') return phrase(`发送消息给 ${to}`)
      return phrase('发送消息')
    }

    default: {
      // MCP 工具：mcp__serverName__toolName
      const mcpParts = toolName.split('__')
      if (mcpParts[0] === 'mcp' && mcpParts.length >= 3 && mcpParts[1]) {
        const server = mcpParts[1].toUpperCase()
        const tool = mcpParts.slice(2).join('_')
        // 尝试从 input 中提取第一个有意义的参数作为摘要
        const summary = extractFirstMeaningfulValue(input)
        if (summary) {
          return phrase(`${server} / ${tool} ${truncate(summary, 60)}`)
        }
        return phrase(`${server} / ${tool}`)
      }
      // 未知工具
      const summary = extractFirstMeaningfulValue(input)
      if (summary) {
        return phrase(`${toolName} ${truncate(summary, 60)}`)
      }
      return phrase(toolName)
    }
  }
}

/** 构造短语对 */
function phrase(label: string): ToolPhrase {
  return {
    label,
    loadingLabel: `正在${label}...`,
  }
}

/**
 * 从工具结果提取一条不会挤占主描述的短摘要。
 * 完整结果仍由 ToolResultRenderer 展示，主行只保留用户需要快速扫读的事实。
 */
export function getToolResultSummary(toolName: string, result: string | undefined, isError = false): string | null {
  if (isError) return '失败'
  if (!result?.trim()) return null

  if (toolName === 'computer') {
    if (isError) return '失败'
    if (result) {
      try {
        const parsed = JSON.parse(result)
        if (parsed.interrupted) return `已中断${parsed.reason ? ` · ${truncate(parsed.reason, 20)}` : ''}`
        if (parsed.observationStability === 'timeout') return '已投递，界面待稳定'
        if (typeof parsed.message === 'string' && parsed.message.includes('已投递')) return '已投递，待验证'
        if (typeof parsed.observationId === 'string') return '已返回新观察'
      } catch {
        if (result.includes('已中断') || result.includes('interrupted')) return '已中断'
      }
    }
    return '已返回结果'
  }
  if (toolName === 'Read') {
    const totalLineMatch = result.match(/total\s+(\d+)\s+lines?/i) ?? result.match(/\bof\s+(\d+)\b/i)
    if (totalLineMatch?.[1]) return `${totalLineMatch[1]} 行`

    const remainingLineCount = result.match(/\[(\d+)\s+more\s+lines?\s+in\s+file/i)?.[1]
    if (remainingLineCount) return `还有 ${remainingLineCount} 行`
  }
  if (toolName === 'Grep' && /(?:no matches|没有匹配|未找到)/i.test(result)) return '无匹配'
  if (toolName === 'memory_write' || toolName === 'memory_append' || toolName === 'memory_str_replace') return '已更新'
  if (toolName === 'memory_read' || toolName === 'memory_list') return '已读取'
  if (toolName === 'Edit' || toolName === 'Write') return '已更新'
  if (toolName === 'Glob') return '已完成'

  return null
}

/** 从 input 中提取第一个有意义的字符串值作为摘要 */
function extractFirstMeaningfulValue(input: Record<string, unknown>): string | null {
  // 优先检查常见的描述性字段
  const priorityKeys = ['description', 'prompt', 'query', 'command', 'name', 'subject', 'path', 'file_path', 'url']
  for (const key of priorityKeys) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  // 回退到第一个非下划线开头的字符串值
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('_') && typeof value === 'string' && value.length > 0 && value.length < 200) {
      return value
    }
  }
  return null
}
