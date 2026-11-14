"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent,
} from "react";
import {
  RotateCw as ArrowClockwise,
  Minimize2 as ArrowsIn,
  Maximize2 as ArrowsOut,
  BookOpen as BookOpenText,
  History as ClockCounterClockwise,
  Copy,
  Search as MagnifyingGlass,
  PanelLeft as SidebarSimple,
  Terminal as TerminalWindow,
  Trash2 as Trash,
  X,
  Clipboard as ClipboardText,
  FilePlus,
} from "lucide-react";
import { useHydratedDesktopBridge, type DesktopTerminalBridge } from "./desktop-bridge";
import { useAppTheme } from "./use-app-theme";
import { DEFAULT_NOTES_TYPOGRAPHY, loadNotesTypography, NOTES_TYPOGRAPHY_EVENT, notesTypographyCssVars } from "./notes-typography";
import { formatTerminalPath } from "./notes-terminal-path";
import { useNotesTerminalSessions, type NotesTerminalSession } from "./use-notes-terminal-sessions";
import { NotesTerminalTranscript } from "./notes-terminal-transcript";
import { NotesTerminalReader } from "./notes-terminal-reader";
import { TerminalFocusSidebar } from "./terminal-focus-sidebar";
import {
  derivedSessionStatus,
  derivedSessionStatusLabel,
  terminalSessionTitle,
} from "./terminal-session-presentation";
import { DEFAULT_FOCUS_LAYOUT, normalizeFocusLayout, normalizeWeights, resizeTracks, TERMINAL_FOCUS_LAYOUT_KEY, TERMINAL_FOCUS_GAP, TERMINAL_FOCUS_LIMIT, TERMINAL_FOCUS_SCOPE, type FocusLayout } from "./terminal-focus-layout";
import { TerminalProjectDialog } from "./terminal-project-dialog";
import "./terminal-focus.css";

function ToolButton({ label, children, onClick, disabled, pressed, expanded, controls }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; expanded?: boolean; controls?: string;
}) {
  return <button type="button" className="terminal-focus__tool" aria-label={label} title={label} aria-pressed={pressed} aria-expanded={expanded} aria-controls={controls} disabled={disabled} onClick={onClick}>{children}</button>;
}

