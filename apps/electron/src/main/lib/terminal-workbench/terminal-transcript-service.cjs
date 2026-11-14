"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const LIMIT = 2 * 1024 * 1024;

function cleanUserPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  let text = prompt.trim();
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (match) {
    text = match[1].trim();
  }
  return text || null;
}

function extractToolNames(value) {
  const names = [];
  if (Array.isArray(value.tool_calls)) {
    for (const call of value.tool_calls) {
      const name = call?.name || call?.function?.name || call?.tool_name;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return names;
}

function extractUserPrompt(value) {
  if (value.type === "USER_INPUT" && typeof value.content === "string") {
    return cleanUserPrompt(value.content);
  }
  if (value.type === "user") {
    if (typeof value.text === "string") return cleanUserPrompt(value.text);
    if (Array.isArray(value.message?.content)) {
      const texts = value.message.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text);
      if (texts.length) return cleanUserPrompt(texts.join("\n"));
    }
  }
  if (value.type === "response_item" && value.payload?.role === "user") {
    if (Array.isArray(value.payload.content)) {
      const texts = value.payload.content
        .filter((part) => part?.type === "input_text" && typeof part.text === "string")
        .map((part) => part.text);
      if (texts.length) return cleanUserPrompt(texts.join("\n"));
    }
  }
  return null;
}

function parseTranscript(data) {
  const messages = new Map();
  const lines = data.split("\n");
  lines.pop(); // An incomplete final record must wait for the next read.
  let pendingPrompt = null;
  let pendingTools = [];
  for (const [lineIndex, line] of lines.entries()) {
    try {
      const value = JSON.parse(line);
      const prompt = extractUserPrompt(value);
      if (prompt) {
        pendingPrompt = prompt;
        pendingTools = [];
        continue;
      }
      const tools = extractToolNames(value);
      if (tools.length) {
        pendingTools.push(...tools);
      }
      // Antigravity's persisted trajectory is not a Claude/Codex message envelope.
      // Only completed model replies are public text; thinking and tool_calls stay private.
      if (value.type === "PLANNER_RESPONSE" && value.source === "MODEL" && value.status === "DONE" && typeof value.content === "string") {
        const id = `antigravity:${value.step_index ?? value.created_at ?? lineIndex}`;
        const item = { id, text: value.content.slice(0, 100_000) };
        if (pendingPrompt) item.userPrompt = pendingPrompt;
        if (pendingTools.length) item.toolCalls = [...pendingTools];
        pendingPrompt = null;
        pendingTools = [];
        messages.set(id, item);
        continue;
      }
      const message = value.type === "assistant" ? value.message :
        value.type === "response_item" && value.payload?.type === "message" ? value.payload : null;
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      message.content.forEach((part, index) => {
        if (!["text", "output_text"].includes(part?.type) || typeof part.text !== "string") return;
        const id = `${value.uuid ?? message.id ?? value.timestamp ?? lineIndex}:${index}`;
        const item = { id, text: part.text.slice(0, 100_000) };
        if (pendingPrompt) item.userPrompt = pendingPrompt;
        if (pendingTools.length) item.toolCalls = [...pendingTools];
        pendingPrompt = null;
        pendingTools = [];
        messages.set(id, item);
      });
    } catch { /* Unknown, malformed and partial records do not stop following messages. */ }
  }
  return [...messages.values()].slice(-100);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addSessionHook(config, command) {
  if (!plainObject(config)) throw new Error("CLI configuration must be an object.");
  if (config.hooks === undefined) config.hooks = {};
  if (!plainObject(config.hooks)) throw new Error("CLI hooks must be an object.");
  if (config.hooks.SessionStart === undefined) config.hooks.SessionStart = [];
  if (!Array.isArray(config.hooks.SessionStart)) throw new Error("SessionStart hooks must be an array.");
  if (config.hooks.SessionStart.some((group) => group?.hooks?.some?.((hook) => hook.command === command))) return false;
  config.hooks.SessionStart.push({ hooks: [{ type: "command", command, timeout: 5 }] });
  return true;
}

function addAntigravityHooks(config, command) {
  if (!plainObject(config)) throw new Error("Antigravity hooks must be an object.");
  const name = "auris-terminal-transcript";
  if (config[name] === undefined) config[name] = {};
  const hook = config[name];
  if (!plainObject(hook)) throw new Error("Invalid Auris Antigravity hook.");
  let changed = false;
  for (const event of ["PreInvocation", "PostInvocation"]) {
    if (hook[event] === undefined) hook[event] = [];
    if (!Array.isArray(hook[event])) throw new Error(`Antigravity ${event} hooks must be an array.`);
    if (hook[event].some((handler) => handler?.command === command)) continue;
    hook[event].push({ type: "command", command, timeout: 5 });
    changed = true;
  }
  return changed;
}

function atomicWrite(file, data, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { mode, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function confined(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

async function readRegularFile(file, limit, expectedRoots, previous) {
  const canonical = await fsp.realpath(file);
  if (expectedRoots) {
    const roots = await Promise.all(expectedRoots.map(({ directory }) => fsp.realpath(directory).catch(() => null)));
    if (path.extname(canonical) !== ".jsonl" || !roots.some((root, index) => root && confined(root, canonical) &&
      (!expectedRoots[index].pattern || expectedRoots[index].pattern.test(path.relative(root, canonical).split(path.sep).join("/"))))) {
      throw new Error("Transcript outside CLI session directories.");
    }
  } else if (canonical !== file) {
    throw new Error("Transcript binding must not be a symlink.");
  }
  const before = await fsp.stat(canonical);
  if (!before.isFile()) throw new Error("Transcript must be a regular file.");
  const handle = await fsp.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error("Transcript file changed during open.");
    if (!expectedRoots && stat.size > limit) throw new Error("Transcript binding too large.");
    const revision = createHash("sha256").update(`${canonical}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).digest("hex");
    if (previous === revision) return { data: null, revision };
    const offset = Math.max(0, stat.size - limit);
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    let data = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset > 0) data = data.includes("\n") ? data.slice(data.indexOf("\n") + 1) : "";
    return { data, revision };
  } finally { await handle.close(); }
}

function createTerminalTranscriptService({ directory, homeDirectory, env = process.env, platform = process.platform }) {
  directory = path.resolve(directory);
  const claude = path.resolve(env.CLAUDE_CONFIG_DIR || path.join(homeDirectory, ".claude"));
  const codex = path.resolve(env.CODEX_HOME || path.join(homeDirectory, ".codex"));
  const antigravity = path.join(homeDirectory, ".gemini");
  const roots = [
    { directory: path.join(claude, "projects") },
    { directory: path.join(codex, "sessions") },
    // Installed agy reports transcript_full.jsonl; public docs show transcript.jsonl.
    { directory: path.join(antigravity, "antigravity-cli", "brain"), pattern: /^[a-f0-9-]{36}\/\.system_generated\/logs\/transcript(?:_full)?\.jsonl$/i },
  ];
  const bindings = new Map();
  const sessionStates = new Map();
  let generation = 0;
  const marker = path.join(directory, "enabled");
  const isEnabled = () => fs.existsSync(marker);
  function configure(enabled) {
    if (typeof enabled !== "boolean") throw new Error("Transcript enabled must be boolean.");
    generation++;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(directory) !== directory) throw new Error("Transcript directory must not be a symlink.");
    if (!enabled) {
      sessionStates.clear();
      try { fs.unlinkSync(marker); } catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const token of bindings.values()) {
        try { fs.unlinkSync(path.join(directory, `${token}.json`)); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      return { enabled: false };
    }
    const script = path.join(directory, "terminal-transcript-hook.cjs");
    if (platform === "win32" && /["%\r\n]/u.test(script)) throw new Error("Unsupported transcript hook path.");
    const command = platform === "win32" ? `node "${script}"` : `node '${script.replaceAll("'", "'\\''")}'`;
    // Validate every provider before writing any configuration. Preserve invalid files.
    const updates = [
      { file: path.join(claude, "settings.json"), add: addSessionHook, command },
      { file: path.join(codex, "hooks.json"), add: addSessionHook, command },
      { file: path.join(antigravity, "config", "hooks.json"), add: addAntigravityHooks, command: `${command} --antigravity` },
    ].map(({ file, add, command: providerCommand }) => {
      let config = {};
      let mode = 0o600;
      if (fs.existsSync(file)) {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > LIMIT) throw new Error("Invalid CLI configuration file.");
        mode = stat.mode & 0o777;
        config = JSON.parse(fs.readFileSync(file, "utf8"));
      }
      return { file, mode, config, changed: add(config, providerCommand) };
    });
    atomicWrite(script, fs.readFileSync(path.join(__dirname, "terminal-transcript-hook.cjs")));
    for (const { file, mode, config, changed } of updates) {
      if (!changed) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWrite(file, `${JSON.stringify(config, null, 2)}\n`, mode);
    }
    atomicWrite(marker, "enabled");
    return { enabled: true };
  }
  function sessionEnvironment(sessionId) {
    const token = randomUUID();
    forget(sessionId);
    bindings.set(sessionId, token);
    return { AURIS_TRANSCRIPT_TOKEN: token };
  }
  function forget(sessionId) {
    const token = bindings.get(sessionId);
    bindings.delete(sessionId);
    sessionStates.delete(sessionId);
    if (token) { try { fs.unlinkSync(path.join(directory, `${token}.json`)); } catch {} }
  }
  async function read(sessionId, previous) {
    const token = bindings.get(sessionId);
    const currentGeneration = generation;
    if (!token || !isEnabled()) return null;
    try {
      const binding = await readRegularFile(path.join(directory, `${token}.json`), 65536);
      const file = JSON.parse(binding.data).path;
      if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("Invalid transcript path.");
      const canonical = await fsp.realpath(file);
      const rootList = await Promise.all(roots.map(({ directory: d }) => fsp.realpath(d).catch(() => null)));
      if (path.extname(canonical) !== ".jsonl" || !rootList.some((root, index) => root && confined(root, canonical) &&
        (!roots[index].pattern || roots[index].pattern.test(path.relative(root, canonical).split(path.sep).join("/"))))) {
        throw new Error("Transcript outside CLI session directories.");
      }
      const before = await fsp.stat(canonical);
      if (!before.isFile()) throw new Error("Transcript must be a regular file.");
      const handle = await fsp.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) {
          throw new Error("Transcript file changed during open.");
        }
        const revision = createHash("sha256").update(`${canonical}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).digest("hex");
        if (previous === revision) return { revision, messages: null };

        let state = sessionStates.get(sessionId);
        const canIncrement = state &&
          state.canonical === canonical &&
          state.dev === stat.dev &&
          state.ino === stat.ino &&
          stat.size >= state.lastOffset;

        if (!canIncrement) {
          state = {
            canonical,
            dev: stat.dev,
            ino: stat.ino,
            lastOffset: 0,
            leftover: "",
            messages: new Map(),
            pendingPrompt: null,
            pendingTools: [],
          };
          sessionStates.set(sessionId, state);
        }

        let offset = state.lastOffset;
        if (!canIncrement && stat.size > LIMIT) {
          offset = Math.max(0, stat.size - LIMIT);
        }
        const bytesToRead = Math.max(0, stat.size - offset);
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, offset);
        let chunk = buffer.subarray(0, bytesRead).toString("utf8");

        if (!canIncrement && offset > 0) {
          chunk = chunk.includes("\n") ? chunk.slice(chunk.indexOf("\n") + 1) : "";
        } else if (state.leftover) {
          chunk = state.leftover + chunk;
        }

        const lastNewline = chunk.lastIndexOf("\n");
        if (lastNewline !== -1) {
          state.leftover = chunk.slice(lastNewline + 1);
          const lines = chunk.slice(0, lastNewline).split("\n");
          for (const line of lines) {
            try {
              const value = JSON.parse(line);
              const prompt = extractUserPrompt(value);
              if (prompt) {
                state.pendingPrompt = prompt;
                state.pendingTools = [];
                continue;
              }
              const tools = extractToolNames(value);
              if (tools.length) {
                state.pendingTools.push(...tools);
              }
              if (value.type === "PLANNER_RESPONSE" && value.source === "MODEL" && value.status === "DONE" && typeof value.content === "string") {
                const id = `antigravity:${value.step_index ?? value.created_at ?? state.messages.size}`;
                const item = { id, text: value.content.slice(0, 100_000) };
                if (state.pendingPrompt) item.userPrompt = state.pendingPrompt;
                if (state.pendingTools.length) item.toolCalls = [...state.pendingTools];
                state.pendingPrompt = null;
                state.pendingTools = [];
                state.messages.set(id, item);
                continue;
              }
              const message = value.type === "assistant" ? value.message :
                value.type === "response_item" && value.payload?.type === "message" ? value.payload : null;
              if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
              message.content.forEach((part, index) => {
                if (!["text", "output_text"].includes(part?.type) || typeof part.text !== "string") return;
                const id = `${value.uuid ?? message.id ?? value.timestamp ?? state.messages.size}:${index}`;
                const item = { id, text: part.text.slice(0, 100_000) };
                if (state.pendingPrompt) item.userPrompt = state.pendingPrompt;
                if (state.pendingTools.length) item.toolCalls = [...state.pendingTools];
                state.pendingPrompt = null;
                state.pendingTools = [];
                state.messages.set(id, item);
              });
            } catch {}
          }
        } else {
          state.leftover = chunk;
        }
        state.lastOffset = stat.size;

        if (bindings.get(sessionId) !== token || generation !== currentGeneration || !isEnabled()) return null;
        // Paths and opaque binding tokens never cross the IPC boundary.
        return { revision, messages: [...state.messages.values()].slice(-100) };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error("执行记录不可用：请检查 CLI 生命周期钩子与本地会话目录。", { cause: error });
    }
  }
  return { configure, forget, isEnabled, read, sessionEnvironment };
}

module.exports = { addSessionHook, createTerminalTranscriptService, parseTranscript };
