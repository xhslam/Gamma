"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CaretDown, CaretRight, Eye, Folder, PencilSimple, Plus, TerminalWindow, Check, X } from "@phosphor-icons/react";
import type { DesktopTerminalBridge, DesktopTerminalProjectDirectory } from "./desktop-bridge";
import type { NotesTerminalSession } from "./use-notes-terminal-sessions";
import {
  derivedSessionStatus,
  derivedSessionStatusLabel,
  groupTerminalSessions,
  isTerminalPaneVisible,
  normalizeSessionTitle,
  terminalSessionTitle,
} from "./terminal-session-presentation";

function SessionRename({ session, onRename, onDone }: {
  session: NotesTerminalSession; onRename: (id: string, title: string | null) => Promise<boolean>; onDone: (restoreFocus?: boolean) => void;
}) {
  const [value, setValue] = useState(session.customTitle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    input.current?.focus(); input.current?.select();
    return () => { mounted.current = false; };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(false);
    const success = await onRename(session.id, normalizeSessionTitle(value));
    if (mounted.current) {
      if (success) onDone(form.current?.contains(document.activeElement) ?? false);
      else { setError(true); setBusy(false); saving.current = false; }
    }
  };
  return <form ref={form} className="terminal-focus__rename-form" onSubmit={(event) => void save(event)}>
    <input ref={input} aria-label={`重命名 ${session.label}`} placeholder="留空恢复自动名称" value={value} maxLength={128} disabled={busy}
      onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!saving.current) onDone(); }
      }} />
    <div><button type="submit" aria-label="保存会话名称" title="保存会话名称" disabled={busy}><Check size={14} /></button>
      <button type="button" aria-label="取消重命名" title="取消重命名" disabled={busy} onClick={() => onDone()}><X size={14} /></button></div>
    {error && <span role="alert">保存失败，请重试。</span>}
  </form>;
}

