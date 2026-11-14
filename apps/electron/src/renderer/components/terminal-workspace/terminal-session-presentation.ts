import type { NotesTerminalSession } from "./use-notes-terminal-sessions";

export function normalizeSessionTitle(value: string): string | null {
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()].slice(0, 64).join("") || null;
}

/** Never mistake arbitrary OSC text, a user name or a directory for a program. */
export function terminalSessionTitle(session: Pick<NotesTerminalSession, "customTitle" | "programTitle">): string {
  if (session.customTitle) return session.customTitle;
  const title = (session.programTitle ?? "").replace(/^[^\p{L}\p{N}/\\~]+/u, "").trim();
  if (/^claude(?:\s+code)?(?=$|\s|[·:—–])/i.test(title)) return "Claude Code";
  if (/^codex(?=$|\s|[·:—–])/i.test(title)) return "Codex";
  if (/^gemini(?:\s+cli)?(?=$|\s|[·:—–])/i.test(title)) return "Gemini CLI";
  if (/^antigravity(?=$|\s|[·:—–])/i.test(title)) return "Antigravity";
  return "Shell";
}

export function terminalProjectName(cwd: string | null): string {
  if (!cwd) return "默认目录";
  // Both separators are handled for Windows paths, including when previewed
  // on macOS. Do not trim whitespace: it can be part of a real directory name.
  const stripped = cwd.replace(/[\\/]+$/, "");
  return stripped.split(/[\\/]/).at(-1) || cwd;
}

export type TerminalProjectGroup = { key: string; cwd: string | null; name: string; sessions: NotesTerminalSession[] };
export function groupTerminalSessions(sessions: NotesTerminalSession[]): TerminalProjectGroup[] {
  const groups = new Map<string, TerminalProjectGroup>();
  for (const session of sessions) {
    const key = session.cwd === null ? "default:" : `path:${session.cwd}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, cwd: session.cwd, name: terminalProjectName(session.cwd), sessions: [] };
      groups.set(key, group);
    }
    group.sessions.push(session);
  }
  return [...groups.values()];
}

export function isTerminalPaneVisible(id: string, activeId: string | null, singlePane: boolean) {
  return !singlePane || id === activeId;
}

export const TERMINAL_SESSION_STATUS = { starting: "启动中", running: "运行中", exited: "已退出", failed: "失败" } as const;

export type DerivedSessionStatus =
  | "failed"
  | "exited"
  | "starting"
  | "running"
  | "agent-working"
  | "agent-waiting"
  | "agent-done-unread"
  | "agent-done-read"
  | "agent-idle";

export function derivedSessionStatus(
  session: Pick<NotesTerminalSession, "status" | "agentState" | "agentKind" | "unread">,
): DerivedSessionStatus {
  if (session.status === "failed") return "failed";
  if (session.status === "exited") return "exited";
  if (session.status === "starting") return "starting";

  const isSupportedAgent =
    session.agentKind === "claude-code" ||
    session.agentKind === "codex" ||
    (session.agentState && session.agentState !== "idle");

  if (isSupportedAgent) {
    const agentState = session.agentState ?? "idle";
    if (agentState === "error") return "failed";
    if (agentState === "working") return "agent-working";
    if (agentState === "waiting") return "agent-waiting";
    if (agentState === "done") {
      return session.unread ? "agent-done-unread" : "agent-done-read";
    }
    return "agent-idle";
  }

  return "running";
}

export function derivedSessionStatusLabel(
  session: Pick<NotesTerminalSession, "status" | "agentState" | "agentKind" | "unread">,
): string {
  if (session.status === "failed") return "失败";
  if (session.status === "exited") return "已退出";
  if (session.status === "starting") return "启动中";

  const isSupportedAgent =
    session.agentKind === "claude-code" ||
    session.agentKind === "codex" ||
    (session.agentState && session.agentState !== "idle");

  if (isSupportedAgent) {
    const agentState = session.agentState ?? "idle";
    if (agentState === "error") return "出错";
    if (agentState === "working") return "工作中";
    if (agentState === "waiting") return "等待确认";
    if (agentState === "done") return session.unread ? "已完成（未读）" : "已完成";
    return "空闲";
  }

  return "运行中";
}
