# Gamma 外观设计选项改造 — 完整复刻 ASCII 壁纸主题系统

> 参考素材：`/Users/apple/Desktop/gamma-video-frames`（来自 [x.com/handsher_NGU/status/2115618341675319417](https://x.com/handsher_NGU/status/2115618341675319417)）

## 1. 概述

将 Gamma 的外观系统从当前 7 款静态配色方案（ocean-light/dark、forest-light/dark、slate-light/dark、terminal-dark）升级为 8 款 ASCII 字符艺术动态壁纸主题，同时新增聊天区底部浮动 `/theme` 选择 Dock 与圆形揭幕（Circle Reveal）切换过渡动画。

### 1.1 交付范围

| 模块 | 描述 |
|------|------|
| **主题数据模型** | 8 款主题 ID 枚举、向后兼容映射、类型定义 |
| **程序化 ASCII 壁纸引擎** | 轻量 Canvas 渲染器，8 款场景各自独立的数学驱动动画 |
| **浮动 /theme Dock** | 输入框上方唤起的快速主题选择浮层 |
| **圆形揭幕过渡动画** | 从点击坐标向外扩散的 clip-path 圆形遮罩切换动效 |
| **设置中心外观页** | AppearanceSettings 卡片网格更新为 8 款主题 |
| **全局主题色适配** | 各主题对应的调色板令牌与对比度自适应 |

### 1.2 不做什么

- 不引入本地数据库，持久化仍使用 `safe-file.ts` 原子写 JSON。
- 不引入外部动画库（GSAP、Lottie 等），纯 Canvas 2D + CSS clip-path。
- 不更改 Gamma 的 Agent 运行时、IPC 协议或会话数据结构。

---

## 2. 数据模型与类型

### 2.1 主题 ID 枚举

**文件**：`apps/electron/src/types/settings.ts`

```typescript
export const THEME_STYLES = [
  'default',
  'claude-code',
  'cloud-drift',
  'honu-lagoon',
  'koi-pond',
  'jellyfish',
  'paper-boats',
  'fireflies',
  'moonlit',
] as const

export type ThemeStyle = (typeof THEME_STYLES)[number]
```

### 2.2 向后兼容映射

在 `settings-service.ts` 加载配置时，将旧 ID 安全映射到新 ID：

| 旧 ID | 新 ID |
|-------|-------|
| `ocean-light` | `cloud-drift` |
| `ocean-dark` | `honu-lagoon` |
| `forest-light` | `cloud-drift` |
| `forest-dark` | `fireflies` |
| `slate-light` | `cloud-drift` |
| `slate-dark` | `moonlit` |
| `terminal-dark` | `claude-code` |

映射在 `getSettings()` 返回前一次性执行，旧值不再写回。

### 2.3 主题元数据注册表

新增 `apps/electron/src/renderer/lib/ascii-theme-registry.ts`：

```typescript
export interface AsciiThemeDefinition {
  id: ThemeStyle
  name: string                // 用户可见名（中文）
  mode: 'light' | 'dark'     // 基调
  backgroundColor: string    // 十六进制底色
  foregroundColor: string     // 字符前景色
  accentColor: string         // 强调色
  glyphs: string              // 该场景核心字符集
}
```

每款主题在此注册表中声明完整元数据，供壁纸引擎、设置页、Dock 统一消费。

---

## 3. Jotai 状态管理

### 3.1 现有 atom 调整

- `themeModeAtom`：不变，类型保持 `'light' | 'dark' | 'system' | 'special'`。
- `themeStyleAtom`：类型扩展为新 `ThemeStyle`，默认值保持 `'default'`。

### 3.2 新增 atom

**文件**：`apps/electron/src/renderer/atoms/theme-picker.ts`

```typescript
/** /theme Dock 的打开状态 */
export const themePickerOpenAtom = atom<boolean>(false)

/** 当前预览中的主题（Dock 中键盘导航时用于即时预览，尚未确认） */
export const themePreviewAtom = atom<ThemeStyle | null>(null)

/** 圆形揭幕过渡状态 */
export interface CircleRevealState {
  active: boolean
  originX: number
  originY: number
  fromTheme: ThemeStyle
  toTheme: ThemeStyle
}
export const circleRevealAtom = atom<CircleRevealState | null>(null)
```

---

## 4. 程序化 ASCII 壁纸引擎

### 4.1 组件架构

**替换关系**：`AsciiWallpaperCanvas` 取代 `CodeFieldBackground`，后者保留为 `claude-code` 主题的内部实现或直接合并。

```
apps/electron/src/renderer/components/ascii-wallpaper/
├── AsciiWallpaperCanvas.tsx       # 主入口组件，根据 themeStyleAtom 分发
├── ascii-wallpaper.css            # 壁纸层 CSS 变量与布局
├── engines/                       # 8 款场景渲染引擎
│   ├── claude-code.ts             # 原 CodeFieldBackground 逻辑迁移
│   ├── cloud-drift.ts
│   ├── honu-lagoon.ts
│   ├── koi-pond.ts
│   ├── jellyfish.ts
│   ├── paper-boats.ts
│   ├── fireflies.ts
│   └── moonlit.ts
└── engine-types.ts                # 引擎公共接口
```

### 4.2 引擎公共接口

```typescript
export interface AsciiWallpaperEngine {
  /** 初始化，接收 Canvas 上下文与尺寸 */
  init(ctx: CanvasRenderingContext2D, width: number, height: number): void
  /** 每帧绘制，now 为 performance.now() 时间戳 */
  paint(now: number): void
  /** 窗口尺寸变化时重新布局 */
  resize(width: number, height: number): void
  /** 销毁，清理任何内部状态 */
  dispose(): void
}
```

### 4.3 8 款场景算法概要

| 主题 | 模式 | 底色 | 核心字符 | 动效算法 |
|------|------|------|----------|----------|
| Claude Code | Dark | `#1F1E1D` | `+ - / \| * ~` | 极简环境噪声场 + 周期光弧扫掠 |
| Cloud Drift | Light | `#BAEEF5` | `% ; : s t + \|` | 多层正弦/柏林云团横向漂移 |
| Honu Lagoon | Dark | `#1C4E4B` | `~ s S O 0 *` | 底部水草正弦律动 + 绿海龟样条巡游 |
| Koi Pond | Dark | `#254B3E` | `( ) ~ s S o *` | 双锦鲤摆尾游动 + 同心水波扩散 |
| Jellyfish | Dark | `#0B2030` | `( ) ^ \| * : .` | 水母伞盖收缩上浮 + 触手延迟拖曳 |
| Paper Boats | Dark | `#284A4B` | `/ \ _ ^ ~ =` | 水面正弦波动 + 折纸船体俯仰颠簸 |
| Fireflies | Dark | `#091216` | `* + · o O` | 30 个呼吸明灭漂移发光粒子 |
| Moonlit | Dark | `#090C1C` | `* + ~ ( ) .` | 字符明月光晕 + 星点闪烁 + 底部浮云 |

### 4.4 渲染生命周期

1. **mount**：`AsciiWallpaperCanvas` 挂载，根据 `themeStyleAtom` 实例化对应引擎，调用 `init()`。
2. **paint loop**：`requestAnimationFrame` 循环调用 `paint(now)`。
3. **visibility / reduced-motion**：
   - `document.hidden` 或 `IntersectionObserver` 不可见时暂停 rAF。
   - `prefers-reduced-motion: reduce` 时渲染静态代表帧后停止。
4. **resize**：`ResizeObserver` 监听 Canvas 容器，DPR 上限 1.5，调用 `resize()`。
5. **theme change**：旧引擎 `dispose()`，新引擎 `init()` + `paint()`。
6. **unmount**：`dispose()` + 断开所有 Observer。

### 4.5 会话内容可读性保护

- 壁纸层 `z-index: -1`，消息区域采用 `bg-background/85 backdrop-blur-md`。
- 中央阅读带字符密度本身通过数学衰减函数降低，边缘密度高，中央稀疏。
- 确保所有主题下文字与背景对比度满足 WCAG AA（4.5:1）。

---

## 5. 浮动 /theme Dock

### 5.1 组件

**文件**：`apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.tsx`

### 5.2 呼出方式

1. 在聊天输入框中键入 `/theme`（匹配已有 `/` 命令补全机制）。
2. 输入区工具栏按钮（调色板图标）。

### 5.3 视觉规格

- **位置**：输入框正上方悬浮，`bottom: calc(100% + 8px)`，居中对齐。
- **容器**：`bg-popover/95 backdrop-blur-lg rounded-xl border border-border/50 shadow-xl`。
- **顶部栏**：
  - 左侧：`/theme` 亮色徽章 + `ASCII wallpapers` 副标题。
  - 右侧：`↵ apply • esc close` 快捷键提示。
- **选项区**：8 个缩略图卡片 `grid-cols-8`，宽度自适应。
  - 选中态：`ring-2 ring-primary shadow-lg shadow-primary/20`。
  - 悬浮态：`ring-1 ring-border group-hover:ring-border`。
- **尺寸约束**：最大宽度 820px，最小宽度 480px。

### 5.4 键盘交互

| 按键 | 行为 |
|------|------|
| `←` / `→` | 在 8 款主题间移动焦点，即时预览（但不持久化） |
| `Enter` / `~` | 确认应用当前选中主题并关闭 Dock |
| `Escape` | 取消预览、恢复原主题、关闭 Dock |
| `Tab` | 关闭 Dock，焦点回到输入框 |

### 5.5 与设置中心的联动

Dock 选中主题 → 更新 `themeStyleAtom` + `themeModeAtom` → 触发 `updateThemeStyle()` + `updateThemeMode()` 持久化到 `settings.json` → 所有窗口通过 `onThemeSettingsChanged` 同步响应。

---

## 6. 圆形揭幕过渡动画

### 6.1 组件

**文件**：`apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.tsx`

### 6.2 触发条件

在 ThemeFloatingDock 或 AppearanceSettings 中切换主题时触发。

### 6.3 动画流程

1. **原点捕获**：记录点击卡片的中心坐标 `(originX, originY)`。
2. **快照旧画面**：将当前壁纸 Canvas 状态导出为 `ImageBitmap` 或保留旧引擎最后一帧。
3. **启动新引擎**：在上层 Canvas 初始化新主题引擎并开始绘制。
4. **径向扩散**：上层 Canvas 应用 CSS `clip-path: circle(0% at originX originY)` → 通过 `requestAnimationFrame` 在 380ms 内线性插值至 `circle(150% at originX originY)`。
5. **交割**：动画结束后，上层 Canvas 替代底层成为主画布，过渡层销毁。
6. **reduced-motion 适配**：低动效环境下用 150ms 线性 opacity 淡入淡出替代径向扩散。

### 6.4 性能保证

- 过渡期间仅双层 Canvas 同时运行，完成后立即销毁旧层。
- `clip-path: circle()` 由 GPU 合成器执行，不触发重排。

---

## 7. 设置中心外观页

### 7.1 AppearanceSettings 改动

**文件**：`apps/electron/src/renderer/components/settings/AppearanceSettings.tsx`

- `SPECIAL_STYLES` 数组替换为 8 款新主题定义。
- 预览图替换为新截图（从 `ascii-theme-registry.ts` 中的元数据生成或手动截取）。
- 网格布局保持 `grid-cols-4 min-[720px]:grid-cols-8` 以一行展示全部 8 款。
- 点击卡片同时触发圆形揭幕过渡。

### 7.2 预览图资源

- 移除旧预览图（`theme-cloud-dancer.webp` 等 7 张）。
- 新增 8 张主题预览截图到 `apps/electron/src/renderer/assets/theme-previews/`。
- 格式统一为 WebP，尺寸约 300×225（4:3），文件体积 < 50KB/张。

---

## 8. 全局主题色与 CSS 令牌

### 8.1 设计令牌覆写

**文件**：`apps/electron/src/renderer/styles/design-tokens.css`

为每款主题在 `@layer base` 中添加 CSS 变量覆写块（类似现有 `.dark {}` 块）。例如：

```css
.theme-cloud-drift {
  color-scheme: light;
  --background: 195 80% 91%;        /* #BAEEF5 近似 HSL */
  --foreground: 210 8% 15%;
  --panel: 0 0% 100%;
  --primary: 195 72% 45%;
  --border: 210 8% 15% / 0.10;
  /* ... 其余令牌 ... */
}
```

### 8.2 Tailwind safelist

**文件**：`apps/electron/tailwind.config.js`

```javascript
safelist: [
  'theme-claude-code',
  'theme-cloud-drift',
  'theme-honu-lagoon',
  'theme-koi-pond',
  'theme-jellyfish',
  'theme-paper-boats',
  'theme-fireflies',
  'theme-moonlit',
],
```

### 8.3 旧主题 CSS 清理

- `globals.css` 中约 75 处 `theme-terminal-dark` 专属样式与其他旧主题 `::selection`、`.session-item-selected` 等规则需清理或迁移。
- `panels.css`、`inline-code.css` 中各 1 处旧主题引用同步处理。
- `applyThemeToDOM()` 中的 `ALL_THEME_STYLE_CLASSES` 自动从新 `THEME_STYLES` 派生，无需手动维护。

---

## 9. 受影响文件清单

| 文件路径 | 变更类型 |
|----------|----------|
| `apps/electron/src/types/settings.ts` | 修改：THEME_STYLES 枚举 |
| `apps/electron/src/renderer/atoms/theme.ts` | 修改：类型适配 |
| `apps/electron/src/renderer/atoms/theme-picker.ts` | 新增：Dock 与过渡 atom |
| `apps/electron/src/renderer/lib/ascii-theme-registry.ts` | 新增：主题元数据注册 |
| `apps/electron/src/renderer/components/ascii-wallpaper/` | 新增：完整壁纸引擎目录 |
| `apps/electron/src/renderer/components/ascii-wallpaper/AsciiWallpaperCanvas.tsx` | 新增 |
| `apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.tsx` | 新增 |
| `apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.tsx` | 新增 |
| `apps/electron/src/renderer/components/ascii-wallpaper/engines/*.ts` | 新增：8 个引擎 |
| `apps/electron/src/renderer/components/settings/AppearanceSettings.tsx` | 修改 |
| `apps/electron/src/renderer/components/agent/AgentMessages.tsx` | 修改：壁纸挂载 |
| `apps/electron/src/renderer/components/welcome/CodeFieldBackground.tsx` | 修改/保留 |
| `apps/electron/src/renderer/styles/design-tokens.css` | 修改：新增主题色块 |
| `apps/electron/src/renderer/styles/globals.css` | 修改：清理旧主题规则 |
| `apps/electron/src/renderer/styles/panels.css` | 修改 |
| `apps/electron/src/renderer/styles/inline-code.css` | 修改 |
| `apps/electron/tailwind.config.js` | 修改：safelist |
| `apps/electron/src/main/lib/settings-service.ts` | 修改：向后兼容映射 |
| `apps/electron/src/renderer/assets/theme-previews/` | 替换/新增 |
| `apps/electron/package.json` | 修改：版本 +1 |
| `packages/shared/package.json` | 修改：如类型变更则版本 +1 |

---

## 10. 测试计划

### 10.1 单元测试

- **主题枚举与映射**：旧 ID → 新 ID 的全路径覆盖，无效值回退到 `default`。
- **Jotai atom**：`themeStyleAtom` 与 `themeModeAtom` 联动逻辑。
- **引擎接口**：每个引擎的 `init/paint/resize/dispose` 不抛异常。

### 10.2 浏览器集成测试

- **壁纸渲染**：Canvas 正确挂载到会话面板，`prefers-reduced-motion` 时停止动画。
- **Dock 键盘导航**：`←` / `→` / `Enter` / `Esc` 行为验证。
- **圆形揭幕**：过渡层在动画结束后被正确销毁，无 Canvas 泄露。
- **设置持久化**：切换主题 → 重载 → 主题恢复。

### 10.3 回归测试

- 现有 `design-tokens.browser.test.ts` 中 7 款旧主题的变量覆盖测试需迁移到新主题。
- `claude-visual.browser.test.ts` 中遍历旧主题的循环需更新。
- `workbench-density.browser.test.ts` 中引用 `theme-ocean-dark` 的用例需更新。

---

## 11. 版本递增

| 包 | 当前版本 | 目标版本 |
|----|---------|---------|
| `apps/electron` | 0.19.275 | 0.19.276 |
| `packages/shared` | 0.1.124 | 0.1.125（若 ThemeStyle 类型变更） |

---

## 12. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 8 款引擎总代码体积过大 | 包体积增长 | 使用动态 `import()` 按需加载当前主题引擎 |
| 全屏 Canvas 60fps 在低端设备卡顿 | 用户体验下降 | DPR 上限 1.5 + 后台自动暂停 + 可选关闭 |
| 旧主题 CSS 清理遗漏 | 样式残留 | 全局搜索 `theme-ocean/forest/slate/terminal` 逐文件确认 |
| 向后兼容映射不完整 | 用户配置丢失 | 单元测试覆盖全部旧 ID + 默认值回退 |
