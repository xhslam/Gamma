// Preload renderer code only, never a hidden shell. The same promise is shared
// by list/restore and each session so their downloads can run in parallel.
function importTerminalRuntime() {
  return Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-search"),
    import("@xterm/addon-web-links"),
    import("@xterm/addon-unicode11"),
    import("@xterm/addon-webgl"),
  ]);
}

let runtime: ReturnType<typeof importTerminalRuntime> | null = null;

export function loadNotesTerminalRuntime() {
  runtime ??= importTerminalRuntime().catch((error: unknown) => {
    // A transient chunk failure must not poison later open/restart attempts.
    runtime = null;
    throw error;
  });
  return runtime;
}
