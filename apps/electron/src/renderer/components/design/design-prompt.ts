import { DESIGN_SKILL_SLUG, DESIGN_SOURCE_URL } from '@gamma/shared'

export interface DesignBrief {
  title: string
  request: string
  kind: 'interface' | 'prototype' | 'wireframe'
}

export const DESIGN_KINDS: ReadonlyArray<{ id: DesignBrief['kind']; label: string; description: string }> = [
  { id: 'interface', label: '界面设计', description: '网站、应用与多画板设计' },
  { id: 'prototype', label: '交互原型', description: '可操作的页面与关键流程' },
  { id: 'wireframe', label: '线框图', description: '信息架构与页面布局' },
]

/** 安装路径仅来自主进程，需求作为结构化数据传递，不拼接 shell 命令。 */
export function buildDesignPrompt(brief: DesignBrief, skillPath: string): string {
  if (!brief.title.trim() || !brief.request.trim()) throw new Error('请填写设计名称和需求')
  if (!skillPath.trim()) throw new Error('请先安装并启用 design Skill')
  const kind = DESIGN_KINDS.find((item) => item.id === brief.kind)
  if (!kind) throw new Error('不支持的设计类型')
  return [
    `使用 baoyu-design 的 ${DESIGN_SKILL_SLUG} 完成下面的设计。来源：${DESIGN_SOURCE_URL}。`,
    `先读取本机 Skill：${JSON.stringify(`${skillPath}/SKILL.md`)}，以及本次任务必需的格式参考。遵守 Gamma 的工具权限和项目边界。`,
    `设计简报（JSON 数据）：\n${JSON.stringify({ title: brief.title.trim(), type: kind.label, request: brief.request.trim() }, null, 2)}`,
    '在当前已授权项目内创建独立 designs/<slug>/ 目录，使用 project/canvas.json 和 .dc.html 画板格式，不覆盖已有设计。不修改应用代码，除非我明确要求。',
    '使用 Skill 自带的本地 artifact.mjs 创建/检查并打开画布。服务只监听 127.0.0.1，不启用 --lan、share 或公网发布；不自动提交、推送或调用付费服务。',
    '编辑器启动后，用 Gamma 受管浏览器打开返回的本地 URL，让我在右侧画布查看和编辑。缺少运行环境时明确说明，不要声称生成或预览成功。',
  ].join('\n\n')
}

export function appendDesignDraft(previous: string, prompt: string): string {
  return previous.trim() ? `${previous.trimEnd()}\n\n${prompt}` : prompt
}
