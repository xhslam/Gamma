/**
 * 右侧按需面板状态流转纯逻辑
 *
 * 管理 S0 (默认收起)、S1 (按需轻量浮层) 与 S2 (既有大面板) 三种状态；按需浮层可与正在阅读的工作区并存。
 */

export type OnDemandOverlayTab = 'files' | 'changes' | 'exploration'

export interface OnDemandState {
  /** S2 大面板是否展开 */
  isBigPanelOpen: boolean
  /** S1 轻量浮层激活的标签，null 表示浮层关闭 */
  activeOverlay: OnDemandOverlayTab | null
  /** 当前选中的面板 Tab（用于大面板恢复上次标签） */
  activeTab: string
}

export type RightPanelAction =
  | { type: 'TOGGLE_OVERLAY'; tab: OnDemandOverlayTab }
  | { type: 'CLOSE_OVERLAY' }
  | { type: 'OPEN_IN_BIG_PANEL'; tab: string; target?: unknown }
  | { type: 'COLLAPSE_BIG_PANEL' }
  | { type: 'EXPAND_BIG_PANEL'; tab?: string }
  | { type: 'SET_BIG_PANEL_TAB'; tab: string }

/**
 * 纯状态流转函数
 */
export function transitionRightPanelState(
  state: OnDemandState,
  action: RightPanelAction,
): OnDemandState {
  switch (action.type) {
    case 'TOGGLE_OVERLAY': {
      // 若当前已在同 tab 浮层，再次点击关闭回 S0
      if (state.activeOverlay === action.tab) {
        return {
          ...state,
          activeOverlay: null,
        }
      }
      // 浏览入口不改变已打开的工作区和活动文件。
      return {
        ...state,
        activeOverlay: action.tab,
      }
    }

    case 'CLOSE_OVERLAY': {
      return {
        ...state,
        activeOverlay: null,
      }
    }

    case 'OPEN_IN_BIG_PANEL': {
      // 进入 S2 大面板，关闭 S1 浮层，切到指定 tab
      return {
        ...state,
        isBigPanelOpen: true,
        activeOverlay: null,
        activeTab: action.tab,
      }
    }

    case 'COLLAPSE_BIG_PANEL': {
      // 收起大面板，回到 S0
      return {
        ...state,
        isBigPanelOpen: false,
        activeOverlay: null,
      }
    }

    case 'EXPAND_BIG_PANEL': {
      // 展开大面板，关闭 S1 浮层，恢复传入或上次标签
      return {
        ...state,
        isBigPanelOpen: true,
        activeOverlay: null,
        activeTab: action.tab ?? state.activeTab,
      }
    }

    case 'SET_BIG_PANEL_TAB': {
      return {
        ...state,
        activeTab: action.tab,
      }
    }

    default:
      return state
  }
}