export function TerminalFocusSidebar({
  sessions,
  activeSessionId,
  singlePane,
  bridge,
  disabledCreate,
  restoring,
  closingSessionIds,
  onNew,
  onCreateInProject,
  onActivate,
  onRename,
}: {
  sessions: NotesTerminalSession[];
  activeSessionId: string | null;
  singlePane: boolean;
  bridge: DesktopTerminalBridge | null;
  disabledCreate: boolean;
  restoring: boolean;
  closingSessionIds?: Set<string>;
  onNew: () => void;
  onCreateInProject: (cwd: string | null) => void;
  onActivate: (id: string) => void;
  onRename: (id: string, title: string | null) => Promise<boolean>;
}) {
  const groups = groupTerminalSessions(sessions);
  const descriptionPrefix = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [projects, setProjects] = useState<DesktopTerminalProjectDirectory[]>([]);
  const [recentError, setRecentError] = useState(false);
  const [loading, setLoading] = useState(false);
  const revision = sessions.map((session) => `${session.id}:${session.status}`).join("|");
  const activeCwd = sessions.find((session) => session.id === activeSessionId)?.cwd;
  useEffect(() => {
    const key = activeCwd === null ? "default:" : `path:${activeCwd}`;
    setCollapsed((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous); next.delete(key); return next;
    });
  }, [activeSessionId, activeCwd]);
  useEffect(() => {
    if (!recentOpen || !bridge?.listProjectDirectories) return;
    let cancelled = false;
    setLoading(true); setRecentError(false);
    void bridge.listProjectDirectories().then((recent) => { if (!cancelled) setProjects(recent); })
      .catch(() => { if (!cancelled) setRecentError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bridge, recentOpen, revision]);
  const startRename = (session: NotesTerminalSession) => {
    if (!bridge?.rename || session.status === "starting") return;
    setEditingId(session.id);
  };

  return <>
    <div className="terminal-focus__sidebar-heading"><TerminalWindow size={18} /><h1>终端模式</h1><span>{sessions.length}/8</span>
      <button type="button" className="terminal-focus__tool" aria-label="新建终端" title="新建终端（最多 8 个）；切换页面不会结束会话" disabled={disabledCreate} onClick={onNew}><Plus size={17} /></button>
    </div>
    <div ref={listRef} className="terminal-focus__session-list" role="tablist" aria-label="按启动项目分组的终端会话" aria-orientation="vertical">
      {groups.map((group) => {
        const waitingCount = group.sessions.filter((s) => derivedSessionStatus(s) === "agent-waiting").length;
        const unreadDoneCount = group.sessions.filter((s) => derivedSessionStatus(s) === "agent-done-unread").length;
        return <section key={group.key} className="terminal-focus__project-group" role="group" data-project-path={group.cwd ?? ""} aria-label={`启动项目：${group.cwd ?? "默认目录"}`}>
          <header className="terminal-focus__project-heading">
            <button type="button" className="terminal-focus__project-toggle" aria-expanded={!collapsed.has(group.key)} title={`启动项目：${group.cwd ?? "默认目录"}`} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next;
            })}>
              {collapsed.has(group.key) ? <CaretRight size={11} /> : <CaretDown size={11} />}
              <Folder size={13} />
              <span>{group.name}</span>
              {waitingCount > 0 && <span className="terminal-focus__group-badge terminal-focus__group-badge--waiting" title={`等待确认: ${waitingCount}`}>等 {waitingCount}</span>}
              {unreadDoneCount > 0 && <span className="terminal-focus__group-badge terminal-focus__group-badge--done" title={`未读完成: ${unreadDoneCount}`}>成 {unreadDoneCount}</span>}
              <small>{group.sessions.length}</small>
            </button>
            <button type="button" className="terminal-focus__project-add" aria-label={`在 ${group.cwd ?? "默认目录"} 中新建终端`} title="在此启动项目中新建终端" disabled={disabledCreate} onClick={() => onCreateInProject(group.cwd)}><Plus size={13} /></button>
          </header>
          <div
            className="terminal-focus__project-collapse"
            data-collapsed={collapsed.has(group.key) ? "true" : "false"}
            aria-hidden={collapsed.has(group.key)}
          >
            <div className="terminal-focus__project-collapse-inner">
              {group.sessions.map((session) => {
                const title = terminalSessionTitle(session);
                const shown = isTerminalPaneVisible(session.id, activeSessionId, singlePane);
                const status = derivedSessionStatus(session);
                const statusLabel = derivedSessionStatusLabel(session);
                const exceptional = session.status === "exited" || session.status === "failed" || session.agentState === "waiting" || session.agentState === "working" || (session.agentState === "done" && session.unread);
                return (
                  <div
                    key={session.id}
                    className="terminal-focus__session-row"
                    data-sidebar-session-id={session.id}
                    data-active={session.id === activeSessionId}
                    data-visible={shown}
                    data-closing={closingSessionIds?.has(session.id) ? "true" : undefined}
                  >
                    {editingId === session.id ? (
                      <SessionRename
                        session={session}
                        onRename={onRename}
                        onDone={(restoreFocus = true) => {
                          setEditingId((current) => (current === session.id ? null : current));
                          if (restoreFocus) {
                            requestAnimationFrame(() => {
                              const row = [
                                ...(listRef.current?.querySelectorAll<HTMLElement>("[data-sidebar-session-id]") ?? []),
                              ].find((item) => item.dataset.sidebarSessionId === session.id);
                              row?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
                            });
                          }
                        }}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={session.id === activeSessionId}
                          aria-label={`${title} · ${session.label}`}
                          aria-describedby={`${descriptionPrefix}-${session.id}`}
                          className="terminal-focus__session"
                          data-active={session.id === activeSessionId}
                          data-visible={shown}
                          onClick={() => onActivate(session.id)}
                          onDoubleClick={() => startRename(session)}
                          title={`${title}\n启动项目：${session.cwd ?? "默认目录"}\n${statusLabel} · ${session.id === activeSessionId ? "当前输入" : shown ? "已展示" : "未展示"}`}
                        >
                          <span className="terminal-focus__status-dot" data-status={status} role="img" aria-label={statusLabel} />
                          <span className="terminal-focus__session-info">
                            <strong>{title}</strong>
                            {exceptional && <small>{statusLabel}</small>}
                          </span>
                          {shown && <Eye size={12} className="terminal-focus__visible-marker" aria-label="已展示" />}
                          <span id={`${descriptionPrefix}-${session.id}`} className="terminal-focus__sr-only">
                            {statusLabel} · {shown ? "已展示" : "未展示"}
                            {session.id === activeSessionId ? " · 当前输入" : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="terminal-focus__rename-button"
                          aria-label={`重命名 ${session.label}`}
                          title="重命名（也可双击会话）"
                          disabled={!bridge?.rename || session.status === "starting"}
                          onClick={() => startRename(session)}
                        >
                          <PencilSimple size={12} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>;
      })}
      {!sessions.length && !restoring && <p className="terminal-focus__sidebar-empty">暂无终端会话</p>}
    </div>
    <details className="terminal-focus__recent-projects" onToggle={(event) => setRecentOpen(event.currentTarget.open)}>
      <summary>最近项目</summary>
      {recentOpen && <div>
        {loading && <p role="status">正在读取…</p>}
        {recentError && <p role="alert">无法读取最近项目，请通过新建终端重新选择文件夹。</p>}
        {!loading && !recentError && !projects.length && <p>暂无最近项目</p>}
        {!recentError && projects.map((project) => <button key={project.path} type="button" title={`${project.path}${project.available ? "" : "\n目录不可用"}`} disabled={disabledCreate || !project.available}
          aria-label={`在最近项目 ${project.name} 中新建终端`} onClick={() => onCreateInProject(project.path)}><Folder size={12} /><span>{project.name}</span>{!project.available && <small>不可用</small>}</button>)}
      </div>}
    </details>
  </>;
}
