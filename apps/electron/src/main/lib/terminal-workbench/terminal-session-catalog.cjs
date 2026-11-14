"use strict";
const { normalizeTerminalTitle } = require("./terminal-session-policy.cjs");

// Recovery is a catalogue of tabs, not a request to start every old Shell.
// The selected tab is resumed through main's existing trusted spawn policy.
// Dormant records never claim to be a live PTY or lose another workspace's tab.
function createTerminalSessionCatalog({ store, manager }) {
  let dormant = null;
  const titles = new Map();
  function descriptors() {
    if (!dormant) {
      dormant = new Map(store.load().map((record) => [record.id, record]));
      for (const record of dormant.values()) if (record.customTitle) titles.set(record.id, normalizeTerminalTitle(record.customTitle));
    }
    return dormant;
  }
  function withTitle(record) {
    if (!record) return record;
    return titles.has(record.id) ? { ...record, customTitle: titles.get(record.id) } : record;
  }
  function list() {
    const live = manager.listSessions();
    const liveIds = new Set(live.map((record) => record.id));
    return [
      ...[...descriptors().values()]
        .filter((record) => !liveIds.has(record.id))
        .map((record) => ({
          ...record,
          backend: null,
          ptyPackage: null,
          output: "",
          outputSequence: 0,
          agentState: "idle",
          agentStateUpdatedAt: Date.now(),
          agentKind: null,
          unread: false,
        })),
      ...live,
    ].map(withTitle);
  }
  return Object.freeze({
    list,
    get: (id) => withTitle(descriptors().get(id)),
    withTitle,
    rename: (id, title) => {
      descriptors();
      const normalized = normalizeTerminalTitle(title);
      titles.set(id, normalized);
      return normalized;
    },
    created: (record) => {
      descriptors().delete(record.id);
      if (record.customTitle !== undefined) titles.set(record.id, normalizeTerminalTitle(record.customTitle));
    },
    remove: (id) => { descriptors().delete(id); titles.delete(id); },
    persist: () => {
      const live = manager.listSessions();
      const liveIds = new Set(live.map((record) => record.id));
      return store.save([
        ...[...descriptors().values()].filter((record) => !liveIds.has(record.id)),
        ...live,
      ].map(withTitle));
    },
  });
}

module.exports = { createTerminalSessionCatalog };