function SessionPane({
  session,
  active,
  hidden,
  singlePane,
  registerHost,
  activate,
  close,
  restart,
  toggleSingle,
  pasteIntoSession,
  bridge,
  readingMode,
  closing,
  onToggleReadingMode,
}: {
  session: NotesTerminalSession;
  active: boolean;
  hidden: boolean;
  singlePane: boolean;
  registerHost: (id: string, host: HTMLDivElement | null) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  restart: (id: string) => void;
  toggleSingle: (id: string) => void;
  pasteIntoSession: (id: string, explicitContent?: string) => void;
  bridge: DesktopTerminalBridge | null;
  readingMode: boolean;
  closing?: boolean;
  onToggleReadingMode: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [hasTranscript, setHasTranscript] = useState(Boolean(session.agentKind));
  const hostRef = useCallback((host: HTMLDivElement | null) => registerHost(session.id, host), [registerHost, session.id]);
  const title = terminalSessionTitle(session);
  const status = derivedSessionStatus(session);
  const statusLabel = derivedSessionStatusLabel(session);

  useEffect(() => {
    if (session.agentKind) {
      setHasTranscript(true);
      return;
    }
    if (!bridge?.readTranscript) return;
    let cancelled = false;
    bridge.readTranscript(session.id).then((res) => {
      if (!cancelled && res !== null) setHasTranscript(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [bridge, session.id, session.agentKind]);

  return <section className="terminal-focus__pane" data-session-id={session.id} data-active={active} data-drag-over={isDragOver} data-closing={closing ? "true" : undefined} hidden={hidden}
    aria-label={`${title} 终端面板`} onPointerDownCapture={() => activate(session.id)} onFocusCapture={() => activate(session.id)}
    onDragEnter={(event) => {
      if (event.dataTransfer?.types?.includes("Files")) setIsDragOver(true);
    }}
    onDragOver={(event) => {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!isDragOver) setIsDragOver(true);
      }
    }}
    onDragLeave={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
      setIsDragOver(false);
    }}
    onDrop={(event) => {
      setIsDragOver(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        activate(session.id);
        const paths = files
          .map((file) => (file as { path?: string }).path || file.name)
          .filter(Boolean);
        if (paths.length > 0) {
          pasteIntoSession(session.id, paths.map(formatTerminalPath).join(" "));
        }
      }
    }}
    onPaste={(event) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        activate(session.id);
        const paths = files
          .map((file) => (file as { path?: string }).path)
          .filter(Boolean) as string[];
        if (paths.length > 0) {
          pasteIntoSession(session.id, paths.map(formatTerminalPath).join(" "));
          return;
        }
        pasteIntoSession(session.id);
      }
    }}>
    <header className="terminal-focus__pane-header">
      <button className="terminal-focus__pane-title" type="button" onClick={() => activate(session.id)} title={session.cwd ?? title}>
        <span className="terminal-focus__status-dot" data-status={status} /><span>{title}</span>
      </button>
      <div className="terminal-focus__pane-tools">
        <ToolButton
          label={
            readingMode
              ? "返回终端模式 (Esc / Mod+Alt+R)"
              : hasTranscript
                ? "阅读模式 (Mod+Alt+R)"
                : "未检测到 Agent 记录（仅支持 Claude Code、Codex 或 Antigravity 会话）"
          }
          disabled={!hasTranscript}
          pressed={readingMode}
          onClick={onToggleReadingMode}
        >
          <BookOpenText size={14} />
        </ToolButton>
        <ToolButton label={`重启 ${session.label}`} onClick={() => restart(session.id)}><ArrowClockwise size={14} /></ToolButton>
        <ToolButton label={singlePane ? "恢复分屏" : `专注 ${session.label}`} onClick={() => toggleSingle(session.id)}>{singlePane ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}</ToolButton>
        <ToolButton label={`关闭 ${session.label}`} onClick={() => close(session.id)}><X size={14} /></ToolButton>
      </div>
    </header>
    <div
      className="terminal-focus__pane-body"
      style={{
        position: "relative",
        flex: "1 1 0%",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="terminal-focus__pane-host"
        ref={hostRef}
        style={{
          width: "100%",
          height: "100%",
          visibility: readingMode ? "hidden" : "visible",
          pointerEvents: readingMode ? "none" : "auto",
        }}
      />
      {readingMode && bridge && (
        <NotesTerminalReader
          bridge={bridge}
          sessionId={session.id}
          active={readingMode}
          agentState={session.agentState}
          onClose={onToggleReadingMode}
        />
      )}
    </div>
    <footer className="terminal-focus__pane-footer"><span title={session.cwd ? `启动目录：${session.cwd}` : undefined}>{session.cwd || "正在连接本地 Shell"}</span><span>{session.backend === "pipe" ? "管道回退 · 非完整 TTY" : statusLabel}</span></footer>
  </section>;
}

function TrackSeparator({ axis, index, weights, onResize, singlePane }: {
  axis: "column" | "row"; index: number; weights: number[]; onResize: (weights: number[]) => void; singlePane: boolean;
}) {
  const drag = useRef<{ start: number; size: number; weights: number[] } | null>(null);
  const offset = weights.slice(0, index + 1).reduce((sum, value) => sum + value, 0) * 100;
  const vertical = axis === "column";
  // Fractional tracks share only the space left after Grid gaps. The handle
  // occupies the actual gap, including when tracks have unequal weights.
  const gapOffset = index * TERMINAL_FOCUS_GAP - (weights.length - 1) * TERMINAL_FOCUS_GAP * offset / 100;
  const position = `calc(${offset}% + ${gapOffset}px)`;
  const stop = () => { drag.current = null; };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const coordinate = vertical ? event.clientX : event.clientY;
    onResize(resizeTracks(drag.current.weights, index, (coordinate - drag.current.start) / drag.current.size));
  };
  return <div className={`terminal-focus__separator terminal-focus__separator--${axis}`} role="separator" tabIndex={singlePane ? -1 : 0}
    aria-label={vertical ? `调整第 ${index + 1} 列宽度` : `调整第 ${index + 1} 行高度`} aria-orientation={vertical ? "vertical" : "horizontal"}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(offset)} hidden={singlePane}
    style={vertical ? { left: position } : { top: position }}
    onDoubleClick={() => onResize(normalizeWeights([], weights.length))}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current = { start: vertical ? event.clientX : event.clientY, size: Math.max(1, (vertical ? bounds.width : bounds.height) - (weights.length - 1) * TERMINAL_FOCUS_GAP), weights };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={(event) => {
      const previous = vertical ? "ArrowLeft" : "ArrowUp";
      const next = vertical ? "ArrowRight" : "ArrowDown";
      if (event.key === previous || event.key === next) { event.preventDefault(); onResize(resizeTracks(weights, index, event.key === next ? 0.025 : -0.025)); }
      if (event.key === "Home") { event.preventDefault(); onResize(normalizeWeights([], weights.length)); }
    }} />;
}

