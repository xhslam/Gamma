/** 与 panels.css 的几何规范配对，由真实浏览器布局测试核对。 */
export const PANEL_GAP_PX = 0
export const WORKBENCH_FRAME_PADDING_PX = 8
export const UI_LIST_ROW_HEIGHT_PX = 34

/** 保留窗口两边各8px留白；三个主面板之间不再预留间隙。 */
export const WORKSPACE_LAYOUT_INSETS_PX = WORKBENCH_FRAME_PADDING_PX * 2 + PANEL_GAP_PX
