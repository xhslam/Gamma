import { useState, useEffect } from 'react'
import type {
  DesktopTerminalBridge,
  DesktopTerminalProjectDirectory,
  DesktopTerminalSessionInput,
  DesktopTerminalSessionRecord,
  DesktopTerminalDataEvent,
  DesktopTerminalExitEvent,
  DesktopTerminalAgentStateEvent,
} from '@gamma/shared'

export type {
  DesktopTerminalBridge,
  DesktopTerminalProjectDirectory,
  DesktopTerminalSessionInput,
  DesktopTerminalSessionRecord,
  DesktopTerminalDataEvent,
  DesktopTerminalExitEvent,
  DesktopTerminalAgentStateEvent,
}

export interface DesktopBridge {
  terminal?: DesktopTerminalBridge
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  if (window.shadowingDesktop?.terminal) {
    return { terminal: window.shadowingDesktop.terminal }
  }
  if (window.electronAPI?.terminalWorkbench) {
    return { terminal: window.electronAPI.terminalWorkbench }
  }
  return null
}

export function useHydratedDesktopBridge(): {
  desktopBridge: DesktopBridge | null
  hasHydratedDesktopBridge: boolean
} {
  const [bridge, setBridge] = useState<DesktopBridge | null>(() => getDesktopBridge())
  const [hasHydrated, setHasHydrated] = useState(Boolean(bridge))

  useEffect(() => {
    const resolved = getDesktopBridge()
    setBridge(resolved)
    setHasHydrated(true)
  }, [])

  return {
    desktopBridge: bridge,
    hasHydratedDesktopBridge: hasHydrated,
  }
}
