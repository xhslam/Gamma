# ASCII 壁纸主题系统实施计划 (ASCII Wallpaper Theme System Implementation Plan)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Gamma 的外观设计系统升级为 8 款基于 Canvas 的程序化 ASCII 动态壁纸主题，并完整实现聊天区底部浮动 `/theme` Dock 与点击向外扩散的圆形揭幕（Circle Reveal）过渡动效。

**Architecture:** 采用分层结构，状态层通过 Jotai 原子与 `settings.json`（经 `safe-file.ts` 原子写）双向持久化；表现层通过全视口 `AsciiWallpaperCanvas` 驱动 8 款轻量程序化数学场景；过渡层使用 CSS `clip-path: circle()` 双缓冲渲染；交互层通过浮动 `/theme` Dock 提供键盘导航与即时预览。

**Tech Stack:** React 18, TypeScript, Jotai, Tailwind CSS, HTML5 Canvas 2D, Bun test runner.

---

### Task 1: 主题类型定义与向后兼容迁移 (Theme Types & Backward Compatibility)

**Files:**
- Modify: `apps/electron/src/types/settings.ts`
- Create / Modify: `apps/electron/src/types/settings.test.ts`
- Modify: `apps/electron/src/main/lib/settings-service.ts`
- Modify: `apps/electron/src/renderer/atoms/theme.ts`

- [ ] **Step 1: 编写向后兼容迁移与归一化的失败测试**

在 `apps/electron/src/types/settings.test.ts` 中添加测试：
```typescript
import { describe, expect, test } from 'bun:test'
import { normalizeThemeStyle, THEME_STYLES } from './settings'

describe('normalizeThemeStyle', () => {
  test('Given 历史主题 ID When 归一化 Then 映射至对应新 ASCII 壁纸主题', () => {
    expect(normalizeThemeStyle('ocean-light')).toBe('cloud-drift')
    expect(normalizeThemeStyle('ocean-dark')).toBe('honu-lagoon')
    expect(normalizeThemeStyle('forest-light')).toBe('cloud-drift')
    expect(normalizeThemeStyle('forest-dark')).toBe('fireflies')
    expect(normalizeThemeStyle('slate-light')).toBe('cloud-drift')
    expect(normalizeThemeStyle('slate-dark')).toBe('moonlit')
    expect(normalizeThemeStyle('terminal-dark')).toBe('claude-code')
  })

  test('Given 有效新主题 ID When 归一化 Then 原样保留', () => {
    for (const style of THEME_STYLES) {
      expect(normalizeThemeStyle(style)).toBe(style)
    }
  })

  test('Given 非法或空值 When 归一化 Then 回退至 default', () => {
    expect(normalizeThemeStyle(undefined)).toBe('default')
    expect(normalizeThemeStyle('invalid-style')).toBe('default')
    expect(normalizeThemeStyle(null)).toBe('default')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`bun test apps/electron/src/types/settings.test.ts`
预期：FAIL（`normalizeThemeStyle` 未定义或新主题不存在）

- [ ] **Step 3: 实现主题枚举与 `normalizeThemeStyle` 逻辑**

在 `apps/electron/src/types/settings.ts` 中更新：
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

const LEGACY_THEME_STYLE_MAP: Record<string, ThemeStyle> = {
  'ocean-light': 'cloud-drift',
  'ocean-dark': 'honu-lagoon',
  'forest-light': 'cloud-drift',
  'forest-dark': 'fireflies',
  'slate-light': 'cloud-drift',
  'slate-dark': 'moonlit',
  'terminal-dark': 'claude-code',
}

export function normalizeThemeStyle(raw: unknown): ThemeStyle {
  if (typeof raw !== 'string') return 'default'
  if ((THEME_STYLES as readonly string[]).includes(raw)) {
    return raw as ThemeStyle
  }
  return LEGACY_THEME_STYLE_MAP[raw] ?? 'default'
}
```

并在 `apps/electron/src/main/lib/settings-service.ts` 的 `getSettings()` 中使用 `normalizeThemeStyle(data.themeStyle)`，在 `apps/electron/src/renderer/atoms/theme.ts` 中使用 `normalizeThemeStyle` 解析缓存值。

- [ ] **Step 4: 运行测试验证通过**