export function TerminalFocusWorkspace({ bridge, ready = true }: { bridge: DesktopTerminalBridge | null; ready?: boolean }) {
  const theme = useAppTheme();
  const [typography, setTypography] = useState(DEFAULT_NOTES_TYPOGRAPHY);
  const [layout, setLayout] = useState<FocusLayout>(DEFAULT_FOCUS_LAYOUT);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [singlePane, setSinglePane] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const transcriptId = useId();
  const toggleSearch = useCallback(() => setSearchOpen((open) => !open), []);
  const [readingSessions, setReadingSessions] = useState<Set<string>>(() => new Set());
  const toggleReadingMode = useCallback((id: string) => {
    setReadingSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const terminal = useNotesTerminalSessions({
    enabled: Boolean(bridge), terminalBridge: bridge, workspaceInstanceId: TERMINAL_FOCUS_SCOPE,
    multiPane: true, singlePane, autoCreateSession: false, maxSessions: TERMINAL_FOCUS_LIMIT, strictWorkspaceScope: true,
    sessionIdPrefix: "focus-term", onSearch: toggleSearch,
    readingSessions, onToggleReadingMode: toggleReadingMode,
  });
  const {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    hostRef,
    setSearchQuery,
    clearUnread,
  } = terminal;

  const visibleSessionIdsKey = sessions
    .filter((s) => !singlePane || s.id === activeSessionId)
    .map((s) => s.id)
    .join(",");

  const visibleSessionIds = useMemo(
    () => (visibleSessionIdsKey ? visibleSessionIdsKey.split(",") : []),
    [visibleSessionIdsKey],
  );

  const [daemonStatus, setDaemonStatus] = useState<{
    connected: boolean;
    needsUpgrade: boolean;
    activeSessionsCount: number;
  } | null>(null);

  useEffect(() => {
    if (!bridge?.getDaemonStatus) return;
    bridge.getDaemonStatus().then(setDaemonStatus).catch(() => {});
    if (bridge.onDaemonStatus) {
      return bridge.onDaemonStatus((status) => {
        setDaemonStatus(status);
      });
    }
  }, [bridge]);

  useEffect(() => {
    bridge?.reportVisiblePanes?.({
      activeSessionId,
      visibleSessionIds,
    }).catch(() => undefined);
  }, [bridge, activeSessionId, visibleSessionIds]);

  useEffect(() => {
    const onFocus = () => {
      if (typeof document !== "undefined" && document.hasFocus()) {
        for (const session of sessions) {
          if (visibleSessionIds.includes(session.id) && session.unread) {
            clearUnread(session.id);
          }
        }
      }
    };
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [clearUnread, sessions, visibleSessionIds]);

  useEffect(() => {
    try { setLayout(normalizeFocusLayout(JSON.parse(localStorage.getItem(TERMINAL_FOCUS_LAYOUT_KEY) ?? "null"))); } catch { /* Corrupt preferences must not block Shell startup. */ }
    setPreferencesLoaded(true);
    const syncTypography = () => setTypography(loadNotesTypography());
    syncTypography();
    window.addEventListener(NOTES_TYPOGRAPHY_EVENT, syncTypography);
    window.addEventListener("storage", syncTypography);
    return () => { window.removeEventListener(NOTES_TYPOGRAPHY_EVENT, syncTypography); window.removeEventListener("storage", syncTypography); };
  }, []);
  useEffect(() => {
    if (preferencesLoaded) try { localStorage.setItem(TERMINAL_FOCUS_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* In-memory layout remains usable. */ }
  }, [layout, preferencesLoaded]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setSearchQuery("");
  }, [searchOpen, setSearchQuery]);
  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.focus();
    const dismiss = (event: globalThis.PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null); };
    window.addEventListener("pointerdown", dismiss);
    const dismissOnResize = () => setContextMenu(null);
    window.addEventListener("resize", dismissOnResize);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("resize", dismissOnResize); };
  }, [contextMenu]);

  const columns = singlePane ? 1 : Math.min(layout.columns, Math.max(1, sessions.length));
  const rows = singlePane ? 1 : Math.max(1, Math.ceil(sessions.length / columns));
  const columnWeights = normalizeWeights(layout.columnWeights, columns);
  const rowWeights = normalizeWeights(layout.rowWeights, rows);
  const canTranscript = Boolean(bridge?.readTranscript && bridge?.configureTranscript && bridge?.transcriptStatus);
  const toggleSingle = (id: string) => { setActiveSessionId(id); setSinglePane((value) => !value); };
  const runMenu = (action: () => unknown) => { setContextMenu(null); void action(); };

  const [closingSessionIds, setClosingSessionIds] = useState<Set<string>>(() => new Set());
  const handleCloseSession = useCallback((sessionId: string) => {
    setClosingSessionIds((prev) => new Set(prev).add(sessionId));
    setTimeout(() => {
      terminal.closeSession(sessionId);
      setClosingSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }, 120);
  }, [terminal]);

  const toggleSidebar = useCallback(() => {
    const end = terminal.beginLayoutAnimation(160);
    setLayout((previous) => ({ ...previous, sidebarCollapsed: !previous.sidebarCollapsed }));
    setTimeout(end, 160);
  }, [terminal]);

  return <div className="notes-v2 notes-v2--minimal terminal-focus" data-notes-theme={theme} data-sidebar-collapsed={layout.sidebarCollapsed ? "true" : "false"} style={notesTypographyCssVars(typography) as CSSProperties}>
    <aside id="terminal-focus-sidebar" className="terminal-focus__sidebar" aria-label="终端会话" {...((projectPickerOpen || layout.sidebarCollapsed) ? { inert: '' } : {})} hidden={layout.sidebarCollapsed}>
      <TerminalFocusSidebar sessions={sessions} activeSessionId={activeSessionId} singlePane={singlePane} bridge={bridge}
        disabledCreate={!bridge || terminal.isRestoring || terminal.isMaxed} restoring={terminal.isRestoring}
        closingSessionIds={closingSessionIds}
        onNew={() => setProjectPickerOpen(true)} onActivate={setActiveSessionId} onRename={terminal.renameSession}
        onCreateInProject={(cwd) => {
          if (!bridge || terminal.isRestoring || terminal.isMaxed) return;
          if (cwd === null) setProjectPickerOpen(true);
          else terminal.createSession(cwd);
        }} />
    </aside>
    <main className="terminal-focus__main" aria-label="专注终端工作区" {...(projectPickerOpen ? { inert: '' } : {})}>
      <header className="terminal-focus__toolbar">
        <ToolButton
          label={layout.sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          expanded={!layout.sidebarCollapsed}
          controls="terminal-focus-sidebar"
          onClick={toggleSidebar}
        >
          <SidebarSimple size={16} />
        </ToolButton>
        <span className="terminal-focus__workspace-title">{singlePane ? "单屏专注" : "分屏工作台"}</span>
        <label className="terminal-focus__layout-picker">布局<select aria-label="终端分屏列数" value={layout.columns} onChange={(event) => {
          setLayout((prev) => ({ ...prev, columns: Number(event.target.value), columnWeights: [], rowWeights: [] })); setSinglePane(false);
        }}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 列</option>)}</select></label>
        <ToolButton label={singlePane ? "恢复全部分屏" : "专注当前终端"} pressed={singlePane} disabled={!activeSession} onClick={() => setSinglePane((value) => !value)}>{singlePane ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}</ToolButton>
        <div className="terminal-focus__toolbar-spacer" />
        <ToolButton label="搜索当前终端" pressed={searchOpen} disabled={!activeSession} onClick={toggleSearch}><MagnifyingGlass size={16} /></ToolButton>
        <ToolButton label="复制选区" disabled={!activeSession} onClick={terminal.copyActiveSelection}><Copy size={16} /></ToolButton>
        <ToolButton label="粘贴到当前终端" disabled={!activeSession} onClick={() => void terminal.pasteIntoActiveSession()}><ClipboardText size={16} /></ToolButton>
        <ToolButton label="添加文件到当前终端" disabled={!activeSession} onClick={() => void terminal.pickAndInsertFile()}><FilePlus size={16} /></ToolButton>
        <ToolButton label="清空当前终端" disabled={!activeSession} onClick={terminal.clearActiveSession}><Trash size={16} /></ToolButton>
        {canTranscript && <ToolButton label="Agent 执行记录" pressed={transcriptOpen} disabled={!activeSession} onClick={() => setTranscriptOpen((value) => !value)}><ClockCounterClockwise size={16} /></ToolButton>}
      </header>
      {daemonStatus?.needsUpgrade && (
        <div
          role="status"
          className="terminal-focus__upgrade-banner"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            background: "rgba(234, 179, 8, 0.12)",
            borderBottom: "1px solid rgba(234, 179, 8, 0.28)",
            color: "var(--app-foreground, #e5e5e5)",
            fontSize: "12px",
            lineHeight: "1.4",
          }}
        >
          <span>后台服务版本较旧，{daemonStatus.activeSessionsCount} 个任务在运行，结束后自动升级</span>
          <button
            type="button"
            onClick={() => void bridge?.upgradeDaemon?.()}
            style={{
              padding: "4px 10px",
              background: "rgba(234, 179, 8, 0.22)",
              border: "1px solid rgba(234, 179, 8, 0.4)",
              borderRadius: "4px",
              color: "inherit",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 500,
            }}
          >
            停止全部任务并升级
          </button>
        </div>
      )}
      {searchOpen && <div className="notes-v2__terminal-search terminal-focus__search" role="search" aria-label="搜索当前终端内容">
        <MagnifyingGlass size={15} /><input ref={searchRef} aria-label="搜索终端内容" placeholder="搜索当前终端…" value={terminal.searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); terminal.focusActiveSession(); } }} />
        <ToolButton label="关闭搜索" onClick={() => { setSearchOpen(false); terminal.focusActiveSession(); }}><X size={15} /></ToolButton>
      </div>}
      {terminal.statusMessage && <div className="terminal-focus__error" role="alert">{terminal.statusMessage}</div>}
      <div className="terminal-focus__canvas">
        <div className="terminal-focus__grid" ref={hostRef} data-pane-count={sessions.length} data-single-pane={singlePane} style={{
          "--terminal-focus-gap": `${TERMINAL_FOCUS_GAP}px`,
          gridTemplateColumns: columnWeights.map((weight) => `${weight}fr`).join(" "),
          gridTemplateRows: rowWeights.map((weight) => `${weight}fr`).join(" "),
          minWidth: Math.max(260, columns * 240), minHeight: Math.max(0, rows * 170),
        } as CSSProperties} onContextMenu={(event) => {
          const pane = (event.target as Element).closest<HTMLElement>("[data-session-id]");
          if (!pane?.dataset.sessionId) return;
          event.preventDefault(); setActiveSessionId(pane.dataset.sessionId);
          setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 225) });
        }}>
          {sessions.map((session) => <SessionPane key={session.id} session={session} active={session.id === activeSessionId}
            hidden={singlePane && session.id !== activeSessionId} singlePane={singlePane} registerHost={terminal.registerSessionHost}
            activate={setActiveSessionId} close={handleCloseSession} closing={closingSessionIds.has(session.id)} restart={terminal.restartSession} toggleSingle={toggleSingle}
            pasteIntoSession={terminal.pasteIntoSession} bridge={bridge} readingMode={readingSessions.has(session.id)}
            onToggleReadingMode={() => toggleReadingMode(session.id)} />)}
          {columnWeights.slice(0, -1).map((_, index) => <TrackSeparator key={`column-${index}`} axis="column" index={index} weights={columnWeights} singlePane={singlePane} onResize={(weights) => setLayout((previous) => ({ ...previous, columnWeights: weights }))} />)}
          {rowWeights.slice(0, -1).map((_, index) => <TrackSeparator key={`row-${index}`} axis="row" index={index} weights={rowWeights} singlePane={singlePane} onResize={(weights) => setLayout((previous) => ({ ...previous, rowWeights: weights }))} />)}
        </div>
        {!sessions.length && <div className="terminal-focus__empty"><TerminalWindow size={32} /><h2>{!ready ? "正在连接桌面终端…" : terminal.isRestoring ? "正在恢复终端会话…" : bridge ? "开始一个终端会话" : "终端仅在 Auris 桌面端可用"}</h2>
          <p>{bridge ? "选择文件夹或最近项目，在对应目录启动本机默认 Shell。" : "请在桌面应用中打开终端模式。"}</p>
          {bridge && <button type="button" disabled={terminal.isRestoring} onClick={() => setProjectPickerOpen(true)}>新建终端</button>}
        </div>}
      </div>
      {transcriptOpen && canTranscript && bridge && <NotesTerminalTranscript bridge={bridge} sessionId={activeSessionId} id={transcriptId} />}
      <footer className="terminal-focus__footer"><span>{activeSession?.shell ?? "本地 Shell"}</span><span>{singlePane ? "1" : sessions.length} 个可见 · {sessions.length} 个会话</span><span>拖动分隔线调整布局 · 双击还原比例</span></footer>
    </main>
    {projectPickerOpen && bridge && <TerminalProjectDialog bridge={bridge} onClose={() => setProjectPickerOpen(false)} onCreate={(cwd) => {
      if (terminal.isMaxed || terminal.isRestoring) return;
      setProjectPickerOpen(false);
      terminal.createSession(cwd);
    }} />}
    {contextMenu && <div ref={menuRef} className="terminal-focus__context-menu" role="menu" aria-label="终端操作" tabIndex={-1} style={{ left: Math.max(0, contextMenu.x), top: Math.max(0, contextMenu.y) }} onKeyDown={(event) => { if (event.key === "Escape") { setContextMenu(null); terminal.focusActiveSession(); } }}>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.copyActiveSelection)}>复制选区</button>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.pasteIntoActiveSession)}>粘贴</button>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.pickAndInsertFile)}>添加文件…</button>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.selectAllActiveSession)}>全选</button>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.clearActiveSession)}>清空终端</button>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.restartActiveSession)}>重启当前终端</button>
      <button type="button" role="menuitem" onClick={() => runMenu(terminal.closeActiveSession)}>关闭当前终端</button>
    </div>}
  </div>;
}

export function TerminalWorkspaceView() {
  const { desktopBridge, hasHydratedDesktopBridge } = useHydratedDesktopBridge();
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <TerminalFocusWorkspace bridge={desktopBridge?.terminal ?? null} ready={hasHydratedDesktopBridge} />
    </div>
  );
}

export default TerminalWorkspaceView;
