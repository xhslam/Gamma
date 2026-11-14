"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";
import {
  DEFAULT_APP_THEME,
  isAppThemeId,
} from "./app-theme";
import { buildNotesTerminalTheme } from "./notes-terminal-theme";
import { verifiedMonoStack } from "./verified-terminal-mono-stack";
import { createPtyInputQueue, type PtyInputQueue } from "./pty-input-queue";
import { setupFloatingPrompt } from "./setupFloatingPrompt";
import { loadNotesTerminalRuntime } from "./notes-terminal-runtime";
import {
  clampTerminalFontSize,
  createNotesTerminalKeyHandler,
  DEFAULT_TERMINAL_FONT_SIZE,
  loadTerminalFontSize,
  loadTerminalLineHeight,
  loadTerminalWebglEnabled,
  preferredTerminalFontStack,
  TERMINAL_FONT_SIZE_STORAGE,
  TERMINAL_SETTINGS_EVENT,
} from "./notes-terminal-options";
import { formatTerminalPath } from "./notes-terminal-path";
import type {
  DesktopTerminalBridge,
  DesktopTerminalDataEvent,
  DesktopTerminalExitEvent,
  DesktopTerminalSessionRecord,
} from "./desktop-bridge";
import {
  selectActiveTerminalSessionId,
  selectTerminalSessionsForWorkspace,
} from "./terminal-session-scope";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_SESSIONS = 5;
const WINDOW_TERMINAL_SCOPE = "__window__";
const lastActiveSessionByScope = new Map<string, string>();

type SessionStatus = "starting" | "running" | "exited" | "failed";

export type NotesTerminalSession = {
  customTitle?: string | null;
  backend: DesktopTerminalSessionRecord["backend"] | null;
  cwd: string | null;
  id: string;
  isAlive: boolean;
  label: string;
  programTitle?: string;
  shell: string | null;
  status: SessionStatus;
  workspaceInstanceId: string | null;
  agentState?: "idle" | "working" | "waiting" | "done" | "error";
  agentStateUpdatedAt?: number;
  agentKind?: string | null;
  unread?: boolean;
};

type TerminalEntry = {
  container: HTMLDivElement;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  webglAddon: WebglAddon | null;
  webglContextLost: boolean;
  terminal: Terminal;
  inputQueue: PtyInputQueue;
  cleanupFloatingPrompt: () => void;
  cleanupPasteListener?: () => void;
  cleanupFocusListener?: () => void;
  outputReady: boolean;
  outputSequence: number | null;
  exitWritten: boolean;
  fitFrame: number | null;
  resizeTimer: ReturnType<typeof setTimeout> | null;
  lastResize: string | null;
  lastFittedWidth?: number;
  lastFittedHeight?: number;
};

type UseNotesTerminalSessionsInput = {
  cwd?: string | null;
  enabled: boolean;
  terminalBridge?: DesktopTerminalBridge | null;
  visible?: boolean;
  workspaceInstanceId?: string | null;
  onSearch?: () => void;
  /** Opt-in focus workspace; Notes retains its single-host behavior. */
  multiPane?: boolean;
  singlePane?: boolean;
  maxSessions?: number;
  strictWorkspaceScope?: boolean;
  sessionIdPrefix?: string;
  autoCreateSession?: boolean;
  readingSessions?: Set<string> | boolean | null;
  onToggleReadingMode?: (sessionId: string) => void;
};

function getThemeScope(element?: Element | null) {
  if (typeof window === "undefined") {
    return null;
  }

  return element?.closest(".notes-v2") ?? document.documentElement;
}

function readThemeToken(
  variableName: string,
  fallback: string,
  scopeElement?: Element | null,
) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const scope = getThemeScope(scopeElement);
  const scopeValue = scope
    ? getComputedStyle(scope).getPropertyValue(variableName).trim()
    : "";

  if (scopeValue) {
    return scopeValue;
  }

  const rootValue = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();

  return rootValue || fallback;
}

// xterm.js renders into a canvas, and a canvas with "transparent" (or any
// non-opaque) background paints as solid black because there is nothing
// underneath the canvas to composite with. The notes UI legitimately sets
// --notes-pane to "transparent" in minimal mode so the surrounding CSS lets
// the page show through. That value, however, makes the terminal unreadable.
// readOpaqueThemeColor wraps readThemeToken and discards any value that is
// empty, "transparent", or a fully-transparent rgba(...) so the caller can
// keep walking down the fallback chain to a solid color.
function isOpaqueColor(value: string) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "transparent" || normalized === "none") {
    return false;
  }

  // rgba(...) / hsla(...) with explicit zero alpha.
  const alphaMatch = normalized.match(/^(?:rgba|hsla)\([^)]*?,\s*([0-9.]+)\s*\)$/);
  if (alphaMatch && Number.parseFloat(alphaMatch[1] ?? "1") === 0) {
    return false;
  }

  // 8-digit hex with zero alpha (#rrggbb00 / #rgb0).
  if (/^#[0-9a-f]{6}00$/i.test(normalized) || /^#[0-9a-f]{3}0$/i.test(normalized)) {
    return false;
  }

  return true;
}

function readOpaqueThemeColor(
  variableNames: readonly string[],
  fallback: string,
  scopeElement?: Element | null,
) {
  for (const name of variableNames) {
    const value = readThemeToken(name, "", scopeElement);
    if (isOpaqueColor(value)) {
      return value;
    }
  }

  return fallback;
}

function getTerminalThemeId(scopeElement?: Element | null) {
  const scope = getThemeScope(scopeElement);
  const id = scope?.getAttribute("data-notes-theme") ??
    scope?.closest("[data-app-theme]")?.getAttribute("data-app-theme");
  return isAppThemeId(id) ? id : DEFAULT_APP_THEME;
}

function getTerminalTheme(scopeElement?: Element | null) {
  // The terminal needs solid colors. We walk a small chain of variables so the
  // theme stays in sync with the notes pane wherever possible, but reject any
  // value that would render as black on the xterm canvas (transparent / zero
  // alpha / missing) and fall back to the light notes palette.
  const NOTES_PANE_FALLBACK = "#f4f7f1";
  const NOTES_TEXT_FALLBACK = "#233229";

  const background = readOpaqueThemeColor(
    ["--notes-terminal-bg", "--notes-pane", "--notes-surface", "--notes-bg"],
    NOTES_PANE_FALLBACK,
    scopeElement,
  );
  const foreground = readOpaqueThemeColor(
    ["--notes-terminal-fg", "--notes-text"],
    NOTES_TEXT_FALLBACK,
    scopeElement,
  );

  return buildNotesTerminalTheme(getTerminalThemeId(scopeElement), background, foreground);
}

function getTerminalFontFamily(scopeElement?: Element | null) {
  const family = ["--notes-editor-font-mono", "--auris-font-mono", "--font-mono"]
    .map((name) => readThemeToken(name, "", scopeElement))
    .find(Boolean) ?? "";
  return verifiedMonoStack(preferredTerminalFontStack(family));
}

function createSessionLabel(sessions: NotesTerminalSession[]) {
  const used = new Set(
    sessions
      .map((session) => session.label.match(/^Terminal (\d+)$/)?.[1] ?? null)
      .filter((value): value is string => value !== null)
      .map((value) => Number.parseInt(value, 10)),
  );
  let index = 1;

  while (used.has(index)) {
    index += 1;
  }

  return `Terminal ${index}`;
}

function getTerminalScopeKey(workspaceInstanceId: string | null) {
  return workspaceInstanceId ?? WINDOW_TERMINAL_SCOPE;
}

