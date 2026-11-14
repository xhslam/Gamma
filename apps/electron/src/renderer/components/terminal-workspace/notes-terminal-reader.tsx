"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowLeft, Check, Copy, Image as ImageIcon } from "@phosphor-icons/react";
import type { DesktopTerminalBridge } from "./desktop-bridge";
export type DesktopTerminalAgentState = "idle" | "working" | "waiting" | "done" | "error";
import { parseNotesMarkdownAst } from "./markdown-parser";
import {
  loadTerminalReaderFontSize,
  TERMINAL_SETTINGS_EVENT,
} from "./notes-terminal-options";
import "./notes-terminal-reader.css";

export type TranscriptTurn = {
  id: string;
  text: string;
  userPrompt?: string | null;
  toolCalls?: string[];
};

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  lang?: string;
  ordered?: boolean;
  children?: MarkdownNode[];
};

function ImagePlaceholder({ alt, src }: { alt?: string; src?: string }) {
  const [loaded, setLoaded] = useState(false);
  if (!src) return <span>[图片]</span>;
  if (!loaded) {
    return (
      <button
        type="button"
        className="terminal-reader__image-placeholder"
        onClick={() => setLoaded(true)}
        title="点击加载远程图片"
      >
        <ImageIcon size={14} aria-hidden="true" />
        <span>点击加载图片{alt ? `：${alt}` : ""}</span>
      </button>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || "图片"}
      className="terminal-reader__image"
      loading="lazy"
    />
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="terminal-reader__code-block">
      <div className="terminal-reader__code-header">
        <span>{lang || "code"}</span>
        <button
          type="button"
          className="terminal-reader__code-copy"
          onClick={handleCopy}
          title="复制代码"
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderMarkdownNode(node: MarkdownNode, key: number, depth = 0): ReactNode {
  if (depth > 64) return null;
  const children = node.children?.map((child, index) => renderMarkdownNode(child, index, depth + 1));
  switch (node.type) {
    case "root":
      return <div key={key}>{children}</div>;
    case "paragraph":
      return <p key={key}>{children}</p>;
    case "heading": {
      return (
        <h3 key={key}>
          <strong>{children}</strong>
        </h3>
      );
    }
    case "strong":
      return <strong key={key}>{children}</strong>;
    case "emphasis":
      return <em key={key}>{children}</em>;
    case "delete":
      return <del key={key}>{children}</del>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "list":
      return node.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>;
    case "listItem":
      return <li key={key}>{children}</li>;
    case "code":
    case "math":
      return <CodeBlock key={key} code={node.value ?? ""} lang={node.lang} />;
    case "inlineCode":
    case "inlineMath":
      return <code key={key}>{node.value}</code>;
    case "table":
      return (
        <div className="terminal-reader__table-wrap" key={key}>
          <table>
            <thead>
              <tr>
                {node.children?.[0]?.children?.map((cell, index) => (
                  <th scope="col" key={index}>
                    {cell.children?.map((child, childIndex) =>
                      renderMarkdownNode(child, childIndex, depth + 1),
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children?.slice(1)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{children}</tr>;
    case "tableCell":
      return <td key={key}>{children}</td>;
    case "link": {
      let allowed = false;
      const url = node.url ?? "";
      try {
        allowed = ["https:", "http:", "mailto:"].includes(new URL(url).protocol);
      } catch {}
      if (allowed) {
        return (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              if ((window.electronAPI as any)?.openExternal) {
                void (window.electronAPI as any).openExternal(url);
              } else {
                window.open(url, "_blank", "noopener,noreferrer");
              }
            }}
          >
            {children}
          </a>
        );
      }
      return <span key={key}>{children}</span>;
    }
    case "image":
      return <ImagePlaceholder alt={node.alt} src={node.url} key={key} />;
    case "break":
      return <br key={key} />;
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return <code key={key}>{node.value}</code>;
    default:
      return <span key={key}>{node.value ?? children}</span>;
  }
}

const ReaderTurnContent = memo(function ReaderTurnContent({
  turn,
}: {
  turn: TranscriptTurn;
}) {
  const [copiedMd, setCopiedMd] = useState(false);
  const handleCopyMarkdown = useCallback(() => {
    void navigator.clipboard?.writeText(turn.text).then(() => {
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
    });
  }, [turn.text]);

  const contentNode = useMemo(() => {
    try {
      return renderMarkdownNode(parseNotesMarkdownAst(turn.text) as MarkdownNode, 0);
    } catch {
      return <pre style={{ whiteSpace: "pre-wrap" }}>{turn.text}</pre>;
    }
  }, [turn.text]);

  return (
    <article className="terminal-reader__turn" data-turn-id={turn.id}>
      {turn.userPrompt && (
        <div className="terminal-reader__user-prompt">
          <span className="terminal-reader__user-badge">User Prompt</span>
          <p>{turn.userPrompt}</p>
        </div>
      )}

      {turn.toolCalls && turn.toolCalls.length > 0 && (
        <details className="terminal-reader__tools">
          <summary className="terminal-reader__tools-summary">
            运行了 {turn.toolCalls.length} 个工具
          </summary>
          <ul className="terminal-reader__tools-list">
            {turn.toolCalls.map((name, index) => (
              <li key={index}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="terminal-reader__content">{contentNode}</div>

      <div className="terminal-reader__turn-footer">
        <button
          type="button"
          className="terminal-reader__turn-copy-btn"
          onClick={handleCopyMarkdown}
          title="复制本条回复为 Markdown"
        >
          {copiedMd ? "已复制 Markdown" : "复制为 Markdown"}
        </button>
      </div>
    </article>
  );
});

export function NotesTerminalReader({
  bridge,
  sessionId,
  active = true,
  agentState: initialAgentState = null,
  onClose,
}: {
  bridge: DesktopTerminalBridge;
  sessionId: string | null;
  active?: boolean;
  agentState?: DesktopTerminalAgentState | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<TranscriptTurn[]>([]);
  const [fontSize, setFontSize] = useState(() => loadTerminalReaderFontSize());
  const [visibleCount, setVisibleCount] = useState(50);
  const [hasNewReplies, setHasNewReplies] = useState(false);
  const [agentState, setAgentState] = useState<DesktopTerminalAgentState | null>(initialAgentState);
  const [isWorking, setIsWorking] = useState(initialAgentState === "working");
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const revisionRef = useRef<string | undefined>(undefined);
  const prevMessagesLengthRef = useRef(0);

  useEffect(() => {
    setAgentState(initialAgentState ?? null);
    setIsWorking(initialAgentState === "working");
  }, [initialAgentState]);

  // Sync font size from settings
  useEffect(() => {
    const syncSettings = () => setFontSize(loadTerminalReaderFontSize());
    window.addEventListener(TERMINAL_SETTINGS_EVENT, syncSettings);
    window.addEventListener("storage", syncSettings);
    return () => {
      window.removeEventListener(TERMINAL_SETTINGS_EVENT, syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  // Fetch transcript
  const fetchTranscript = useCallback(async () => {
    if (!sessionId || !bridge.readTranscript) return;
    try {
      const res = await bridge.readTranscript(sessionId, revisionRef.current);
      if (!res) {
        revisionRef.current = undefined;
        setMessages([]);
      } else {
        revisionRef.current = res.revision;
        if (res.messages !== null) {
          setMessages(res.messages as TranscriptTurn[]);
          setError(null);
        }
      }
    } catch {
      setError("暂无执行记录或记录不可用");
    }
  }, [bridge, sessionId]);

  // Initial fetch on mount or session change
  useEffect(() => {
    revisionRef.current = undefined;
    setMessages([]);
    setError(null);
    prevMessagesLengthRef.current = 0;
    if (active && sessionId) {
      void fetchTranscript();
    }
  }, [active, fetchTranscript, sessionId]);

  // Event-driven refresh via bridge.onAgentState
  useEffect(() => {
    if (!active || !sessionId || !bridge.onAgentState) return;
    const unsub = bridge.onAgentState((event) => {
      if (event.sessionId !== sessionId) return;
      setAgentState(event.agentState);
      setIsWorking(event.agentState === "working");
      if (event.agentState === "done" || event.agentState === "working") {
        void fetchTranscript();
      }
    });
    return () => {
      unsub();
    };
  }, [active, bridge, fetchTranscript, sessionId]);

  // Fallback polling: every 5s while view is active & agent is working
  useEffect(() => {
    if (!active || !sessionId || !isWorking) return;
    const timer = setInterval(() => {
      void fetchTranscript();
    }, 5000);
    return () => clearInterval(timer);
  }, [active, fetchTranscript, isWorking, sessionId]);

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setHasNewReplies(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setHasNewReplies(false);
    isAtBottomRef.current = true;
  }, []);

  // Handle new messages and auto-scroll
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      if (isAtBottomRef.current) {
        // Defer scroll to next tick after DOM render
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      } else {
        setHasNewReplies(true);
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, scrollToBottom]);

  const [isExiting, setIsExiting] = useState(false);
  const handleExit = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 120);
  }, [onClose]);

  // Global Esc & Mod+Alt+R shortcut to exit
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!active) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleExit();
        return;
      }
      if (
        event.key.toLowerCase() === "r" &&
        event.altKey &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        handleExit();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, handleExit]);

  const displayedMessages = messages.slice(-visibleCount);
  const hasMore = messages.length > visibleCount;

  return (
    <div
      className="terminal-reader"
      style={{ fontSize: `${fontSize}px` } as CSSProperties}
      data-testid="terminal-reader"
      data-exiting={isExiting ? "true" : undefined}
    >
      <header className="terminal-reader__toolbar">
        <div className="terminal-reader__toolbar-left">
          <button
            type="button"
            className="terminal-reader__btn"
            onClick={handleExit}
            title="返回终端模式 (Esc 或 Mod+Alt+R)"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>返回终端</span>
          </button>
          <span className="terminal-reader__title">
            阅读模式
            <span className="terminal-reader__badge">只读</span>
          </span>
        </div>
        <div className="terminal-reader__toolbar-right">
          <span>{fontSize}px</span>
        </div>
      </header>

      {agentState === "waiting" && (
        <aside
          className="terminal-reader__waiting-banner"
          role="status"
          aria-live="polite"
        >
          <span>等待你确认 · 按 Esc 回到终端</span>
        </aside>
      )}

      <div
        className="terminal-reader__scroll-area"
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div className="terminal-reader__container">
          {hasMore && (
            <div className="terminal-reader__load-more-wrap">
              <button
                type="button"
                className="terminal-reader__load-more-btn"
                onClick={() => setVisibleCount((c) => c + 50)}
              >
                加载更早的记录（共 {messages.length} 轮，已显示最近 {displayedMessages.length} 轮）
              </button>
            </div>
          )}

          {displayedMessages.map((turn) => (
            <ReaderTurnContent
              key={turn.id}
              turn={turn}
            />
          ))}

          {messages.length === 0 && !error && (
            <div className="terminal-reader__notice" role="status">
              等待 Agent 输出或当前会话尚无回复…
            </div>
          )}

          {error && (
            <div className="terminal-reader__notice" role="status">
              {error}
            </div>
          )}
        </div>
      </div>

      {hasNewReplies && (
        <button
          type="button"
          className="terminal-reader__scroll-pill"
          onClick={scrollToBottom}
        >
          有新回复 ↓
        </button>
      )}
    </div>
  );
}