运行：`bun test apps/electron/src/types/settings.test.ts`
预期：PASS

- [ ] **Step 5: 提交改动**

```bash
git add apps/electron/src/types/settings.ts apps/electron/src/types/settings.test.ts apps/electron/src/main/lib/settings-service.ts apps/electron/src/renderer/atoms/theme.ts
git commit -m "feat(theme): 升级主题枚举至 8 款 ASCII 壁纸并增加向后兼容映射"
```

---

### Task 2: 主题元数据注册表与调色板令牌 (ASCII Theme Registry & CSS Tokens)

**Files:**
- Create: `apps/electron/src/renderer/lib/ascii-theme-registry.ts`
- Create: `apps/electron/src/renderer/lib/ascii-theme-registry.test.ts`
- Modify: `apps/electron/src/renderer/styles/design-tokens.css`
- Modify: `apps/electron/tailwind.config.js`

- [ ] **Step 1: 编写注册表完整性测试**

在 `apps/electron/src/renderer/lib/ascii-theme-registry.test.ts` 中添加：
```typescript
import { describe, expect, test } from 'bun:test'
import { ASCII_THEME_REGISTRY, getAsciiThemeDefinition } from './ascii-theme-registry'
import { THEME_STYLES } from '@/types'

describe('ASCII_THEME_REGISTRY', () => {
  test('Given 8 款 ASCII 主题 When 检查注册表 Then 包含所有定义且字段完整', () => {
    const specialIds = THEME_STYLES.filter((id) => id !== 'default')
    expect(specialIds.length).toBe(8)
    for (const id of specialIds) {
      const def = getAsciiThemeDefinition(id)
      expect(def).toBeDefined()
      expect(def.name).toBeTruthy()
      expect(['light', 'dark']).toContain(def.mode)
      expect(def.backgroundColor).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(def.glyphs.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`bun test apps/electron/src/renderer/lib/ascii-theme-registry.test.ts`
预期：FAIL（文件未创建）

- [ ] **Step 3: 实现 `ascii-theme-registry.ts` 并更新 CSS 令牌与 safelist**

创建 `apps/electron/src/renderer/lib/ascii-theme-registry.ts`：
```typescript
import type { ThemeStyle } from '@/types'

export interface AsciiThemeDefinition {
  id: ThemeStyle
  name: string
  englishName: string
  mode: 'light' | 'dark'
  backgroundColor: string
  foregroundColor: string
  accentColor: string
  glyphs: string
}

export const ASCII_THEME_REGISTRY: Record<Exclude<ThemeStyle, 'default'>, AsciiThemeDefinition> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    englishName: 'Claude Code',
    mode: 'dark',
    backgroundColor: '#1F1E1D',
    foregroundColor: '#F0EEE6',
    accentColor: '#D97757',
    glyphs: '+-/*~|',
  },
  'cloud-drift': {
    id: 'cloud-drift',
    name: '云朵舞者',
    englishName: 'Cloud Drift',
    mode: 'light',
    backgroundColor: '#BAEEF5',
    foregroundColor: '#141413',
    accentColor: '#0284c7',
    glyphs: '%;:st+|',
  },
  'honu-lagoon': {
    id: 'honu-lagoon',
    name: '碧海绿龟',
    englishName: 'Honu Lagoon',
    mode: 'dark',
    backgroundColor: '#1C4E4B',
    foregroundColor: '#ECFDF5',
    accentColor: '#14b8a6',
    glyphs: '~sSO0*',
  },
  'koi-pond': {
    id: 'koi-pond',
    name: '锦鲤碧潭',
    englishName: 'Koi Pond',
    mode: 'dark',
    backgroundColor: '#254B3E',
    foregroundColor: '#F0FDF4',
    accentColor: '#10b981',
    glyphs: '()~sSo*',
  },
  'jellyfish': {
    id: 'jellyfish',
    name: '深海水母',
    englishName: 'Jellyfish',
    mode: 'dark',
    backgroundColor: '#0B2030',
    foregroundColor: '#F0F9FF',
    accentColor: '#38bdf8',
    glyphs: '()^|*:.',
  },
  'paper-boats': {
    id: 'paper-boats',
    name: '青波纸船',
    englishName: 'Paper Boats',
    mode: 'dark',
    backgroundColor: '#284A4B',
    foregroundColor: '#F0FDFA',
    accentColor: '#2dd4bf',
    glyphs: '/\\_^~=',
  },
  'fireflies': {
    id: 'fireflies',
    name: '夏夜萤火',
    englishName: 'Fireflies',
    mode: 'dark',
    backgroundColor: '#091216',
    foregroundColor: '#F7FEE7',
    accentColor: '#a3e635',
    glyphs: '*+·oO',
  },
  'moonlit': {
    id: 'moonlit',
    name: '皓月繁星',
    englishName: 'Moonlit',
    mode: 'dark',
    backgroundColor: '#090C1C',
    foregroundColor: '#EEF2FF',
    accentColor: '#818cf8',
    glyphs: '*+~().',
  },
}

