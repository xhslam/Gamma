# 引用其他对话作为上下文

## 数据与存储
- `AgentSessionMeta.contextRefs?: AgentContextRef[]` 持久在会话索引；旧会话缺字段视为空，无需迁移。
- 引用字段为 `refId, sourceConversationId, sourceProjectId, titleAtAttach, mode, snapshotUpToMessageId?, snapshotAt?, messageCount?, estTokens?`。
- 默认 snapshot；Main 校验源存在、禁止自引、去重并限制最多 5 个。ID、标题、项目及截止点由 Main 权威生成，忽略 renderer 伪造字段。
- 附加时将规范化内容原子冻结到 `~/.gamma/conversation-ref-cache/snapshots/<refId>.json`（开发模式使用 `.gamma-dev`）。再次附加或切换模式生成新 ID；同模式旧引用保持原快照。
- live 每次请求读取最新完整消息；切回 snapshot 在切换时重新冻结。末尾未完成/取消的 assistant 不纳入，保留已完成工具链。
- 快照读取校验身份、归属、截止点和内容 hash。缓存缺失、损坏、源已删除或项目归属不符时拒绝内容，绝不以源当前内容重建；预算允许时注入明确不可用原因，而非假装资料可用。
- 源消息只读，不递归展开其引用；仅列出源会话曾引用的标题。缓存独立于全局/工作区记忆。

## IPC、冻结发送与失败处理
- Shared、Main、完整 preload、renderer 对应契约：
  - `getContextRefs({ sessionId }) -> { refs, summaryStatuses?, summaryProgresses? }`
  - `updateContextRefs({ sessionId, refs }) -> { refs }`
  - `getContextRefDetail({ sourceSessionId, currentSessionId? }) -> { detail }`
- 通用元数据更新入口不能写 contextRefs。删除的旧引用允许保留或移除，不能新增不存在的源。
- Renderer 串行持久化，序号阻止迟到响应覆盖新状态；成功回填 Main 结果，失败回滚，保存 pending 时禁发。
- 用户消息的 `SDKUserMessage.contextRefs` 记录 Main 接管稳定消息 ID 时冻结的引用列表。排队、失败恢复和重试保留该快照；当前 composer 的 B 或显式空引用不得覆盖已保存的 A。历史卡片不随当前 chips 增删变化，renderer 提交的快照不能绕过 Main 授权。
- 无引用时跳过引用读取与缓存。引用读取/冻结操作发生普通异常时显式置空 contextRefIds/contextRefs，保留正文及其他发送参数并继续；不吞 outbox 等非引用业务错误。
- Main 的 `REFERENCE_WARNING` 经 preload 的 `onAgentReferenceWarning` 到真实全局 renderer 监听器，显示静态 toast“引用准备失败，已转为无引用继续发送”。日志不含原错误正文；通知回调失败也不能阻断发送。

## 请求构建与安全
- Pi 的 `session.agent.transformContext` 每次 provider 请求前重建引用块，前置到最后一条 user 消息的副本；不写 Pi 历史，不依赖可压缩旧消息。
- 规范化保留 user/assistant 文本、工具名/关键参数/短结果与附件名/类型，移除 thinking 和 base64 数据。
- 以 referenced_conversations/conversation 标签包裹，对正文、标题、工具及附件资料转义边界标签。固定说明将历史视为资料而非指令，当前用户消息优先，引用注明来源，缺失事实不编造；不覆盖真正系统指令。
- `buildReferencedContext` 为纯函数。默认中文约 1.3 token/字、其他约 4 字符/token；预算为模型窗口的 35%，A 档另受 80,000 tokens 绝对上限约束。公平分配、回收短引用闲置额度；裁剪保留头部和近期尾部并标注省略。可信说明、标题、嵌套标题、工具、附件及包裹均计预算，极小预算允许省略引用，不能裁坏边界。
- 窗口复用实际 Pi 注册策略：Codex 对齐规则优先，其余采用有效 catalog 窗口；未知或非法窗口保守回退 128,000。后台与发送共用同一只读数据解析与正式构建器选档，不使用独立长度启发式。
- 正文、工具名/参数/结果、附件名、标题和摘要统一先脱敏后截断。支持 PEM、AWS、sk、Google AIza、Slack、GitHub classic/fine-grained、JWT、Bearer、URL userinfo 与敏感赋值，覆盖转义、多行、数字凭据、短 JWT payload/Authorization 令牌及密码中的 @。
- 脱敏属于模式防护，不保证识别任意秘密。比较表达式、按键/计数常量及普通 URL 有反例测试；源 JSONL 原字节不改写。日志不写引用正文或 provider 错误正文。

