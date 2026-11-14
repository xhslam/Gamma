"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TERMINAL_FOCUS_SCOPE = "auris:terminal-focus";
const RECENT_PROJECT_LIMIT = 12;

// This is terminal-only user consent, not a Notes Vault grant or a filesystem
// sandbox. Only main's native folder picker calls grantSelectedDirectory.
function createTerminalProjectDirectories(filePath) {
  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return (Array.isArray(data?.directories) ? data.directories : []).filter((item) =>
        typeof item?.path === "string" && path.isAbsolute(item.path) &&
        typeof item?.canonicalPath === "string" && path.isAbsolute(item.canonicalPath));
    } catch { return []; }
  }
  function write(directories) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ directories }, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }
  function directoryIdentity(candidate) {
    if (typeof candidate !== "string" || !path.isAbsolute(candidate) || /[\u0000-\u001f\u007f]/.test(candidate)) {
      throw new Error("请选择有效的绝对目录路径。");
    }
    const real = fs.realpathSync(candidate);
    if (!fs.statSync(real).isDirectory()) throw new Error("所选项目不是文件夹。");
    return real;
  }
  function usable(record) {
    try { return directoryIdentity(record.path) === record.canonicalPath; } catch { return false; }
  }
  function view(record) {
    return { path: record.path, name: path.basename(record.path) || record.path, available: usable(record) };
  }
  return Object.freeze({
    grantSelectedDirectory(candidate) {
      // Persist canonical paths; later replacement by a different symlink must
      // not silently redirect a previously authorized project.
      const canonical = directoryIdentity(candidate);
      const next = { path: canonical, canonicalPath: canonical };
      write([next, ...load().filter((record) => record.path !== canonical)]);
      return view(next);
    },
    list: () => load().slice(0, RECENT_PROJECT_LIMIT).map(view),
    has: (candidate) => typeof candidate === "string" && path.isAbsolute(candidate) && load().some((record) => record.path === path.resolve(candidate)),
    resolve(candidate) {
      if (typeof candidate !== "string" || !path.isAbsolute(candidate)) throw new Error("请先通过选择文件夹授权终端项目目录。");
      const normalized = path.resolve(candidate);
      const record = load().find((item) => item.path === normalized);
      if (!record) throw new Error("此项目目录尚未授权，请重新选择文件夹。");
      if (!usable(record)) throw new Error("项目目录已失效或路径目标发生变化，请重新选择文件夹。");
      return record.canonicalPath;
    },
    touch(candidate) {
      const canonical = this.resolve(candidate);
      const records = load();
      const selected = records.find((record) => record.path === canonical);
      write([selected, ...records.filter((record) => record.path !== canonical)]);
    },
  });
}

module.exports = { createTerminalProjectDirectories, TERMINAL_FOCUS_SCOPE };
