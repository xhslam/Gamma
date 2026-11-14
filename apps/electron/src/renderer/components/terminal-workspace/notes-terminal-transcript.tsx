"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { DesktopTerminalBridge } from "./desktop-bridge";
import { parseNotesMarkdownAst } from "./markdown-parser";
import "./notes-terminal-transcript.css";

type Message = { id: string; text: string };
type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  ordered?: boolean;
  children?: MarkdownNode[];
};

// Raw HTML, images, local links and executable diagrams remain inert.
const TranscriptMessage = memo(function TranscriptMessage({ text }: { text: string }) {
  try {
    let remaining = 20_000;
    const renderNode = (node: MarkdownNode, key: number, depth = 0): ReactNode => {
      if (--remaining < 0 || depth > 64) throw new Error("Transcript Markdown exceeds preview bounds.");
      const children = node.children?.map((child, index) => renderNode(child, index, depth + 1));
      switch (node.type) {
        case "root": return <div key={key}>{children}</div>;
        case "paragraph": return <p key={key}>{children}</p>;
        case "heading": return <p key={key}><strong>{children}</strong></p>;
        case "strong": return <strong key={key}>{children}</strong>;
        case "emphasis": return <em key={key}>{children}</em>;
        case "delete": return <del key={key}>{children}</del>;
        case "blockquote": return <blockquote key={key}>{children}</blockquote>;
        case "list": return node.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>;
        case "listItem": return <li key={key}>{children}</li>;
        case "code": case "math": return <pre key={key}><code>{node.value}</code></pre>;
        case "inlineCode": case "inlineMath": return <code key={key}>{node.value}</code>;
        case "table": return <div className="notes-terminal-transcript__table" key={key}><table>
          <thead><tr>{node.children?.[0]?.children?.map((cell, index) => <th scope="col" key={index}>{cell.children?.map((child, childIndex) => renderNode(child, childIndex, depth + 1))}</th>)}</tr></thead>
          <tbody>{children?.slice(1)}</tbody>
        </table></div>;
        case "tableRow": return <tr key={key}>{children}</tr>;
        case "tableCell": return <td key={key}>{children}</td>;
        case "link": {
          let allowed = false;
          try { allowed = ["https:", "http:"].includes(new URL(node.url ?? "").protocol); } catch {}
          return allowed ? <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">{children}</a> : <span key={key}>{children}</span>;
        }
        case "image": return <span key={key}>{node.alt ? `[图片：${node.alt}]` : "[图片]"}</span>;
        case "break": return <br key={key} />;
        case "thematicBreak": return <hr key={key} />;
        case "html": return <code key={key}>{node.value}</code>;
        default: return <span key={key}>{node.value ?? children}</span>;
      }
    };
    return renderNode(parseNotesMarkdownAst(text) as MarkdownNode, 0);
  } catch {
    return <pre>{text}</pre>;
  }
});

export function NotesTerminalTranscript({ bridge, sessionId, id }: {
  bridge: DesktopTerminalBridge;
  sessionId: string | null;
  id: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ sessionId: string; messages: Message[] } | null>(null);
  const regionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let cancelled = false;
    void bridge.transcriptStatus?.().then((state) => {
      if (!cancelled) setEnabled(state.enabled);
    }).catch(() => { if (!cancelled) setError("无法读取执行记录设置。"); });
    return () => { cancelled = true; };
  }, [bridge]);

  useEffect(() => {
    if (!enabled || !sessionId || !bridge.readTranscript) return;
    let cancelled = false;
    let revision: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (document.visibilityState !== "hidden" && regionRef.current?.getClientRects().length) {
          const result = await bridge.readTranscript!(sessionId, revision);
          if (cancelled) return;
          setError(null);
          if (!result) {
            revision = undefined;
            setSnapshot({ sessionId, messages: [] });
          } else {
            revision = result.revision;
            if (result.messages !== null) setSnapshot({ sessionId, messages: result.messages });
          }
        }
      } catch {
        if (!cancelled) setError("执行记录不可用，请检查 CLI 钩子或重新启动 Codex、Antigravity CLI 或 Claude Code 会话。");
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bridge, enabled, sessionId]);

  const configure = async (nextEnabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.configureTranscript!(nextEnabled);
      setEnabled(result.enabled);
      setSnapshot(null);
    } catch {
      setError("无法配置执行记录。请检查 Codex、Antigravity CLI 和 Claude Code 的配置文件是否有效后重试。");
    } finally { setBusy(false); }
  };
  const messages = snapshot?.sessionId === sessionId ? snapshot.messages : [];
  return <section aria-label="Agent 执行记录" className="notes-terminal-transcript" id={id} ref={regionRef}>
    <div className="notes-terminal-transcript__header">
      <strong>Agent 执行记录</strong>
      {enabled ? <div className="notes-terminal-transcript__actions">
        <button type="button" disabled={busy} onClick={() => void configure(true)}>{busy ? "正在更新…" : "更新 CLI 钩子"}</button>
        <button type="button" disabled={busy} onClick={() => void configure(false)}>停用</button>
      </div> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {enabled === false ? <div>
      <p>支持 Codex、Antigravity CLI（agy）和 Claude Code。开启后会在本机 CLI 配置中添加记录钩子，保留已有设置。记录仅在本机读取。</p>
      <button type="button" disabled={busy} onClick={() => void configure(true)}>{busy ? "正在开启…" : "开启执行记录"}</button>
    </div> : enabled === null ? <p role="status">{error ? "请关闭后重新打开记录面板以重试。" : "正在读取设置…"}</p> : messages.length ?
      messages.map((message) => <article key={message.id}><TranscriptMessage text={message.text} /></article>) :
      <p role="status">等待当前终端的 Codex、Antigravity CLI（agy）或 Claude Code 会话。首次开启或更新 CLI 钩子后，请重新启动 CLI，并使用支持生命周期钩子的版本。</p>}
  </section>;
}
