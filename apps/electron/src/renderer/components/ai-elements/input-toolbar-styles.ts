/** 输入工具栏控件统一高度：与发送按钮的 32px hover 背景对齐。 */
export const inputToolbarControlHeightClass = 'h-8'

const inputToolbarSquareControlClass = `carpus-ui ${inputToolbarControlHeightClass} w-8`

export const inputToolbarButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-foreground/60 hover:text-foreground hover:bg-muted/50 data-[state=open]:bg-muted/50 data-[state=open]:text-foreground`

/**
 * 加号字形在 24 单位画布里只占 14 单位，而调色板/闪电/大脑/麦克风都占 20 单位。
 * 同为 16px 画布时加号墨迹只有 10.7px，比其他图标矮 4px；放大画布到 22px 才等高。
 * 必须用 `[&_svg]:` 变体覆盖 Button 基础样式里的 `[&_svg]:size-4`，直接写 `size-*` 会被压过。
 */
export const inputToolbarPlusIconClass = '[&_svg]:size-[22px]'

export const inputToolbarActiveButtonClass =
  '!bg-transparent text-primary shadow-none hover:!bg-transparent hover:text-primary data-[state=open]:!bg-transparent [&_svg]:stroke-[2.75]'

export const inputToolbarDangerButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-destructive hover:!text-destructive hover:!bg-[var(--stop-hover-bg)]`

export const inputToolbarSendButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-primary hover:bg-primary/10`

export const inputToolbarDisabledButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-foreground/30 cursor-not-allowed`