export function getAsciiThemeDefinition(style: ThemeStyle): AsciiThemeDefinition {
  if (style === 'default' || !(style in ASCII_THEME_REGISTRY)) {
    return ASCII_THEME_REGISTRY['claude-code']
  }
  return ASCII_THEME_REGISTRY[style as keyof typeof ASCII_THEME_REGISTRY]
}
```

在 `apps/electron/tailwind.config.js` 的 `safelist` 中更新为 8 款 `theme-*` 类名。
并在 `design-tokens.css` 中为各主题注入对应的 CSS 变量块。

- [ ] **Step 4: 运行测试验证通过**

运行：`bun test apps/electron/src/renderer/lib/ascii-theme-registry.test.ts`
预期：PASS

- [ ] **Step 5: 提交改动**

```bash
git add apps/electron/src/renderer/lib/ascii-theme-registry.ts apps/electron/src/renderer/lib/ascii-theme-registry.test.ts apps/electron/src/renderer/styles/design-tokens.css apps/electron/tailwind.config.js
git commit -m "feat(theme): 新增 8 款 ASCII 壁纸元数据注册表与调色板令牌"
```

---

### Task 3: 程序化 ASCII 壁纸 Canvas 渲染引擎 (Procedural ASCII Wallpaper Canvas Engine)

**Files:**
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engine-types.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/claude-code.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/cloud-drift.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/honu-lagoon.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/koi-pond.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/jellyfish.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/paper-boats.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/fireflies.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/moonlit.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/engines/index.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/AsciiWallpaperCanvas.tsx`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/ascii-wallpaper.css`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/AsciiWallpaperCanvas.test.ts`

- [ ] **Step 1: 编写引擎工厂与生命周期的单元测试**

在 `apps/electron/src/renderer/components/ascii-wallpaper/AsciiWallpaperCanvas.test.ts` 中测试：
```typescript
import { describe, expect, test } from 'bun:test'
import { createAsciiWallpaperEngine } from './engines'
import { THEME_STYLES } from '@/types'

describe('createAsciiWallpaperEngine', () => {
  test('Given 8 款主题 ID When 创建引擎 Then 均能初始化并不抛出异常', () => {
    const specialStyles = THEME_STYLES.filter((s) => s !== 'default')
    for (const style of specialStyles) {
      const engine = createAsciiWallpaperEngine(style)
      expect(engine).toBeDefined()
      expect(typeof engine.init).toBe('function')
      expect(typeof engine.paint).toBe('function')
      expect(typeof engine.dispose).toBe('function')
    }
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`bun test apps/electron/src/renderer/components/ascii-wallpaper/AsciiWallpaperCanvas.test.ts`
预期：FAIL（文件未找到）

- [ ] **Step 3: 实现公共接口与 8 个轻量数学驱动引擎**

实现 `engine-types.ts` 与 8 个引擎文件：
- `claude-code.ts`：环境字符漫射场与温润扫描光弧；
- `cloud-drift.ts`：多层横向飘移的 2D 正弦云团；
- `honu-lagoon.ts`：柔和摇摆的海草 + 绿海龟样条轨迹巡游与前鳍摆动；
- `koi-pond.ts`：双锦鲤游动摆尾与同心水波扩散圆环；
- `jellyfish.ts`：水母伞盖径向收缩上浮与触手柔和拖曳；
- `paper-boats.ts`：波浪起伏与折纸船体俯仰颠簸；
- `fireflies.ts`：30 个发光粒子随机漫步与正弦呼吸明灭；
- `moonlit.ts`：密集字符明月光晕 + 繁星微光闪烁 + 浮动薄雾。
并在 `AsciiWallpaperCanvas.tsx` 中实现挂载、DPR 限制（<=1.5）、后台挂起（`document.hidden` 监听）、`prefers-reduced-motion` 停振与卸载资源释放。

- [ ] **Step 4: 运行测试验证通过**

运行：`bun test apps/electron/src/renderer/components/ascii-wallpaper/AsciiWallpaperCanvas.test.ts`
预期：PASS

- [ ] **Step 5: 提交改动**

```bash
git add apps/electron/src/renderer/components/ascii-wallpaper/
git commit -m "feat(wallpaper): 实现轻量程序化 Canvas ASCII 壁纸引擎与 8 款场景算法"
```

---

### Task 4: 圆形揭幕过渡组件 (Circle Reveal Transition Component)

**Files:**
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.tsx`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.test.ts`

- [ ] **Step 1: 编写圆形揭幕状态与计算函数的测试**

在 `CircleRevealTransition.test.ts` 中测试：
```typescript
import { describe, expect, test } from 'bun:test'
import { calculateCircleRevealRadius } from './CircleRevealTransition'