function restoreTerminalSessions(records: DesktopTerminalSessionRecord[]) {
  const nextIndexByScope = new Map<string, number>();

  return records.map((record) => {
    const scopeKey = getTerminalScopeKey(record.workspaceInstanceId ?? null);
    const index = nextIndexByScope.get(scopeKey) ?? 1;
    nextIndexByScope.set(scopeKey, index + 1);
    return {
      backend: record.backend,
      cwd: record.cwd,
      customTitle: record.customTitle ?? null,
      id: record.id,
      isAlive: true,
      label: `Terminal ${index}`,
      shell: record.shell,
      status: "starting" as const,
      workspaceInstanceId: record.workspaceInstanceId ?? null,
      agentState: record.agentState ?? "idle",
      agentStateUpdatedAt: record.agentStateUpdatedAt ?? Date.now(),
      agentKind: record.agentKind ?? null,
      unread: record.unread ?? false,
    };
  });
}

function getRendererSessionNumber(sessionId: string) {
  const match = sessionId.match(/^notes-term-(\d+)$/);
  return match ? Number.parseInt(match[1] ?? "0", 10) : null;
}

function formatExitMessage(exitCode: number | null, signal?: string | number | null) {
  const exitLabel = exitCode === null ? "unknown" : String(exitCode);
  return `\r\n[Process exited with code ${exitLabel}${signal ? `, signal ${signal}` : ""}]\r\n`;
}

function formatRestartHintMessage() {
  return "[Press any key to restart]\r\n";
}

function normalizeInputForBackend(
  data: string,
  backend: DesktopTerminalSessionRecord["backend"] | null,
) {
  if (backend !== "pipe") {
    return data;
  }

  return data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function patchSessions(
  sessions: NotesTerminalSession[],
  sessionId: string,
  patch: Partial<NotesTerminalSession>,
) {
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, ...patch } : session,
  );
}

function replaceSession(
  sessions: NotesTerminalSession[],
  currentSessionId: string,
  nextSession: NotesTerminalSession,
) {
  return sessions.map((session) =>
    session.id === currentSessionId ? nextSession : session,
  );
}

async function writeTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to desktop bridge
    }
  }

  if (
    typeof window !== "undefined" &&
    (window.shadowingDesktop as any)?.clipboard?.writeText
  ) {
    await (window.shadowingDesktop as any).clipboard.writeText(text);
    return;
  }
}

