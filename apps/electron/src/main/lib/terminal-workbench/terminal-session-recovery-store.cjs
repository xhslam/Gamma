"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeTerminalTitle } = require("./terminal-session-policy.cjs");

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_SESSIONS = 50;
const MAX_WORKSPACE_INSTANCE_ID_LENGTH = 1024;

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const cwd = typeof value.cwd === "string" ? value.cwd : "";
  const shell = typeof value.shell === "string" ? value.shell.trim() : "";
  const workspaceInstanceId =
    typeof value.workspaceInstanceId === "string"
      ? value.workspaceInstanceId.trim()
      : "";
  if (!SESSION_ID.test(id) || !path.isAbsolute(cwd)) return null;
  return {
    cols: normalizePositiveInteger(value.cols, 80),
    cwd,
    id,
    ...(normalizeTerminalTitle(value.customTitle) ? { customTitle: normalizeTerminalTitle(value.customTitle) } : {}),
    rows: normalizePositiveInteger(value.rows, 24),
    shell: shell && path.isAbsolute(shell) ? shell : null,
    ...(workspaceInstanceId &&
    workspaceInstanceId.length <= MAX_WORKSPACE_INSTANCE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(workspaceInstanceId)
      ? { workspaceInstanceId }
      : {}),
  };
}

function createTerminalSessionRecoveryStore(filePath, options = {}) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new TypeError("terminal recovery file path must be absolute");
  }
  const fileSystem = options.fileSystem ?? fs;
  function load() {
    try {
      const parsed = JSON.parse(fileSystem.readFileSync(filePath, "utf8"));
      const entries = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      return entries.map(normalizeDescriptor).filter(Boolean).slice(0, MAX_SESSIONS);
    } catch {
      return [];
    }
  }
  function save(records) {
    const sessions = (Array.isArray(records) ? records : [])
      .map(normalizeDescriptor)
      .filter(Boolean)
      .slice(0, MAX_SESSIONS);
    const directory = path.dirname(filePath);
    fileSystem.mkdirSync(directory, { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fileSystem.writeFileSync(temporary, JSON.stringify({ sessions }, null, 2), "utf8");
    fileSystem.renameSync(temporary, filePath);
    return sessions;
  }
  return Object.freeze({ load, save });
}

module.exports = { createTerminalSessionRecoveryStore, normalizeDescriptor };
