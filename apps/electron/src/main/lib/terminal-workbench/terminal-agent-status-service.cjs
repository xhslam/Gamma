"use strict";

const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function resolveRunDirectory(home = os.homedir()) {
  return path.join(home, ".auris", "run");
}

function resolveSocketPath(options = {}) {
  const platform = options.platform ?? process.platform;
  const pid = options.pid ?? process.pid;
  if (platform === "win32") {
    return `\\\\.\\pipe\\auris-agent-${pid}`;
  }
  const runDir = options.runDir ?? resolveRunDirectory(options.home);
  return path.join(runDir, `agent-${pid}.sock`);
}

function cleanStaleSockets(runDir, currentPid = process.pid) {
  try {
    if (!fs.existsSync(runDir)) return;
    const entries = fs.readdirSync(runDir);
    for (const entry of entries) {
      const match = /^agent-(\d+)\.sock$/.exec(entry);
      if (!match) continue;
      const pid = Number.parseInt(match[1], 10);
      if (pid === currentPid || !isPidAlive(pid)) {
        try {
          fs.unlinkSync(path.join(runDir, entry));
        } catch {
          /* ignore unlink failure */
        }
      }
    }
  } catch {
    /* ignore dir access failure */
  }
}

function sanitizeAgentEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const agent = typeof raw.agent === "string" ? raw.agent.trim().toLowerCase() : "";
  const event = typeof raw.event === "string" ? raw.event.trim() : "";
  if (!/^[a-f0-9-]{36}$/i.test(token) || !agent || !event) return null;
  const notificationType =
    typeof raw.notificationType === "string" && raw.notificationType.trim()
      ? raw.notificationType.trim()
      : undefined;
  const ts = Number.isFinite(raw.ts) ? raw.ts : Date.now();
  return {
    agent,
    event,
    notificationType,
    token,
    ts,
  };
}

function createTerminalAgentStatusService(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const runDir = options.runDir ?? resolveRunDirectory(home);
  const pid = options.pid ?? process.pid;
  const socketPath = options.socketPath ?? resolveSocketPath({ home, pid, platform, runDir });
  const listeners = new Set();
  let server = null;

  function onEvent(callback) {
    if (typeof callback === "function") {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
    return () => {};
  }

  function emitEvent(event) {
    const sanitized = sanitizeAgentEvent(event);
    if (!sanitized) return;
    listeners.forEach((listener) => {
      try {
        listener(sanitized);
      } catch (error) {
        options.logger?.(`terminal:agent-service:listener-error ${error?.message ?? error}`);
      }
    });
  }

  function start() {
    if (server) return Promise.resolve(socketPath);

    return new Promise((resolve, reject) => {
      if (platform !== "win32") {
        fs.mkdirSync(runDir, { mode: 0o700, recursive: true });
        cleanStaleSockets(runDir, pid);
        try {
          if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
          }
        } catch {
          /* ignore */
        }
      }

      server = net.createServer((socket) => {
        let buffer = "";
        socket.setEncoding("utf8");
        socket.setTimeout(500, () => {
          socket.destroy();
        });
        socket.on("data", (chunk) => {
          buffer += chunk;
          if (buffer.length > 32768) {
            socket.destroy();
          }
        });
        socket.on("end", () => {
          try {
            const trimmed = buffer.trim();
            if (trimmed) {
              const parsed = JSON.parse(trimmed);
              emitEvent(parsed);
            }
          } catch {
            /* ignore invalid payload */
          }
        });
        socket.on("error", () => {
          /* client socket error ignored */
        });
      });

      server.on("error", (err) => {
        options.logger?.(`terminal:agent-service:error ${err?.message ?? err}`);
        reject(err);
      });

      server.listen(socketPath, () => {
        if (platform !== "win32") {
          try {
            fs.chmodSync(socketPath, 0o600);
          } catch {
            /* ignore chmod error */
          }
        }
        resolve(socketPath);
      });
    });
  }

  function stop() {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => {
        server = null;
        if (platform !== "win32") {
          try {
            if (fs.existsSync(socketPath)) {
              fs.unlinkSync(socketPath);
            }
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
    });
  }

  return Object.freeze({
    getSocketPath: () => socketPath,
    onEvent,
    start,
    stop,
  });
}

module.exports = {
  cleanStaleSockets,
  createTerminalAgentStatusService,
  resolveRunDirectory,
  resolveSocketPath,
  sanitizeAgentEvent,
};