describe('calculateCircleRevealRadius', () => {
  test('Given 点击坐标与视口尺寸 When 计算最大覆盖半径 Then 半径大于至最远角的欧氏距离', () => {
    const origin = { x: 400, y: 700 }
    const viewport = { width: 1920, height: 1080 }
    const radius = calculateCircleRevealRadius(origin, viewport)
    // 最远角到 (400, 700) 是 (1920, 0)，距离 = sqrt((1920-400)^2 + 700^2) ≈ 1673
    expect(radius).toBeGreaterThan(1670)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`bun test apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.test.ts`
预期：FAIL

- [ ] **Step 3: 实现 `CircleRevealTransition.tsx`**

实现：
1. 捕获点击点 `(originX, originY)`；
2. 双层 Canvas 结构：底层维持旧壁纸最后一帧，上层使用 `clip-path: circle(0px at ${x}px ${y}px)` 启动新壁纸；
3. 使用 `requestAnimationFrame` 在 380ms（`cubic-bezier(0.16, 1, 0.3, 1)`）内扩展至最大半径；
4. 动画结束后回调通知父级销毁过渡层，并无缝交割给主画布。

- [ ] **Step 4: 运行测试验证通过**

运行：`bun test apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.test.ts`
预期：PASS

- [ ] **Step 5: 提交改动**

```bash
git add apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.tsx apps/electron/src/renderer/components/ascii-wallpaper/CircleRevealTransition.test.ts
git commit -m "feat(wallpaper): 实现圆形水波揭幕过渡动画组件"
```

---

### Task 5: 浮动 `/theme` Dock 与输入框联动 (Floating `/theme` Dock Component)

**Files:**
- Create: `apps/electron/src/renderer/atoms/theme-picker.ts`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.tsx`
- Create: `apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.test.ts`
- Modify: `apps/electron/src/renderer/components/agent/AgentView.tsx`

- [ ] **Step 1: 编写 Dock 键盘导航逻辑测试**

在 `ThemeFloatingDock.test.ts` 中测试：
```typescript
import { describe, expect, test } from 'bun:test'
import { getNextThemeIndex } from './ThemeFloatingDock'

describe('ThemeFloatingDock 键盘导航', () => {
  test('Given 当前选中第 2 个 When 按右键 Then 索引递增至 3', () => {
    expect(getNextThemeIndex(2, 'ArrowRight', 8)).toBe(3)
  })
  test('Given 当前在末尾 When 按右键 Then 循环回到 0', () => {
    expect(getNextThemeIndex(7, 'ArrowRight', 8)).toBe(0)
  })
  test('Given 当前在开头 When 按左键 Then 循环回到末尾 7', () => {
    expect(getNextThemeIndex(0, 'ArrowLeft', 8)).toBe(7)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`bun test apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.test.ts`
预期：FAIL

- [ ] **Step 3: 实现 `theme-picker.ts` 原子与 `ThemeFloatingDock.tsx`**

实现：
1. `themePickerOpenAtom`、`themePreviewAtom`、`circleRevealAtom`；
2. `ThemeFloatingDock` 组件：
   - 包含 `/theme` 徽章、`ASCII wallpapers` 标题与快捷键提示（`↵ apply • esc close`）；
   - 8 个带缩略图预览的选项卡片；
   - 键盘 `ArrowLeft` / `ArrowRight` 即时轮播预览，`Enter` 应用并持久化关闭，`Escape` 撤销并关闭；
   - 鼠标点击捕获 `event.clientX / clientY` 并触发圆形揭幕动效；
3. 在 `AgentView.tsx` 中挂载 `ThemeFloatingDock` 与 `AsciiWallpaperCanvas`；在输入框截获 `/theme` 指令，触发 Dock 唤起。

- [ ] **Step 4: 运行测试验证通过**

运行：`bun test apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.test.ts`
预期：PASS

- [ ] **Step 5: 提交改动**

```bash
git add apps/electron/src/renderer/atoms/theme-picker.ts apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.tsx apps/electron/src/renderer/components/ascii-wallpaper/ThemeFloatingDock.test.ts apps/electron/src/renderer/components/agent/AgentView.tsx
git commit -m "feat(wallpaper): 实现浮动 /theme Dock 与输入框命令联动"
```

---

### Task 6: 外观设置页网格更新与缩略图打包 (Appearance Settings Page & Previews)

**Files:**
- Create: `apps/electron/src/renderer/assets/theme-previews/theme-*.webp` (8 张高清场景缩略图)
- Modify: `apps/electron/src/renderer/components/settings/AppearanceSettings.tsx`
- Modify: `apps/electron/src/renderer/components/settings/AppearanceSettings.browser.test.ts` (如有)

- [ ] **Step 1: 生成并置入 8 款主题缩略图**

使用从 `/Users/apple/Desktop/gamma-video-frames` 中提取的各场景代表帧生成高质量 WebP 图像：
- `theme-claude-code.webp`
- `theme-cloud-drift.webp`
- `theme-honu-lagoon.webp`
- `theme-koi-pond.webp`
- `theme-jellyfish.webp`
- `theme-paper-boats.webp`
- `theme-fireflies.webp`
- `theme-moonlit.webp`
存放于 `apps/electron/src/renderer/assets/theme-previews/`。

- [ ] **Step 2: 更新 `AppearanceSettings.tsx` 中的特殊风格列表**

将原 `SPECIAL_STYLES` 替换为 8 款新壁纸主题，并在点击卡片时记录鼠标坐标传入 `updateThemeStyle` 触发全局圆形扩散过渡。

- [ ] **Step 3: 运行设置面板相关测试**

运行：`bun test apps/electron/src/renderer/components/settings/`
预期：PASS

- [ ] **Step 4: 提交改动**

```bash
git add apps/electron/src/renderer/assets/theme-previews/ apps/electron/src/renderer/components/settings/AppearanceSettings.tsx
git commit -m "feat(settings): 将外观设置中心特殊风格网格更新为 8 款 ASCII 壁纸主题"
```

---

### Task 7: 样式清理、回归测试验证与版本递增 (Cleanup, Regression Tests & Version Bump)

**Files:**
- Modify: `apps/electron/src/renderer/styles/globals.css`
- Modify: `apps/electron/src/renderer/styles/panels.css`
- Modify: `apps/electron/src/renderer/styles/inline-code.css`
- Modify: `apps/electron/package.json`

- [ ] **Step 1: 清理旧主题样式残留并对齐新类名**

安全清理或替换 `globals.css` 中废弃的 `.theme-terminal-dark` / `theme-ocean-*` / `theme-forest-*` / `theme-slate-*` 专有选择器，确保新 8 款主题无样式冲突。

- [ ] **Step 2: 运行全局类型检查**

运行：`bun run typecheck`
预期：通过，零 TypeScript 类型报错。

- [ ] **Step 3: 运行全量单元与集成测试**

运行：`bun test`
预期：全部用例 PASS。

- [ ] **Step 4: 递增版本号**

遵守 Gamma 工程规范，将 `apps/electron/package.json` 版本号从 `0.19.275` 递增至 `0.19.276`。

- [ ] **Step 5: 提交改动**

```bash
git add apps/electron/src/renderer/styles/ apps/electron/package.json
git commit -m "chore(release): 清理旧主题样式并递增版本至 0.19.276"
```