// Reading the clipboard is the mirror image: packaged Electron windows tend to
// reject navigator.clipboard.readText() (permission denied / not focused), so
// try the native bridge first and only fall back to the web API. Returning null
// lets the caller stay silent when there is genuinely nothing to paste.
async function readTextFromClipboard(): Promise<string | null> {
  if (typeof window !== "undefined" && window.electronAPI?.getTerminalClipboardContent) {
    try {
      const res = await window.electronAPI.getTerminalClipboardContent();
      if (res?.text) return res.text;
    } catch {
      // Fall through
    }
  }
  if (
    typeof window !== "undefined" &&
    (window.shadowingDesktop as any)?.clipboard?.readText
  ) {
    try {
      const text = await (window.shadowingDesktop as any).clipboard.readText();
      if (typeof text === "string") {
        return text;
      }
    } catch {
      // Fall through to the web Clipboard API below.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }

  return null;
}

async function readImageFromClipboard(): Promise<{ filePath: string } | null> {
  if (typeof window !== "undefined" && window.electronAPI?.getTerminalClipboardContent) {
    try {
      const res = await window.electronAPI.getTerminalClipboardContent();
      if (res?.type === "image" && res.filePath) return { filePath: res.filePath };
    } catch {}
  }
  if (
    typeof window !== "undefined" &&
    (window.shadowingDesktop as any)?.clipboard?.readImage
  ) {
    try {
      const result = await (window.shadowingDesktop as any).clipboard.readImage();
      if (result && typeof result.filePath === "string" && result.filePath.trim()) {
        return { filePath: result.filePath.trim() };
      }
    } catch {
      // Fall through to the web Clipboard API below.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          const path = (blob as unknown as { path?: string }).path;
          if (path && typeof path === "string" && path.trim()) {
            return { filePath: path.trim() };
          }
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function useNotesTerminalSessions({
  cwd = null,
  enabled,
  visible = true,
  terminalBridge = null,
  workspaceInstanceId = null,
  onSearch,
  multiPane = false,
  singlePane = false,
  maxSessions = MAX_SESSIONS,
  strictWorkspaceScope = false,
  sessionIdPrefix = "notes-term",
  autoCreateSession = true,
  readingSessions = null,
  onToggleReadingMode,
}: UseNotesTerminalSessionsInput) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionHostsRef = useRef(new Map<string, HTMLDivElement>());
  const limit = Math.max(1, Math.min(8, maxSessions));
  const multiPaneRef = useRef(multiPane);
  multiPaneRef.current = multiPane;
  const singlePaneRef = useRef(singlePane);
  singlePaneRef.current = singlePane;
  const entriesRef = useRef<Map<string, TerminalEntry>>(new Map());
  const initializingSessionIdsRef = useRef<Set<string>>(new Set());
  const invalidatedSessionIdsRef = useRef<Set<string>>(new Set());
  const terminatingSessionIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // Forward refs so the xterm key handler (installed once per session inside
  // initializeSession) can always reach the latest paste/copy callbacks
  // without re-binding on every render.
  const pasteHandlerRef = useRef<() => void>(() => {});
  const pasteIntoSessionRef = useRef<(sessionId: string, explicitContent?: string) => Promise<void>>(async () => {});
  const copyHandlerRef = useRef<() => void>(() => {});
  const pendingInputRef = useRef<Map<string, string[]>>(new Map());
  const pendingOutputRef = useRef<Map<string, DesktopTerminalDataEvent[]>>(new Map());
  const snapshotsRef = useRef<Map<string, DesktopTerminalSessionRecord>>(new Map());
  const focusIntentRef = useRef<{ sessionId: string; element: Element | null } | null>(null);
  const pendingExitRef = useRef<Map<string, DesktopTerminalExitEvent>>(new Map());
  const fontSizeRef = useRef(loadTerminalFontSize());
  const lineHeightRef = useRef(loadTerminalLineHeight());
  const webglEnabledRef = useRef(loadTerminalWebglEnabled());
  const webglAddonClassRef = useRef<typeof WebglAddon | null>(null);
  const searchHandlerRef = useRef(onSearch);
  searchHandlerRef.current = onSearch;
  const readingSessionsRef = useRef(readingSessions);
  readingSessionsRef.current = readingSessions;
  const toggleReadingModeRef = useRef(onToggleReadingMode);
  toggleReadingModeRef.current = onToggleReadingMode;
  const activatedScopesRef = useRef(new Set<string>());
  const sessionsRef = useRef<NotesTerminalSession[]>([]);
  const nextSessionIdRef = useRef(1);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // An async import/resume may finish after the visible session was selected.
  // Publish the current target before effects; never reveal the stale startup id.
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const [hasLoadedBackendSessions, setHasLoadedBackendSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sessions, setSessions] = useState<NotesTerminalSession[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const createRendererSessionId = useCallback(
    () => sessionIdPrefix === "notes-term"
      ? `notes-term-${nextSessionIdRef.current++}`
      : `${sessionIdPrefix}-${crypto.randomUUID()}`,
    [sessionIdPrefix],
  );

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !terminalBridge) {
      setHasLoadedBackendSessions(false);
      return undefined;
    }

    setHasLoadedBackendSessions(false);
    // Fetch renderer code alongside list/restore, not after that round trip.
    void loadNotesTerminalRuntime().catch(() => undefined);
    void terminalBridge
      .list()
      .then((allRecords) => {
        const records = strictWorkspaceScope
          ? allRecords.filter((record) => record.workspaceInstanceId === workspaceInstanceId).slice(0, limit)
          : allRecords;
        if (cancelled) {
          return;
        }

        const nextIndex = records.reduce((maximum, record) => {
          const sessionNumber = getRendererSessionNumber(record.id);
          return sessionNumber === null ? maximum : Math.max(maximum, sessionNumber + 1);
        }, 1);

        nextSessionIdRef.current = Math.max(nextSessionIdRef.current, nextIndex);
        for (const record of records) snapshotsRef.current.set(record.id, record);
        setSessions((current) =>
          current.length ? current : restoreTerminalSessions(records),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setHasLoadedBackendSessions(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, limit, strictWorkspaceScope, terminalBridge, workspaceInstanceId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const visibleSessions = useMemo(
    () => selectTerminalSessionsForWorkspace(sessions, workspaceInstanceId),
    [sessions, workspaceInstanceId],
  );
  const scopeKey = getTerminalScopeKey(workspaceInstanceId);

  const activateSession = useCallback(
    (sessionId: string) => {
      if (!visibleSessions.some(({ id }) => id === sessionId)) return;
      lastActiveSessionByScope.set(scopeKey, sessionId);
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
    },
    [scopeKey, visibleSessions],
  );

  const isSessionActive = useCallback((sessionId: string) => {
    return (
      isMountedRef.current &&
      !invalidatedSessionIdsRef.current.has(sessionId) &&
      sessionsRef.current.some((session) => session.id === sessionId)
    );
  }, []);

  const invalidateSession = useCallback((sessionId: string) => {
    invalidatedSessionIdsRef.current.add(sessionId);
    initializingSessionIdsRef.current.delete(sessionId);
  }, []);

  const isSessionDisplayed = useCallback((sessionId: string) => {
    return visibleRef.current && (multiPaneRef.current && !singlePaneRef.current
      ? sessionHostsRef.current.has(sessionId)
      : activeSessionIdRef.current === sessionId);
  }, []);

  const loadWebglAddonForEntry = useCallback((entry: TerminalEntry) => {
    if (entry.webglAddon) return;
    const WebglClass = webglAddonClassRef.current;
    if (!WebglClass) return;
    try {
      const addon = new WebglClass();
      addon.onContextLoss(() => {
        try {
          addon.dispose();
        } catch {
          // ignore
        }
        if (entry.webglAddon === addon) {
          entry.webglAddon = null;
        }
        entry.webglContextLost = true;
      });
      entry.terminal.loadAddon(addon);
      entry.webglAddon = addon;
      entry.webglContextLost = false;
    } catch {
      // WebGL 初始化抛错时静默回退 DOM, 不要弹错误
      entry.webglAddon = null;
    }
  }, []);

  const disposeWebglAddonForEntry = useCallback((entry: TerminalEntry) => {
    if (!entry.webglAddon) return;
    try {
      entry.webglAddon.dispose();
    } catch {
      // ignore
    }
    entry.webglAddon = null;
  }, []);

  // Stable DOM hosts survive layout/focus changes. Moving an existing xterm
  // must never create another Shell or discard its screen state.
  const registerSessionHost = useCallback((sessionId: string, host: HTMLDivElement | null) => {
    if (host) {
      sessionHostsRef.current.set(sessionId, host);
      const entry = entriesRef.current.get(sessionId);
      if (entry && entry.container.parentElement !== host) host.appendChild(entry.container);
      if (entry && isSessionDisplayed(sessionId) && webglEnabledRef.current && !entry.webglContextLost) {
        loadWebglAddonForEntry(entry);
      }
    } else {
      sessionHostsRef.current.delete(sessionId);
      const entry = entriesRef.current.get(sessionId);
      if (entry) {
        disposeWebglAddonForEntry(entry);
      }
    }
  }, [isSessionDisplayed, loadWebglAddonForEntry, disposeWebglAddonForEntry]);

  const layoutAnimationCountRef = useRef(0);
  const layoutAnimationSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fitSession = useCallback(
    (sessionId: string) => {
      const entry = entriesRef.current.get(sessionId);

      if (!entry || !terminalBridge) {
        return;
      }

      if (layoutAnimationCountRef.current > 0) {
        return;
      }

      if (
        readingSessionsRef.current === true ||
        (readingSessionsRef.current instanceof Set && readingSessionsRef.current.has(sessionId))
      ) {
        return;
      }

      if (entry.fitFrame !== null) return;
      entry.fitFrame = requestAnimationFrame(() => {
        entry.fitFrame = null;
        if (!isSessionDisplayed(sessionId) || !entry.container.isConnected) return;
        try {
          entry.fitAddon.fit();
          entry.lastFittedWidth = entry.container.clientWidth;
          entry.lastFittedHeight = entry.container.clientHeight;
          const cols = entry.terminal.cols || DEFAULT_COLS;
          const rows = entry.terminal.rows || DEFAULT_ROWS;
          const sizeKey = `${cols}x${rows}`;
          if (entry.resizeTimer !== null) { clearTimeout(entry.resizeTimer); entry.resizeTimer = null; }
          if (!entry.outputReady || entry.lastResize === sizeKey) return;
          // VMark's resize debounce: fit the screen this frame, send only the
          // final geometry after a drag, and never resize a hidden/inactive PTY.
          entry.resizeTimer = setTimeout(() => {
            entry.resizeTimer = null;
            if (!isSessionDisplayed(sessionId) || entriesRef.current.get(sessionId) !== entry) return;
            entry.lastResize = sizeKey;
            void terminalBridge.resize(sessionId, { cols, rows }).catch(() => {
              entry.lastResize = null;
            });
          }, 100);
        } catch {
          // Hidden terminals cannot always be measured.
        }
      });
    },
    [isSessionDisplayed, terminalBridge],
  );

  const performPostAnimationFit = useCallback(() => {
    requestAnimationFrame(() => {
      if (layoutAnimationCountRef.current > 0) return;
      if (multiPaneRef.current) {
        for (const id of sessionHostsRef.current.keys()) {
          if (isSessionDisplayed(id)) fitSession(id);
        }
      } else if (activeSessionIdRef.current) {
        fitSession(activeSessionIdRef.current);
      }
    });
  }, [fitSession, isSessionDisplayed]);

  const endLayoutAnimation = useCallback(() => {
    if (layoutAnimationCountRef.current <= 0) return;
    layoutAnimationCountRef.current -= 1;
    if (layoutAnimationCountRef.current === 0) {
      if (layoutAnimationSafetyTimerRef.current !== null) {
        clearTimeout(layoutAnimationSafetyTimerRef.current);
        layoutAnimationSafetyTimerRef.current = null;
      }
      performPostAnimationFit();
    }
  }, [performPostAnimationFit]);

  const beginLayoutAnimation = useCallback(
    (durationMs = 160) => {
      layoutAnimationCountRef.current += 1;

      if (layoutAnimationSafetyTimerRef.current !== null) {
        clearTimeout(layoutAnimationSafetyTimerRef.current);
      }

      layoutAnimationSafetyTimerRef.current = setTimeout(() => {
        layoutAnimationSafetyTimerRef.current = null;
        if (layoutAnimationCountRef.current > 0) {
          layoutAnimationCountRef.current = 0;
          performPostAnimationFit();
        }
      }, durationMs + 100);

      let ended = false;
      return () => {
        if (!ended) {
          ended = true;
          endLayoutAnimation();
        }
      };
    },
    [endLayoutAnimation, performPostAnimationFit],
  );

  const showActiveSession = useCallback(
    (sessionId: string | null, fromCompletion = false) => {
      if (fromCompletion && sessionId !== activeSessionIdRef.current) {
        if (multiPaneRef.current && sessionId && isSessionDisplayed(sessionId)) fitSession(sessionId);
        return;
      }
      entriesRef.current.forEach((entry, id) => {
        const displayed = multiPaneRef.current ? isSessionDisplayed(id) : id === sessionId;
        entry.container.style.display = displayed ? "block" : "none";
        if (multiPaneRef.current && displayed) fitSession(id);
        entry.container.dataset.active = id === sessionId ? "true" : "false";

        if (displayed && visibleRef.current && webglEnabledRef.current) {
          if (entry.webglContextLost && id === sessionId) {
            entry.webglContextLost = false;
            loadWebglAddonForEntry(entry);
          } else if (!entry.webglContextLost) {
            loadWebglAddonForEntry(entry);
          }
        } else {
          disposeWebglAddonForEntry(entry);
        }
      });

      if (sessionId && visibleRef.current) {
        fitSession(sessionId);
        const entry = entriesRef.current.get(sessionId);
        if (!fromCompletion) {
          focusIntentRef.current = { sessionId, element: document.activeElement };
          entry?.terminal.focus();
          focusIntentRef.current.element = document.activeElement;
        } else {
          const intent = focusIntentRef.current;
          // Async completion is not a new focus request. A search field or
          // another control that the user chose owns its subsequent input.
          if (intent?.sessionId === sessionId && intent.element === document.activeElement && !document.activeElement?.closest(".notes-v2__terminal-search")) entry?.terminal.focus();
        }
      }
    },
    [fitSession, isSessionDisplayed, loadWebglAddonForEntry, disposeWebglAddonForEntry],
  );

  // VMark updates running/hidden xterm options without replacing its screen.
  // Observe the theme scopes, not the terminal subtree (which changes on output).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !terminalBridge) return;
    const syncPresentation = () => {
      for (const [id, entry] of entriesRef.current) {
        entry.terminal.options.theme = getTerminalTheme(entry.container);
        const newFontFamily = getTerminalFontFamily(entry.container);
        const fontChanged = entry.terminal.options.fontFamily !== newFontFamily;
        if (fontChanged) {
          entry.terminal.options.fontFamily = newFontFamily;
          const webgl = entry.webglAddon;
          if (webgl && typeof webgl.clearTextureAtlas === "function") {
            if (typeof document !== "undefined" && document.fonts?.ready) {
              void document.fonts.ready.then(() => {
                webgl.clearTextureAtlas();
              }).catch(() => {
                webgl.clearTextureAtlas();
              });
            } else {
              webgl.clearTextureAtlas();
            }
          }
        }
        entry.terminal.options.drawBoldTextInBrightColors =
          getTerminalThemeId(entry.container) !== "solarized";
        if (isSessionDisplayed(id)) fitSession(id);
      }
    };
    const observer = new MutationObserver(syncPresentation);
    for (let element: Element | null = getThemeScope(host); element; element = element.parentElement) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["data-notes-theme", "data-app-theme", "class", "style"],
      });
    }
    window.addEventListener("auris:notes-typography", syncPresentation);
    return () => {
      observer.disconnect();
      window.removeEventListener("auris:notes-typography", syncPresentation);
    };
  }, [fitSession, isSessionDisplayed, terminalBridge]);

  const disposeEntry = useCallback((sessionId: string) => {
    const entry = entriesRef.current.get(sessionId);
    pendingOutputRef.current.delete(sessionId);
    pendingExitRef.current.delete(sessionId);
    snapshotsRef.current.delete(sessionId);
    if (!entry) return;

    if (entry.fitFrame !== null) cancelAnimationFrame(entry.fitFrame);
    if (entry.resizeTimer !== null) clearTimeout(entry.resizeTimer);
    entry.inputQueue.close();
    entry.cleanupFloatingPrompt();
    entry.cleanupPasteListener?.();
    entry.cleanupFocusListener?.();
    disposeWebglAddonForEntry(entry);
    entry.terminal.dispose();
    entry.container.remove();
    entriesRef.current.delete(sessionId);
    initializingSessionIdsRef.current.delete(sessionId);
  }, [disposeWebglAddonForEntry]);

  const queuePendingInput = useCallback((sessionId: string, data: string) => {
    const current = pendingInputRef.current.get(sessionId) ?? [];
    pendingInputRef.current.set(sessionId, [...current, data]);
  }, []);

  const consumePendingInput = useCallback((sessionId: string) => {
    const pendingInput = pendingInputRef.current.get(sessionId) ?? [];

    pendingInputRef.current.delete(sessionId);
    return pendingInput.join("");
  }, []);

  const createSession = useCallback((requestedCwd?: string | null) => {
    if (strictWorkspaceScope && !hasLoadedBackendSessions) return;
    const currentVisibleSessions = selectTerminalSessionsForWorkspace(
      sessionsRef.current,
      workspaceInstanceId,
    );
    if (currentVisibleSessions.length >= limit) {
      return;
    }

    const nextId = createRendererSessionId();

    setSessions((current) => {
      const visibleCurrent = selectTerminalSessionsForWorkspace(
        current,
        workspaceInstanceId,
      );
      if (visibleCurrent.length >= limit) {
        return current;
      }

      const nextSessions: NotesTerminalSession[] = [
        ...current,
        {
          backend: null,
          cwd: typeof requestedCwd === "string" ? requestedCwd : null,
          id: nextId,
          isAlive: true,
          label: createSessionLabel(visibleCurrent),
          shell: null,
          status: "starting",
          workspaceInstanceId,
          agentState: "idle",
          agentStateUpdatedAt: Date.now(),
          agentKind: null,
          unread: false,
        },
      ];
      sessionsRef.current = nextSessions;
      return nextSessions;
    });

    setActiveSessionId(nextId);
    lastActiveSessionByScope.set(scopeKey, nextId);
  }, [createRendererSessionId, hasLoadedBackendSessions, limit, scopeKey, strictWorkspaceScope, workspaceInstanceId]);

  const markSession = useCallback(
    (sessionId: string, patch: Partial<NotesTerminalSession>) => {
      // Input callbacks can run before React commits this state update.
      // Publish the backend/status transition before draining pending input;
      // otherwise a fresh command can enter the already-drained start queue.
      sessionsRef.current = patchSessions(sessionsRef.current, sessionId, patch);
      setSessions((current) => patchSessions(current, sessionId, patch));
    },
    [],
  );

  const queueSessionRestart = useCallback(
    (sessionId: string, initialInput?: string) => {
      const currentSession = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );

      if (!currentSession) {
        return;
      }

      const nextSessionId = createRendererSessionId();
      const pendingInput = pendingInputRef.current.get(sessionId) ?? [];
      const replayInput = initialInput ? [...pendingInput, initialInput] : pendingInput;

      pendingInputRef.current.delete(sessionId);
      if (replayInput.length > 0) {
        pendingInputRef.current.set(nextSessionId, replayInput);
      }

      invalidateSession(sessionId);
      terminatingSessionIdsRef.current.add(sessionId);
      terminalBridge?.kill(sessionId).catch(() => undefined);
      disposeEntry(sessionId);
      const nextSession = {
        ...currentSession,
        backend: null,
        id: nextSessionId,
        isAlive: true,
        shell: null,
        programTitle: undefined,
        status: "starting",
      } satisfies NotesTerminalSession;

      setSessions((current) => {
        const nextSessions = replaceSession(current, sessionId, nextSession);
        sessionsRef.current = nextSessions;
        return nextSessions;
      });
      setActiveSessionId((current) =>
        current === sessionId ? nextSessionId : current,
      );
      if (lastActiveSessionByScope.get(scopeKey) === sessionId) {
        lastActiveSessionByScope.set(scopeKey, nextSessionId);
      }
      setStatusMessage(null);
    },
    [createRendererSessionId, disposeEntry, invalidateSession, scopeKey, terminalBridge],
  );

  const initializeSession = useCallback(
    async (session: NotesTerminalSession) => {
      if (
        !terminalBridge ||
        !(multiPane ? sessionHostsRef.current.get(session.id) : hostRef.current) ||
        entriesRef.current.has(session.id) ||
        initializingSessionIdsRef.current.has(session.id) ||
        invalidatedSessionIdsRef.current.has(session.id)
      ) {
        return;
      }

      initializingSessionIdsRef.current.add(session.id);
      const container = document.createElement("div");
      container.className = "notes-v2__terminal-xterm";
      container.style.display = multiPane ? (isSessionDisplayed(session.id) ? "block" : "none") : (session.id === activeSessionIdRef.current ? "block" : "none");
      container.dataset.active = session.id === activeSessionIdRef.current ? "true" : "false";
      (multiPane ? sessionHostsRef.current.get(session.id)! : hostRef.current!).appendChild(container);

      try {
        const [
          { Terminal }, { FitAddon }, { SearchAddon }, { WebLinksAddon }, { Unicode11Addon }, { WebglAddon },
        ] = await loadNotesTerminalRuntime();
        webglAddonClassRef.current = WebglAddon;

        if (!isSessionActive(session.id) || !container.isConnected) {
          container.remove();
          return;
        }

        const terminal = new Terminal({
          allowProposedApi: true,
          convertEol: false,
          cursorBlink: true,
          cursorStyle: "bar",
          macOptionIsMeta: true,
          minimumContrastRatio: 4.5,
          drawBoldTextInBrightColors: getTerminalThemeId(container) !== "solarized",
          fontFamily: getTerminalFontFamily(container),
          fontSize: fontSizeRef.current,
          fontWeight: "normal",
          fontWeightBold: "bold",
          lineHeight: lineHeightRef.current,
          letterSpacing: 0,
          scrollback: 5000,
          scrollOnUserInput: false,
          theme: getTerminalTheme(container),
        });
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();
        const unicodeAddon = new Unicode11Addon();

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(searchAddon);
        terminal.loadAddon(unicodeAddon);
        terminal.unicode.activeVersion = "11";
        terminal.loadAddon(
          new WebLinksAddon((_event, uri) => {
            try {
              const parsed = new URL(uri);
              if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
                return;
              }
              window.open(uri, "_blank", "noopener,noreferrer");
            } catch {
              // Ignore malformed terminal output links.
            }
          }),
        );

        // Bind clipboard shortcuts. xterm.js does not paste on Ctrl+V by
        // default (Ctrl+V is a legitimate control character for some shells),
        // so we intercept the common paste/copy chords and route them through
        // the native clipboard bridge. Returning false tells xterm to swallow
        // the key so it does not also send raw bytes to the shell.
        terminal.attachCustomKeyEventHandler(createNotesTerminalKeyHandler({
          hasSelection: () => terminal.hasSelection(),
          sessionShortcutCount: limit,
          copy: () => copyHandlerRef.current(),
          paste: () => pasteHandlerRef.current(),
          clear: () => { terminal.clear(); terminal.scrollToBottom(); },
          selectAll: () => terminal.selectAll(),
          search: () => searchHandlerRef.current?.(),
          toggleReadingMode: () => toggleReadingModeRef.current?.(session.id),
          zoom: (delta) => {
            fontSizeRef.current = delta === null ? DEFAULT_TERMINAL_FONT_SIZE : clampTerminalFontSize(fontSizeRef.current + delta);
            try { window.localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE, String(fontSizeRef.current)); } catch {}
            for (const [id, entry] of entriesRef.current) {
              entry.terminal.options.fontSize = fontSizeRef.current;
              if (isSessionDisplayed(id)) fitSession(id);
            }
          },
          selectSession: (index) => {
            const target = selectTerminalSessionsForWorkspace(sessionsRef.current, workspaceInstanceId)[index];
            if (target) { lastActiveSessionByScope.set(scopeKey, target.id); setActiveSessionId(target.id); }
          },
        }));
        terminal.onTitleChange?.((programTitle) => {
          if (isSessionActive(session.id)) markSession(session.id, { programTitle });
        });

        terminal.open(container);
        if (isSessionDisplayed(session.id)) fitAddon.fit();
        const inputQueue = createPtyInputQueue(
          (data) => terminalBridge.write(session.id, data),
          (error) => {
            // A failed write may have delivered a prefix. Never replay it in
            // a new shell. Keep later input ordered and make the failure visible.
            if (!isSessionActive(session.id) || !entriesRef.current.has(session.id)) return;
            setStatusMessage(`Terminal write failed: ${error instanceof Error ? error.message : String(error)}`);
          },
        );
        const handleCapturePaste = (event: ClipboardEvent) => {
          const files = event.clipboardData?.files;
          if (files && files.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            const paths = Array.from(files)
              .map((file) => (file as { path?: string }).path)
              .filter(Boolean) as string[];
            if (paths.length > 0) {
              void pasteIntoSessionRef.current(
                session.id,
                paths.map(formatTerminalPath).join(" "),
              );
            } else {
              void pasteIntoSessionRef.current(session.id);
            }
          }
        };
        container.addEventListener("paste", handleCapturePaste, true);

        const handleFocusIn = () => {
          const currentEntry = entriesRef.current.get(session.id);
          if (currentEntry?.webglContextLost && isSessionDisplayed(session.id) && webglEnabledRef.current) {
            currentEntry.webglContextLost = false;
            loadWebglAddonForEntry(currentEntry);
          }
        };
        container.addEventListener("focusin", handleFocusIn);

        entriesRef.current.set(session.id, {
          container,
          fitAddon,
          searchAddon,
          webglAddon: null,
          webglContextLost: false,
          terminal,
          inputQueue,
          cleanupFloatingPrompt: setupFloatingPrompt({ term: terminal, container }),
          cleanupPasteListener: () => container.removeEventListener("paste", handleCapturePaste, true),
          cleanupFocusListener: () => container.removeEventListener("focusin", handleFocusIn),
          outputReady: false,
          outputSequence: null,
          exitWritten: false,
          fitFrame: null,
          resizeTimer: null,
          lastResize: null,
        });

        const entry = entriesRef.current.get(session.id)!;
        if (isSessionDisplayed(session.id) && webglEnabledRef.current) {
          loadWebglAddonForEntry(entry);
        }

        // Listen before awaiting the backend; starting input uses the existing queue.
        terminal.onData((data) => {
          const currentSession = sessionsRef.current.find(
            (item) => item.id === session.id,
          );

          if (!currentSession) {
            return;
          }

          if (currentSession.status === "starting") {
            queuePendingInput(session.id, data);
            return;
          }

          if (currentSession.status !== "running") {
            queueSessionRestart(session.id, data);
            return;
          }

          const normalizedData = normalizeInputForBackend(
            data,
            currentSession.backend,
          );
          inputQueue.write(normalizedData);
        });

        const current = sessionsRef.current.find(({ id }) => id === session.id);
        const alreadyEnded = current?.status === "exited" || current?.status === "failed";
        // Display an unattached ended tab without starting a new Shell merely
        // to read its result. Input still uses the existing explicit restart.
        const record: DesktopTerminalSessionRecord = alreadyEnded ? {
          backend: session.backend, cwd: session.cwd, id: session.id,
          shell: session.shell ?? "", cols: terminal.cols, rows: terminal.rows,
          ...snapshotsRef.current.get(session.id),
          exit: pendingExitRef.current.get(session.id) ?? { sessionId: session.id, exitCode: null, errorMessage: current?.status === "failed" ? "Terminal startup failed" : null },
        } : await terminalBridge.resume({
          cols: terminal.cols || DEFAULT_COLS,
          cwd: session.cwd ?? cwd,
          ...(session.customTitle !== undefined ? { customTitle: session.customTitle } : {}),
          rows: terminal.rows || DEFAULT_ROWS,
          sessionId: session.id,
          workspaceInstanceId: session.workspaceInstanceId,
        });

        if (!isSessionActive(session.id)) {
          if (terminatingSessionIdsRef.current.has(session.id)) {
            void terminalBridge.kill(record.id).catch(() => undefined);
          }
          pendingInputRef.current.delete(session.id);
          disposeEntry(session.id);
          return;
        }

        if (record.output) terminal.write(record.output);
        // Apply the snapshot first, then only live chunks past its boundary.
        // This also catches data emitted before xterm's import/open completed.
        entry.outputSequence = record.outputSequence ?? null;
        for (const event of pendingOutputRef.current.get(session.id) ?? []) {
          if (event.sequence !== undefined && entry.outputSequence !== null && event.sequence <= entry.outputSequence) continue;
          terminal.write(event.data);
          if (event.sequence !== undefined) entry.outputSequence = event.sequence;
        }
        pendingOutputRef.current.delete(session.id);
        entry.outputReady = true;
        entry.lastResize = `${record.cols ?? terminal.cols}x${record.rows ?? terminal.rows}`;
        const earlyExit = pendingExitRef.current.get(session.id) ?? record.exit;
        pendingExitRef.current.delete(session.id);
        markSession(session.id, {
          backend: record.backend,
          customTitle: record.customTitle ?? session.customTitle ?? null,
          cwd: record.cwd,
          isAlive: !earlyExit,
          shell: record.shell,
          status: earlyExit ? (earlyExit.errorMessage ? "failed" : "exited") : "running",
          workspaceInstanceId: record.workspaceInstanceId ?? session.workspaceInstanceId,
          ...(record.agentState ? { agentState: record.agentState } : {}),
          ...(record.agentStateUpdatedAt !== undefined ? { agentStateUpdatedAt: record.agentStateUpdatedAt } : {}),
          ...(record.agentKind ? { agentKind: record.agentKind } : {}),
          ...(record.unread !== undefined ? { unread: record.unread } : {}),
        });
        setStatusMessage(null);
        if (earlyExit) {
          inputQueue.close();
          terminal.write(formatExitMessage(earlyExit.exitCode, 'signal' in earlyExit ? earlyExit.signal : null));
          terminal.write(formatRestartHintMessage());
          entry.exitWritten = true;
          showActiveSession(session.id, true);
          return;
        }
        const pendingInput = consumePendingInput(session.id);

        if (pendingInput) {
          inputQueue.write(normalizeInputForBackend(pendingInput, record.backend));
        } else if (record.backend === "pipe") {
          inputQueue.write("\n");
        }



        showActiveSession(session.id, true);
      } catch (error) {
        pendingInputRef.current.delete(session.id);
        disposeEntry(session.id);
        container.remove();
        if (!isSessionActive(session.id)) {
          return;
        }
        markSession(session.id, {
          isAlive: false,
          status: "failed",
        });
        setStatusMessage(
          error instanceof Error ? error.message : "Terminal failed to start.",
        );
      } finally {
        initializingSessionIdsRef.current.delete(session.id);
      }
    },
    [
      cwd,
      consumePendingInput,
      disposeEntry,
      isSessionActive,
      markSession,
      queuePendingInput,
      queueSessionRestart,
      showActiveSession,
      terminalBridge,
      fitSession,
      isSessionDisplayed,
      loadWebglAddonForEntry,
      multiPane,
      limit,
      scopeKey,
      workspaceInstanceId,
    ],
  );

  useEffect(() => {
    if (!visible && visibleSessions.length === 0) activatedScopesRef.current.delete(scopeKey);
    if (!enabled || !visible || !terminalBridge || !hasLoadedBackendSessions) {
      return;
    }

    if (visibleSessions.length > 0) activatedScopesRef.current.add(scopeKey);
    else if (autoCreateSession && !activatedScopesRef.current.has(scopeKey)) {
      activatedScopesRef.current.add(scopeKey);
      createSession();
    }
  }, [autoCreateSession, createSession, enabled, hasLoadedBackendSessions, scopeKey, terminalBridge, visible, visibleSessions.length]);

  useEffect(() => {
    const nextActiveSessionId = selectActiveTerminalSessionId(
      sessions,
      workspaceInstanceId,
      activeSessionId,
      lastActiveSessionByScope.get(scopeKey) ?? null,
    );
    if (nextActiveSessionId) {
      lastActiveSessionByScope.set(scopeKey, nextActiveSessionId);
    }
    if (nextActiveSessionId !== activeSessionId) {
      setActiveSessionId(nextActiveSessionId);
    }
  }, [activeSessionId, scopeKey, sessions, workspaceInstanceId]);

  useEffect(() => {
    if (!enabled || !visible || !terminalBridge) {
      return;
    }

    // Dormant restored tabs (and other workspaces) do not run shells until
    // selected. Switching back to a running entry keeps its screen and PTY.
    const targets = multiPane && !singlePane ? visibleSessions : visibleSessions.filter(({ id }) => id === activeSessionId);
    for (const session of targets) {
      if (session.status === "starting" || pendingExitRef.current.has(session.id)) void initializeSession(session);
    }
  }, [activeSessionId, enabled, initializeSession, multiPane, singlePane, terminalBridge, visible, visibleSessions]);

  useEffect(() => {
    showActiveSession(activeSessionId);
  }, [activeSessionId, showActiveSession, singlePane, visible]);

  useEffect(() => {
    if (!terminalBridge) {
      return undefined;
    }

    const removeDataListener = terminalBridge.onData((event) => {
      const entry = entriesRef.current.get(event.sessionId);
      if (entry?.outputReady) {
        // A queued IPC data notification may be delivered after the invoke
        // response. Keep the boundary for the whole attachment, not just the
        // array that happened to arrive before resume resolved.
        if (event.sequence !== undefined && entry.outputSequence !== null && event.sequence <= entry.outputSequence) return;
        entry.terminal.write(event.data);
        if (event.sequence !== undefined) entry.outputSequence = event.sequence;
      } else if (sessionsRef.current.some(({ id }) => id === event.sessionId)) {
        if (entry || initializingSessionIdsRef.current.has(event.sessionId)) {
          const pending = pendingOutputRef.current.get(event.sessionId) ?? [];
          // An in-flight snapshot has no known boundary yet. Preserve this
          // finite attach tail, including ANSI/mode prefixes, without clipping.
          pending.push(event);
          pendingOutputRef.current.set(event.sessionId, pending);
        } else {
          // Unattached background tabs use the same bounded recovery history
          // as main. A final exit snapshot replaces this tail before display.
          const snapshot = snapshotsRef.current.get(event.sessionId);
          if (snapshot && (event.sequence === undefined || snapshot.outputSequence === undefined || event.sequence > snapshot.outputSequence)) snapshotsRef.current.set(event.sessionId, {
            ...snapshot, output: `${snapshot.output ?? ""}${event.data}`.slice(-200_000), outputSequence: event.sequence,
          });
        }
      }
    });
    const removeExitListener = terminalBridge.onExit((event) => {
      if (!sessionsRef.current.some(({ id }) => id === event.sessionId)) return;
      const entry = entriesRef.current.get(event.sessionId);
      entry?.inputQueue.close();
      if (!entry?.outputReady) {
        pendingExitRef.current.set(event.sessionId, event);
        const snapshot = snapshotsRef.current.get(event.sessionId);
        if (snapshot && event.output !== undefined) snapshotsRef.current.set(event.sessionId, { ...snapshot, output: event.output, outputSequence: event.outputSequence });
      } else if (!entry.exitWritten) {
        entry.terminal.write(formatExitMessage(event.exitCode, event.signal));
        entry.terminal.write(formatRestartHintMessage());
        entry.exitWritten = true;
      }
      markSession(event.sessionId, {
        isAlive: false,
        status: event.errorMessage ? "failed" : "exited",
      });
    });

    const removeAgentListener = terminalBridge.onAgentState?.((event) => {
      markSession(event.sessionId, {
        agentState: event.agentState,
        agentStateUpdatedAt: event.agentStateUpdatedAt,
        agentKind: event.agentKind,
        unread: event.unread,
      });
    });

    const removeActivateListener = terminalBridge.onActivateSession?.((event) => {
      if (sessionsRef.current.some(({ id }) => id === event.sessionId)) {
        setActiveSessionId(event.sessionId);
        lastActiveSessionByScope.set(scopeKey, event.sessionId);
      }
    });

    return () => {
      removeDataListener();
      removeExitListener();
      removeAgentListener?.();
      removeActivateListener?.();
    };
  }, [markSession, scopeKey, terminalBridge]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      if (multiPane) {
        for (const id of sessionHostsRef.current.keys()) if (isSessionDisplayed(id)) fitSession(id);
      } else if (activeSessionId && visibleRef.current) {
        fitSession(activeSessionId);
      }
    });
    observer.observe(host);
    if (multiPane) for (const paneHost of sessionHostsRef.current.values()) observer.observe(paneHost);

    return () => observer.disconnect();
  }, [activeSessionId, fitSession, isSessionDisplayed, multiPane, singlePane, visibleSessions]);

  // Catch-up fit on exiting reading mode: only if dimensions changed during reading
  const prevReadingSessionsRef = useRef(readingSessions);
  useEffect(() => {
    const prev = prevReadingSessionsRef.current;
    prevReadingSessionsRef.current = readingSessions;

    const checkCatchUp = (sessionId: string) => {
      const entry = entriesRef.current.get(sessionId);
      if (!entry || !entry.container.isConnected || !isSessionDisplayed(sessionId)) return;
      const currentWidth = entry.container.clientWidth;
      const currentHeight = entry.container.clientHeight;
      const sizeChanged =
        entry.lastFittedWidth === undefined ||
        entry.lastFittedWidth !== currentWidth ||
        entry.lastFittedHeight === undefined ||
        entry.lastFittedHeight !== currentHeight;
      if (sizeChanged && currentWidth > 0 && currentHeight > 0) {
        fitSession(sessionId);
      }
    };

    if (prev === true && readingSessions !== true) {
      if (multiPaneRef.current) {
        for (const id of sessionHostsRef.current.keys()) checkCatchUp(id);
      } else if (activeSessionId) {
        checkCatchUp(activeSessionId);
      }
    } else if (prev instanceof Set) {
      for (const id of prev) {
        const stillReading =
          readingSessions === true ||
          (readingSessions instanceof Set && readingSessions.has(id));
        if (!stillReading) {
          checkCatchUp(id);
        }
      }
    }
  }, [activeSessionId, fitSession, isSessionDisplayed, readingSessions]);

  useEffect(() => {
    const entry = activeSessionId
      ? entriesRef.current.get(activeSessionId)
      : null;

    if (!entry) {
      return;
    }

    if (searchQuery) {
      entry.searchAddon.findNext(searchQuery);
      return;
    }

    entry.searchAddon.clearDecorations();
  }, [activeSessionId, searchQuery]);

  useEffect(() => {
    const disposeAllEntries = () => {
      sessionsRef.current.forEach((session) => {
        invalidateSession(session.id);
      });
      entriesRef.current.forEach((entry, sessionId) => {
        pendingInputRef.current.delete(sessionId);
        if (entry.fitFrame !== null) cancelAnimationFrame(entry.fitFrame);
        if (entry.resizeTimer !== null) clearTimeout(entry.resizeTimer);
        entry.inputQueue.close();
        entry.cleanupFloatingPrompt();
        entry.cleanupPasteListener?.();
        entry.cleanupFocusListener?.();
        disposeWebglAddonForEntry(entry);
        entry.terminal.dispose();
        entry.container.remove();
      });
      entriesRef.current.clear();
      pendingInputRef.current.clear();
      pendingOutputRef.current.clear();
      pendingExitRef.current.clear();
      snapshotsRef.current.clear();
    };

    return disposeAllEntries;
  }, [disposeWebglAddonForEntry, invalidateSession]);

  useEffect(() => {
    for (const [id, entry] of entriesRef.current) {
      if (isSessionDisplayed(id) && webglEnabledRef.current && !entry.webglContextLost) {
        loadWebglAddonForEntry(entry);
      } else {
        disposeWebglAddonForEntry(entry);
      }
    }
  }, [isSessionDisplayed, visible, loadWebglAddonForEntry, disposeWebglAddonForEntry]);

  useEffect(() => {
    const handleSettingsChange = () => {
      const nextLineHeight = loadTerminalLineHeight();
      const nextWebgl = loadTerminalWebglEnabled();

      const lineHeightChanged = lineHeightRef.current !== nextLineHeight;
      if (lineHeightChanged) {
        lineHeightRef.current = nextLineHeight;
      }

      const webglChanged = webglEnabledRef.current !== nextWebgl;
      if (webglChanged) {
        webglEnabledRef.current = nextWebgl;
      }

      for (const [id, entry] of entriesRef.current) {
        if (lineHeightChanged) {
          entry.terminal.options.lineHeight = nextLineHeight;
          if (isSessionDisplayed(id)) fitSession(id);
        }
        if (webglChanged) {
          if (nextWebgl && isSessionDisplayed(id) && !entry.webglContextLost) {
            loadWebglAddonForEntry(entry);
          } else if (!nextWebgl) {
            disposeWebglAddonForEntry(entry);
          }
        }
      }
    };

    window.addEventListener(TERMINAL_SETTINGS_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener(TERMINAL_SETTINGS_EVENT, handleSettingsChange);
    };
  }, [fitSession, isSessionDisplayed, loadWebglAddonForEntry, disposeWebglAddonForEntry]);

  const closeSession = useCallback(
    (sessionId: string) => {
      invalidateSession(sessionId);
      terminatingSessionIdsRef.current.add(sessionId);
      terminalBridge?.kill(sessionId).catch(() => undefined);
      pendingInputRef.current.delete(sessionId);
      disposeEntry(sessionId);
      setSessions((current) => {
        const nextSessions = current.filter((session) => session.id !== sessionId);
        sessionsRef.current = nextSessions;

        if (activeSessionId === sessionId) {
          const nextActiveSessionId = selectTerminalSessionsForWorkspace(
              nextSessions,
              workspaceInstanceId,
            ).at(-1)?.id ?? null;
          if (nextActiveSessionId) {
            lastActiveSessionByScope.set(scopeKey, nextActiveSessionId);
          } else {
            lastActiveSessionByScope.delete(scopeKey);
          }
          setActiveSessionId(nextActiveSessionId);
        }

        return nextSessions;
      });
    },
    [activeSessionId, disposeEntry, invalidateSession, scopeKey, terminalBridge, workspaceInstanceId],
  );

  const closeActiveSession = useCallback(() => {
    if (activeSessionId) {
      closeSession(activeSessionId);
    }
  }, [activeSessionId, closeSession]);

  const restartSession = useCallback(
    (sessionId: string) => {
      queueSessionRestart(sessionId);
    },
    [queueSessionRestart],
  );

  const restartActiveSession = useCallback(() => {
    if (activeSessionId) {
      restartSession(activeSessionId);
    }
  }, [activeSessionId, restartSession]);

  const writeInputToSession = useCallback(
    (sessionId: string, data: string) => {
      if (!data || !terminalBridge) {
        return;
      }

      const currentSession = sessionsRef.current.find(
        (item) => item.id === sessionId,
      );

      if (!currentSession) {
        return;
      }

      if (currentSession.status === "starting") {
        queuePendingInput(sessionId, data);
        return;
      }

      if (currentSession.status !== "running") {
        queueSessionRestart(sessionId, data);
        return;
      }

      const normalizedData = normalizeInputForBackend(
        data,
        currentSession.backend,
      );
      entriesRef.current.get(sessionId)?.inputQueue.write(normalizedData);
    },
    [queuePendingInput, queueSessionRestart, terminalBridge],
  );

  const renameSession = useCallback(async (sessionId: string, title: string | null) => {
    if (!terminalBridge?.rename || !isSessionActive(sessionId)) return false;
    const current = sessionsRef.current.find((session) => session.id === sessionId);
    if (!current || current.status === "starting") return false;
    // A restart may replace this id while the IPC is pending. Keep only the
    // confirmed title in session state so a new PTY cannot inherit an unsaved
    // optimistic name (including an unconfirmed clear).
    try {
      const result = await terminalBridge.rename(sessionId, title);
      if (isSessionActive(sessionId)) markSession(sessionId, { customTitle: result.customTitle });
      return true;
    } catch (error) {
      if (isSessionActive(sessionId)) {
        setStatusMessage(error instanceof Error ? error.message : "终端重命名失败。");
      }
      return false;
    }
  }, [isSessionActive, markSession, terminalBridge]);

  const clearActiveSession = useCallback(() => {
    if (!activeSessionId) {
      return;
    }

    const terminal = entriesRef.current.get(activeSessionId)?.terminal;

    terminal?.clear();
    terminal?.focus();
  }, [activeSessionId]);

  const copyActiveSelection = useCallback(() => {
    if (!activeSessionId) {
      return;
    }

    const selection = entriesRef.current
      .get(activeSessionId)
      ?.terminal.getSelection()
      .trimEnd();

    if (!selection) {
      return;
    }

    void writeTextToClipboard(selection)
      .then(() => setStatusMessage(null))
      .catch(() => {
        setStatusMessage("Clipboard copy failed.");
      });
  }, [activeSessionId]);

  const pasteIntoSession = useCallback(
    async (sessionId: string, explicitContent?: string) => {
      try {
        let contentToPaste: string | null = explicitContent ?? null;

        if (!contentToPaste) {
          const imageResult = await readImageFromClipboard();
          if (imageResult?.filePath) {
            contentToPaste = formatTerminalPath(imageResult.filePath);
          } else {
            contentToPaste = await readTextFromClipboard();
          }
        }

        if (!contentToPaste) {
          return;
        }

        const entry = entriesRef.current.get(sessionId);
        const current = sessionsRef.current.find(({ id }) => id === sessionId);
        if (entry && current?.status === "running") {
          // xterm owns bracketed-paste mode; raw bridge.write loses its markers.
          entry.terminal.paste(contentToPaste);
        } else {
          writeInputToSession(sessionId, contentToPaste);
        }
        if (visibleRef.current && activeSessionIdRef.current === sessionId) {
          entriesRef.current.get(sessionId)?.terminal.focus();
        }
        setStatusMessage(null);
      } catch {
        setStatusMessage("Clipboard paste failed.");
      }
    },
    [writeInputToSession],
  );

  const pasteIntoActiveSession = useCallback(
    async (explicitContent?: string) => {
      if (!activeSessionId) {
        return;
      }

      await pasteIntoSession(activeSessionId, explicitContent);
    },
    [activeSessionId, pasteIntoSession],
  );

  // Keep the refs consumed by the xterm key handler (installed once per
  // session in initializeSession) pointed at the latest paste/copy callbacks.
  useEffect(() => {
    pasteHandlerRef.current = () => {
      void pasteIntoActiveSession();
    };
    pasteIntoSessionRef.current = (sessionId, explicitContent) =>
      pasteIntoSession(sessionId, explicitContent);
    copyHandlerRef.current = () => {
      copyActiveSelection();
    };
  }, [copyActiveSelection, pasteIntoActiveSession, pasteIntoSession]);

  const selectAllActiveSession = useCallback(() => {
    if (!activeSessionId) {
      return;
    }

    const terminal = entriesRef.current.get(activeSessionId)?.terminal;

    terminal?.selectAll();
    terminal?.focus();
  }, [activeSessionId]);

  const focusActiveSession = useCallback(() => {
    if (!activeSessionId || !visibleRef.current) {
      return;
    }

    entriesRef.current.get(activeSessionId)?.terminal.focus();
  }, [activeSessionId]);

  const pickAndInsertFile = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId || activeSessionId;
      if (!targetSessionId) return;

      try {
        let selected: string | string[] | null = null;
        if (typeof window !== "undefined" && window.shadowingDesktop?.system?.pickFile) {
          selected = await window.shadowingDesktop.system.pickFile({
            title: "选择要添加到终端的文件",
            multiple: true,
          });
        } else if (terminalBridge?.pickFile) {
          selected = await terminalBridge.pickFile({
            title: "选择要添加到终端的文件",
            multiple: true,
          });
        }

        if (selected) {
          const formatted = Array.isArray(selected)
            ? selected.map(formatTerminalPath).join(" ")
            : formatTerminalPath(selected);
          await pasteIntoSession(targetSessionId, formatted);
        }
      } catch {
        setStatusMessage("选择文件失败。");
      }
    },
    [activeSessionId, pasteIntoSession],
  );

  const clearUnread = useCallback(
    (sessionId: string) => {
      markSession(sessionId, { unread: false });
      terminalBridge?.clearUnread?.(sessionId).catch(() => undefined);
    },
    [markSession, terminalBridge],
  );

  useEffect(() => {
    return () => {
      if (layoutAnimationSafetyTimerRef.current !== null) {
        clearTimeout(layoutAnimationSafetyTimerRef.current);
      }
    };
  }, []);

  return {
    activeSessionId,
    activeSession: visibleSessions.find((session) => session.id === activeSessionId) ?? null,
    beginLayoutAnimation,
    endLayoutAnimation,
    clearActiveSession,
    clearUnread,
    closeActiveSession,
    closeSession,
    restartSession,
    renameSession,
    registerSessionHost,
    copyActiveSelection,
    createSession,
    focusActiveSession,
    hostRef,
    isMaxed: visibleSessions.length >= limit,
    isRestoring: Boolean(enabled && terminalBridge && !hasLoadedBackendSessions),
    pasteIntoActiveSession,
    pasteIntoSession,
    pickAndInsertFile,
    restartActiveSession,
    searchQuery,
    selectAllActiveSession,
    sessions: visibleSessions,
    setActiveSessionId: activateSession,
    setSearchQuery,
    statusMessage,
  };
}
