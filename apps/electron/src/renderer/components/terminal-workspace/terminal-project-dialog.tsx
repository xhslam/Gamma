"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { FolderOpen, X } from "lucide-react";
import type { DesktopTerminalBridge, DesktopTerminalProjectDirectory } from "./desktop-bridge";

export function TerminalProjectDialog({ bridge, onCreate, onClose }: {
  bridge: DesktopTerminalBridge; onCreate: (cwd: string) => void; onClose: () => void;
}) {
  const [projects, setProjects] = useState<DesktopTerminalProjectDirectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const heading = useId();
  const description = useId();
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    if (bridge.listProjectDirectories) {
      void bridge.listProjectDirectories().then((recent) => {
        if (mounted.current) setProjects(recent);
      }).catch(() => { if (mounted.current) setError("无法读取最近项目，可以重新选择文件夹。"); })
        .finally(() => { if (mounted.current) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus(); };
  }, [bridge]);

  const chooseFolder = async () => {
    if (!bridge.pickProjectDirectory || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const project = await bridge.pickProjectDirectory();
      if (project && mounted.current) onCreate(project.path);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "无法选择项目文件夹，请重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const items = [...dialogRef.current!.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    const first = items[0], last = items.at(-1);
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
  };
  return <div className="terminal-project__backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={description} tabIndex={-1} className="terminal-project__dialog" onKeyDown={onKeyDown}>
      <header><h2 id={heading}>新建终端</h2><button type="button" aria-label="取消新建终端" disabled={busy} onClick={onClose}><X size={17} /></button></header>
      <p id={description}>选择启动项目。仅影响新会话，不会切换已有终端或 Notes 笔记库。</p>
      <button type="button" className="terminal-project__browse" disabled={busy || !bridge.pickProjectDirectory} onClick={() => void chooseFolder()}><FolderOpen size={20} /><span>{busy ? "正在选择文件夹…" : "选择文件夹…"}</span></button>
      {!bridge.pickProjectDirectory && <p role="alert">当前桌面版本不支持目录选择，请更新 Auris 后重试。</p>}
      <h3>最近项目</h3>
      {loading ? <p role="status">正在读取最近项目…</p> : projects.length ? <ul>
        {projects.map((project) => <li key={project.path}><button type="button" className="terminal-project__recent" disabled={busy || !project.available} title={project.path} onClick={() => {
          if (busyRef.current) return;
          busyRef.current = true; onCreate(project.path);
        }}><FolderOpen size={17} /><span><strong>{project.name}</strong><small>{project.path}</small></span>{!project.available && <em>目录不可用</em>}</button></li>)}
      </ul> : <p className="terminal-project__empty">还没有最近项目，先选择一个文件夹。</p>}
      {error && <p role="alert" className="terminal-project__error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button></footer>
    </div>
  </div>;
}
