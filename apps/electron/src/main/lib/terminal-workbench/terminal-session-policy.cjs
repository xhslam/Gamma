const path = require("node:path");

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_WORKSPACE_INSTANCE_ID_LENGTH = 1024;

function normalizeTerminalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTerminalTitle(value) {
  if (typeof value !== "string") return null;
  const title = [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()].slice(0, 64).join("");
  return title || null;
}

function normalizeTerminalSize(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeWorkspaceInstanceId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized &&
    normalized.length <= MAX_WORKSPACE_INSTANCE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(normalized)
    ? normalized
    : null;
}

function getPathAdapter(...values) {
  return values.some(
    (value) =>
      typeof value === "string" &&
      (/^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\")),
  )
    ? path.win32
    : path;
}

function resolveInsideRoot(pathAdapter, rootPath, candidatePath) {
  const resolvedRoot = pathAdapter.resolve(rootPath);
  const resolvedCandidate = pathAdapter.resolve(candidatePath);
  const relativePath = pathAdapter.relative(resolvedRoot, resolvedCandidate);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !pathAdapter.isAbsolute(relativePath))
  ) {
    return resolvedCandidate;
  }

  return resolvedRoot;
}

function resolveTerminalCwd({ homePath, requestedCwd, vaultPath }) {
  const normalizedHome = normalizeTerminalString(homePath);
  const normalizedVault = normalizeTerminalString(vaultPath);
  const normalizedRequested = normalizeTerminalString(requestedCwd);
  const fallback = normalizedVault ?? normalizedHome;

  if (!fallback) {
    throw new Error("Terminal cwd requires either a vault path or a home path.");
  }

  if (!normalizedRequested || !normalizedVault) {
    return fallback;
  }

  const pathAdapter = getPathAdapter(normalizedVault, normalizedRequested);
  return resolveInsideRoot(pathAdapter, normalizedVault, normalizedRequested);
}

function createTerminalSessionInput(input, context) {
  const workspaceInstanceId = normalizeWorkspaceInstanceId(
    input?.workspaceInstanceId,
  );
  return {
    cols: normalizeTerminalSize(input?.cols, DEFAULT_COLS),
    cwd: resolveTerminalCwd({
      homePath: context.homePath,
      requestedCwd: input?.cwd,
      vaultPath: context.vaultPath,
    }),
    rows: normalizeTerminalSize(input?.rows, DEFAULT_ROWS),
    sessionId: normalizeTerminalString(input?.sessionId) ?? undefined,
    ...(workspaceInstanceId ? { workspaceInstanceId } : {}),
  };
}

module.exports = {
  createTerminalSessionInput,
  normalizeTerminalString,
  normalizeTerminalTitle,
  normalizeTerminalSize,
  normalizeWorkspaceInstanceId,
  resolveTerminalCwd,
};
