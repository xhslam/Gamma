import { atom } from 'jotai'

export const isAgentTaskWindow = new URLSearchParams(globalThis.location?.search).get('window') === 'agent-task'
export const detachedAgentSessionsAtom = atom<ReadonlySet<string>>(new Set<string>())
