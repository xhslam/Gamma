# Gamma

<div align="center">

![Gamma Banner](https://img.erlich.fun/personal-blog/proma/image-20260909165815654.png)

### 为专业用户打造的本地优先（Local-First）Electron AI 桌面 Agent

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6.svg)](https://bun.sh)
[![Framework: Electron](https://img.shields.io/badge/Framework-Electron-47848F.svg)](https://www.electronjs.org/)
[![Engine: Pi Agent Runtime](https://img.shields.io/badge/Agent%20Engine-Pi%201.3.0-orange.svg)](https://github.com/xhslam/Gamma)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen.svg)](https://github.com/xhslam/Gamma/releases)

[官方网站](https://proma.cool) • [下载安装](#-下载与安装) • [核心特性](#-核心特性矩阵) • [开发指南](#-本地开发与工程指南) • [商业版本](https://proma.cool/download)

</div>

---

## 📖 简介与核心理念

**Gamma** 是一款面向专业开发者、研究人员及重度知识工作者的高性能本地优先 AI 桌面 Agent 应用。

在当前大语言模型与 Agent 的生态中，**“更智能的前提是组织更好、更纯粹的上下文”**。传统的对话式 AI 工具往往受制于扁平的聊天窗口、不可控的工具调用与混乱的文件状态。Gamma 彻底重构了桌面端 Agent 的交互范式：

- **左侧导航与会话组织**：聚焦任务分类、项目分区、定时自动化调度与全局历史管理；
- **中间 Agent 交互主干**：清晰展示 Agent 思考轨迹、执行步骤、分步推理与人机对齐交互；
- **右侧按需辅助工作台**：文件改动实时 Diff、Git Worktree 协同、可见终端 PTY、内置原生浏览器、Live Markdown / Obsidian 双模编辑、Office/PDF 文档预览与子会话协作。

全链路围绕“为专业用户提供透明、可控、高质量的上下文工程”而构建。

![Gamma UI Overview](https://img.erlich.fun/personal-blog/proma/image-20260908110801716.png)

---

## ✨ 核心特性矩阵

### 1. 纯净 Pi Agent 运行时 (Pi-Only Engine)
- 告别笨重不透明的第三方 Agent SDK，底层采用 `@earendil-works/pi-agent-core` 1.3.0 深度定制的纯 Agent 核心；
- 具备完全可控的生命周期、单步工具审查、流式推理中断以及状态回溯能力；
- 针对 Coding 与复杂任务深度调优，执行效率与内存控制显著提升。

### 2. 原生桌面自动化控制 (Computer Use)
- 深度整合 `agent-desktop` 原生底层引擎与系统无障碍（Accessibility / AX）接口；
- 支持系统级窗口结构解析、毫秒级截图推断、拟真平滑滚动与键鼠精准控制；
- **安全与控制在环**：内置 AX 风险分级授权体系，支持全流程单步确认，并提供全局原生悬浮控制条，用户可随时一键暂停或中断操作。

### 3. 高密度上下文与对话引用系统 (Conversation Reference)
- **极简引用语法**：在输入框内通过 `@` 呼出并引用项目文件，通过 `&` 跨会话或跨时间跨度引用历史会话上下文；
- **自适应 Token 预算调度**：后台智能异步增量分块摘要与缓存调度，根据当前所选模型的上下文窗口动态裁剪，彻底避免上下文爆炸；
- **安全防御**：全字段凭据与敏感密钥（API Key、Token、私钥等）全自动脱敏，杜绝本地信息泄漏。详细设计参见 [会话引用设计文档](./docs/conversation-reference.md)。

### 4. 双层记忆工程体系 (Memory Architecture)
- **项目级显式规则 (`AGENTS.md`)**：每个项目根目录下独立的指令规则，严格限定 Agent 在当前项目的工作边界、代码规范与交付约定；
- **结构化知识库 (`MEMORY.md`)**：自动维护主索引与分类 Markdown 记忆条目，沉淀项目沉思与最佳实践；
- **全局长期记忆**：会话完成后后台自动提取关键结论与个人习惯，支持双视图展示、按层级折叠与模糊全文检索。

![Memory System](https://img.erlich.fun/personal-blog/proma/image-20260908114118777.png)

### 5. 并行探索模式 (Exploration Mode)
- **是探索，而非分叉**：在 Agent 输出结束时，支持随时从当前节点建立无限个并行探索分支，尝试边缘思路或验证替代假设；
- **一键带回主会话**：完成分支推演后，点击“带回主会话”，探索成果将提炼整合回主干上下文，确保主线决策链始终纯净高质量。

![Exploration Mode](https://img.erlich.fun/personal-blog/proma/image-20260908112614345.png)

### 6. 主会话与子会话协同 (Sub-Sessions & Main Session)
- 告别黑盒 SubAgent：Gamma 提供可视化的主子会话协同面板；
- 子会话拥有干净独立的上下文与专属模型配置，适用于并行深度调研、对抗性代码审核、方案横向对比等场景。

![Sub-Sessions](https://img.erlich.fun/personal-blog/proma/image-20260908112300711.png)

### 7. 透明文件变更与 Git Worktree 深度整合
- **逐轮文件变更 (Artifacts)**：按轮次清晰呈现文件修改记录，内置 `@pierre/diffs` 语法高亮差异比对；
- **Git Worktree 敏捷开发**：Agent 主动感知当前项目的 Git 分支与 worktree，可根据任务自动切换，并提供一键唤起专属分支终端的快捷入口。

![File Diff View](https://img.erlich.fun/personal-blog/proma/image-20260908113333692.png)

### 8. 内嵌可见终端与内置原生浏览器
- **可见交互终端**：基于 `node-pty` 与 `@xterm/xterm`，Agent 执行 Shell 命令全流程可见，用户可随时输入接管，深度支持项目级 AGY 终端管理；
- **内嵌原生浏览器**：基于独立 Chromium 环境，Agent 可自主导航网页、分析 DOM、捕获截图与运行自动化流程，轻松应对网页爬虫、群聊回复与网页端控制等任务。

![In-App Browser](https://img.erlich.fun/personal-blog/proma/image-20260908113724838.png)

### 9. 多格式文档实时预览与 Live Markdown 编辑器
- **Live Markdown 编辑器**：结合 CodeMirror 与 TipTap，支持公式（LaTeX / KaTeX）、Mermaid 流程图、任务清单，提供媲美 Typora 与 Obsidian 的即时编辑体验；
- **Obsidian 深度契合**：无缝映射本地 Obsidian 知识库目录，实现研究记录与 Agent 协作闭环；
- **办公多模态文档解析**：内置 PDF、Word (`.docx`)、Excel (`.xlsx`)、PowerPoint (`.pptx`) 快速解析与高清预览，支持对文档内容选区划线后直接向 Agent 发起针对性提问。

![Obsidian Live Markdown](https://img.erlich.fun/personal-blog/proma/image-20260908111956671.png)
![Document Preview](https://img.erlich.fun/personal-blog/proma/image-20260908114657248.png)

### 10. 全渠道外部机器人与跨端桥接
- 支持飞书 (Lark/Feishu) 机器人私聊与群聊互动；
- 支持钉钉 (DingTalk) Stream 模式长连接网关；
- 支持企业微信 / 微信服务集成；
- 支持 Slack 机器人远程协作与通知回传。详细配置参见 [Slack 桥接说明](./docs/slack-bridge.md)。

### 11. 主动自动化调度与日程 Todo
- **灵活复合定时调度**：支持单次定时、间隔周期与复杂复合 Cron 规则（例如：工作日上午 10:00 - 12:00 每 20 分钟执行一次），Agent 自主巡检、分析并汇报；
- **内嵌 Todo 与日程**：任务未完时随手记入 Todo 或与 macOS 日历/提醒事项双向同步，配合内置语音输入（Voice Dictation）高效采集想法。

![Scheduler View](https://img.erlich.fun/personal-blog/proma/image-20260908112055273.png)
![Todo and Calendar](https://img.erlich.fun/personal-blog/proma/image-20260908111504034.png)

### 12. 丰富的 Skills、MCP 与 CLI 生态
- **项目隔离的 Skills**：内置开箱即用的办公解析、文档生成、代码重构、计划拆解等默认 Skills，支持根据个人业务工作流自主沉淀；
- **MCP 协议支持**：全面兼容 Model Context Protocol (MCP) 标准，可自由挂载本地与远程 MCP 工具服务器；
- **CLI 原生调用**：自动探测并适配系统及工作区内已安装的命令行工具。

![Skills & MCP](https://img.erlich.fun/personal-blog/proma/image-20260908113623429.png)

### 13. 本地优先 (Local-First) 与隐私安全
- **零本地数据库依赖**：拒绝庞大易碎的本地 SQL 数据库，所有配置、历史与记忆均采用高可移植、易备份的纯 JSON / JSONL 文件持久化；
- **安全原子写入**：所有文件落盘均由 `safe-file.ts` 提供原子写入保证，防止断电或崩溃造成的数据损坏；
- **系统底层加密**：API Key 等敏感数据均由操作系统原生安全钥匙串（Electron `safeStorage`）加密存储；
- 配置文件统一保存在用户主目录下的 `~/.gamma/` 中。

---

## 🌐 广泛的模型渠道支持 (AI Providers)

Gamma 提供极度灵活的模型接入通道，满足开发者不同的网络条件与账单需求：

| 渠道类型 | 支持的供应商 / 协议 |
| --- | --- |
| **主流官方 API** | Anthropic (Claude 3.5 / 3.7)、OpenAI (GPT-4o / o1 / o3-mini)、Google (Gemini 2.5 Flash / Pro)、DeepSeek (V3 / R1) |
| **国产大模型 API** | 月之暗面 Kimi (Moonshot API)、智谱 AI (GLM-4)、MiniMax、火山引擎 (字节豆包 Doubao API)、阿里通义千问 (Qwen API)、小米 MiMo |
| **专属编程套餐** | Kimi Coding Plan、智谱 Coding Plan（含团队版）、通义千问 Token Plan、小米 MiMo Token Plan |
| **OAuth 订阅直连** | ChatGPT 订阅 (Codex OAuth 登录直连)、GitHub Copilot 订阅直连、xAI (Grok 订阅) |
| **自定义网关** | 任意兼容 OpenAI 或 Anthropic 协议的标准中转反代网关与本地自建大模型 (Ollama / vLLM) |

---

## 📦 下载与安装

### 📥 开源社区版下载

请前往 [GitHub Releases](https://github.com/xhslam/Gamma/releases) 下载适合您操作系统的最新安装包：

| 操作系统 | 安装包格式 | 说明 |
| --- | --- | --- |
| **macOS (Apple Silicon)** | `.dmg` / `.zip` | 适配 M1 / M2 / M3 / M4 系列芯片，自带临时签名与公证校验 |
| **macOS (Intel)** | `.dmg` / `.zip` | 适配 x86_64 架构 Mac 机型 |
| **Windows** | `.exe` | Windows 10 / 11 64 位安装程序 |
| **Linux (Ubuntu / Debian)** | `.deb` | 目标支持 Ubuntu 22.04+ x86_64，原生集成 Chromium SUID sandbox |
| **Linux (通用)** | `.AppImage` | 适用于绝大多数现代 Linux 桌面发行版，便携免安装运行 |

> Linux 用户的系统依赖、环境隔离与更新策略详见 [Linux 说明文档](./docs/linux.md)。

---

### 🔄 从 Proma 升级到 Gamma

如果您的设备此前安装过 Proma：
1. 首次启动 Gamma 前请**完整退出旧版 Proma**（确保后台进程已彻底结束）；
2. Gamma 启动时会自动检测并平滑复制 `~/.proma/` 到 `~/.gamma/`，迁移旧版浏览器登录状态、受管会话与加密钥匙串凭据，原目录完好保留；
3. 开发版本分别使用 `~/.proma-dev` 与 `~/.gamma-dev` 保持隔离；
4. 若检测到数据冲突或权限缺失，应用会在提示后安全暂停，绝不会静默覆盖或清空用户已有数据。

---

### ⚖️ 开源社区版 vs 商业版

欢迎访问 [https://proma.cool/download](https://proma.cool/download) 了解并下载商业版：

| 对比维度 | 开源社区版 | 商业版 (Gamma Pro / Enterprise) |
| --- | --- | --- |
| **更新与修复** | 社区版本演进，常规版本发布 | 快速迭代更新节奏，第一时间获取前沿功能优化与安全修复 |
| **核心桌面能力** | 完整的 Gamma 桌面体验，自由配置工作流与本地环境 | 保留相同的核心桌面体验 |
| **模型渠道接入** | 自由配置自持 API Key、第三方兼容中转网关与订阅直连 | 支持登录即用的 Gamma Cloud 官方精选模型专线，同时可自由配置第三方渠道 |
| **模型使用成本** | 按照所选供应商的公开官方价格结算 | 精选热门前沿模型提供 Gamma Cloud 专属折扣，部分模型可低至官方参考价 1 折 |
| **网络与稳定性** | 自行评估供应商或中转网关的可用性与网络延迟 | Gamma Cloud 官方托管链路提供高可用保障、协议兼容适配与模型健康监控 |
| **联网与多模态** | 按需自行配置搜索引擎 API 与绘图工具 | 官方内置集成联网搜索（WebSearch）与 GPT Image 2 高精度生图与局部重绘 |
| **对外 API 开放** | 使用个人配置的独立供应商端点 | 支持生成独立带限额的 Gamma Cloud API Key，供外部工具与服务调用 |
| **企业 Skills 协作** | 本地手工组织与维护工作区 Skills | **企业版专属**：支持组织级 Skills 一键全员分发与团队云端共享，成员免安装即用 |
| **迁移与兼容** | — | 开源版用户可直接下载商业版安装包**覆盖安装**，本地数据全量自动继承 |

---

## 💻 本地开发与工程指南

Gamma 仓库为基于 **Bun** 构建的 Monorepo 工程结构：

```text
Gamma/
├── apps/
│   └── electron/                 # Electron 桌面主应用 (Main, Preload, Renderer, Utility)
│       ├── default-skills/       # 随应用分发的内置默认 Skills
│       ├── src/main/             # 主进程服务层、Agent 编排、安全持久化
│       ├── src/preload/          # 类型安全的四层 IPC Bridge
│       ├── src/renderer/         # React + Vite + Tailwind CSS 前端渲染层
│       └── src/utility/          # 独立 Agent 运行时与 Terminal PTY 辅助进程
├── packages/
│   ├── core/                     # AI Provider 适配器、SSE 流解析、思考能力模型层
│   ├── session-core/             # 无头会话核心库，负责跨会话存储与搜索
│   ├── shared/                   # 全局共享类型定义、IPC 通道常量与通用工具
│   └── ui/                       # 跨应用共享 UI 组件库
├── docs/                         # 架构设计、安全说明与规范文档
└── release-notes/                # 版本发布更新日志
```

### 1. 环境准备
- **Bun**：1.2+ 或 1.3+（项目**严禁使用** npm / pnpm / yarn）；
- **Node.js**：20.x 或 22.x（用于部分原生构建兼容）；
- **Rust 工具链**：1.89.0（用于 `agent-desktop` 本地原生控制辅助模块构建）。

### 2. 常用开发命令

```bash
# 1. 安装项目依赖（必须使用 Bun）
bun install --frozen-lockfile

# 2. 启动桌面应用开发环境（热重载）
bun run dev

# 3. 运行静态类型检查
bun run typecheck

# 4. 执行单元测试与 BDD 回归测试
bun test

# 5. 构建全部 monorepo 产物
bun run build

# 6. 单独构建 Electron 应用
bun run electron:build
```

### 3. 多平台打包构建命令（在 `apps/electron` 或根目录下运行）

```bash
# 构建 macOS 安装包（当前系统架构）
bun run dist:mac

# 构建 Windows 安装包
bun run dist:win

# 构建 Linux 安装包（deb / AppImage）
bun run dist:linux

# 本机快速冒烟打包（跳过冗余压缩）
bun run dist:fast
```

### 4. 必须遵守的工程守则

根据项目规范 [AGENTS.md](./AGENTS.md)，参与开发时请严格遵守以下规则：
- **包管理器**：所有命令与脚本必须使用 `bun` 运行；
- **数据持久化**：坚持本地优先，绝不引入本地数据库。修改配置或会话元数据时统一使用 `safe-file.ts` 进行原子安全写入；
- **状态管理**：前端统一使用 **Jotai** 进行原子状态管理，保持组件高内聚与最小抽象；
- **类型安全**：TypeScript 严禁使用 `any`；类型声明优先使用 `interface`，类型导入使用 `import type`；
- **IPC 四层契约**：新增或修改 IPC 通信时，必须同步核验以下四层：
  1. `packages/shared`：通道常量与请求/响应类型声明；
  2. `apps/electron/src/main/ipc.ts`：主进程 handler 实现；
  3. `apps/electron/src/preload/index.ts`：Preload 类型安全 Bridge；
  4. `apps/electron/src/renderer`：调用逻辑、错误捕获与 UI 状态更新。
- **Agent 纯粹性**：仅使用 Pi Agent runtime，禁止引入任何第三方已废弃的 SDK 依赖；
- **版本号维护**：任何涉及功能、UI、默认 Skills 或配置的提交，必须将受影响交付物的 patch 版本 +1。

---

## 🤝 参与贡献

我们非常欢迎社区开发者的贡献！你可以通过以下方式参与：
- 提交 Bug 反馈与体验建议（请在 Issue 中提供详细的环境信息与复现步骤）；
- 提交代码改进、测试用例或针对特定平台（macOS / Windows / Linux）的兼容性修复；
- 贡献面向真实业务场景的实用 Skills 模板、MCP 服务集成与 Agent 协同工作流。

提交 Pull Request 之前，请务必在本地确认：
1. `bun run typecheck` 无类型错误；
2. 运行 `bun test` 确保所有既有与新增测试用例通过；
3. 检查 `git diff`，确保未包含无关的临时文件或意外覆盖。

---

## 📊 Star History

[![Star History Chart](https://api.star-history.com/chart?repos=xhslam/Gamma&type=Date)](https://star-history.com/#xhslam/Gamma&Date)

---

## 👤 作者与支持

- **作者**：Erlich Liu
- **个人网站**：[erlich.fun](https://erlich.fun)
- **商业版体验与下载**：[proma.cool/download](https://proma.cool/download)

---

## 📄 开源许可证

Gamma 社区版采用 **[GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE)** 协议开源。

- **个人与非商业使用**：您可以自由使用、修改和分发本项目源码，唯须遵守 AGPL-3.0 协议条款；
- **商业使用规范**：在遵守 AGPL-3.0 协议（包括以源代码形式分发、通过网络对外提供服务时公开完整修改源码及交互层）的前提下允许商业使用；
- **商业授权（豁免 AGPL-3.0）**：如果您希望将 Gamma 深度集成到闭源商业产品、提供私有 SaaS 服务而无需公开衍生代码，请联系项目维护者获取商业许可：[erlichliu@gmail.com](mailto:erlichliu@gmail.com)。

向本项目提交 Pull Request 即视为同意将所贡献代码以 AGPL-3.0 及未来商业许可授权给项目维护者。