## A/B 分档、后台摘要与检索
- 完整需求在有效预算内为 A 全文，只有超预算才为 B 摘要与检索；数量不触发降档，4/5 个小对话仍可为 A。未采用 C 隐藏历史消息。
- 只有实际需要 B 时启动后台生成。A 即使命中旧 fallback 缓存也不调用模型。B→A、移除、路由或内容变化取消旧任务并隔离迟到结果。
- 发送路径只读缓存，不等待或启动摘要；未就绪立即使用受预算摘录。
- 摘要包含目标、结论、决定、待办及文件/命令/数据。v2 缓存每 10 条规范化消息一块，各块摘要后再合并。整体 hash 包含 schema、分块策略与有序块 hash，校验源 ID/边界/hash/版本；未变化块可复用，不能跨源接受缓存。
- 每次模型请求输入上限 16,000 字符，单块/合并超限会裁剪，不宣称逐字全量。全局最多并发 2 个摘要任务，单引用最多 64 块，超过块数直接 fallback。总流程 30 秒超时或取消/失败回退头尾摘录，带明确失败回退前缀，不标成完整模型摘要。
- `summaryProgresses` 提供真实 `{ completed, total }`，chip 显示摘要中 x/y；状态区分 ready/running/fallback，不使用虚假计时百分比。
- Pi 工具为 `list_referenced_conversations()`、`read_referenced_conversation({id,offset,limit})`、`search_referenced_conversation({id,query})`。id 只接受当前引用 refId 白名单；每次核验源存在及项目归属，移除立即撤权。分页最多 50 条、检索最多 10 处、输出有上限。

## UI 与验证边界
- `+` 或选择菜单进入项目筛选、会话搜索多选；保留既有 @文件 与 &会话。列表支持加载、详情失败重试、空状态与键盘上下/Enter/Esc；空输入 Backspace 删除末 chip。
- chips 显示当前源标题、token、模式与摘要状态，源删除后灰态；超预算提示不阻止发送。跨渠道明确提示内容将发给当前渠道模型。
- 历史卡片仅显示引用清单，可跳至仍存在的源；保留发送时原标题，不直接在消息流展开原文。
- 自动测试覆盖预算、持久化、冻结/live、删除/越权、深层事实检索、摘要失败/取消/超时、脱敏正误例、长正文性能和模拟压缩后的重注入。
- `reference-production-bridge.browser.test.ts` 使用真实 Main registerIpcHandlers/存储/orchestrator、完整生产 preload、默认 utility Pi 与 AgentView：UI 附加→轮询→发送→清空 composer→真实 renderer reload 后历史卡片仍在，注入块不进入 SDK 历史。HOME/userData/项目/渠道为隔离合成数据，仅模型 HTTP 响应为本地模拟，不替换 electronAPI、handler、SDK 或持久化。
- `AgentSendRecovery.browser.test.ts` 用既有 esbuild 编译真实生产 outbox，不保留复制 parser。feature 与固定 main 隔离副本采用相同 harness 修复后，Main+Recovery 组合均通过；这是 Bun 同进程构建/装载状态交互的规避，不宣称掌握 Bun 内部根因。
- 本地 provider 绿色测试不证明在线模型抗注入语义，未触发真实上下文压缩。renderer reload 不等于 App 安装升级重启；安装/启动结果必须另行记录，不能从组件测试推导。

## 历史区间范围与 preload 澄清
- `78e32850..4d56ed88` 实际为 42 files changed, 2475 insertions(+), 262 deletions(-)；起点仓库 tracked 总数为 1744，不是改动文件数。
- preload/index.ts 与 agent-session-manager.ts 在该历史区间没有物理修改，当时报告提及的是复用链路，不是该区间改动清单。
- 摘要状态一直复用 getContextRefs 与 GET_CONTEXT_REFS，后来增加 summaryProgresses，不新增摘要专用通道。后续故障提示另增 REFERENCE_WARNING 和 preload 监听接口，不能与历史摘要轮询混为一项。
