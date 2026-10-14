/** 真实侧栏回归与临时视觉预览共用的隔离入口；所有 IPC 数据均来自内存。 */
export const leftSidebarFixtureSource = `
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Provider, createStore } from 'jotai'
  import { LeftSidebar } from '@/components/app-shell/LeftSidebar'
  import { TooltipProvider } from '@/components/ui/tooltip'
  import { appModeAtom } from '@/atoms/app-mode'
  import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
  import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
  import {
    agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom,
    agentWorkspacesAtom, agentDiffPanelTabAtom, agentSideDelegationMapAtom,
    agentSidePanelOpenMapAtom, agentSessionComponentTabsAtomFamily,
  } from '@/atoms/agent-atoms'
  import { tabsAtom, activeTabIdAtom, sidebarCollapsedAtom } from '@/atoms/tab-atoms'
  import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
  import { searchDialogOpenAtom } from '@/atoms/search-atoms'
  import { updateStatusAtom } from '@/atoms/updater'
  import { planningTabAtom } from '@/atoms/planning-atoms'
  import { productivityToolsAtom } from '@/atoms/ui-preferences'
  import '@/styles/globals.css'

  document.head.insertAdjacentHTML('beforeend', '<style>html,body,#root{height:100%;margin:0}#root{display:flex;height:100vh}</style>');
  const rendererErrors = [];
  window.addEventListener('error', event => rendererErrors.push(event.message));
  window.addEventListener('unhandledrejection', event => rendererErrors.push(String(event.reason)));
  const delay = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await delay(10); }
    throw new Error('侧栏未达到预期状态：' + document.body.innerText.slice(0, 800) + rendererErrors.join('; '));
  };
  const now = Date.now();
  const workspaces = [
    { id: 'project-a', name: 'Gamma 项目', slug: 'gamma-project', createdAt: now, updatedAt: now },
    { id: 'project-b', name: '第二个项目', slug: 'second-project', createdAt: now, updatedAt: now },
  ];
  const agents = [
    { id: 'parent', title: '整理研究资料', workspaceId: 'project-a', createdAt: now, updatedAt: now },
    { id: 'child', title: '核对引用来源', workspaceId: 'project-a', parentSessionId: 'parent', sourceDelegationId: 'delegation', rootSessionId: 'parent', createdAt: now, updatedAt: now },
    { id: 'other', title: '检查第二个项目', workspaceId: 'project-b', createdAt: now, updatedAt: now },
  ];
  const chats = [
    { id: 'chat-a', title: '产品想法', createdAt: now, updatedAt: now },
    { id: 'chat-b', title: '另一段对话', createdAt: now, updatedAt: now },
  ];

  window.leftSidebarRegression = {
    until, delay,
    async mount(options = {}) {
      localStorage.clear();
      document.documentElement.classList.toggle('dark', !!options.dark);
      const store = createStore(), root = createRoot(document.getElementById('root')), calls = [];
      const fixtureAgents = options.agents ?? agents, fixtureChats = options.chats ?? chats;
      const fixtureWorkspaces = options.workspaces ?? workspaces;
      const activeAgent = options.activeAgent === undefined ? (fixtureAgents[0]?.id ?? null) : options.activeAgent;
      const activeChat = options.activeChat === undefined ? (fixtureChats[0]?.id ?? null) : options.activeChat;
      const mode = options.mode ?? 'agent';
      const profile = { userName: options.userName ?? 'Gamma 用户', avatar: '🌱' };
      window.electronAPI = {
        listActiveAgentSessions: async () => fixtureAgents.filter(session => !session.archived),
        countArchivedAgentSessions: async () => fixtureAgents.filter(session => session.archived).length,
        listArchivedAgentSessions: async () => fixtureAgents.filter(session => session.archived),
        listConversations: async () => fixtureChats,
        getUserProfile: async () => profile,
        getWorkspaceCapabilities: async () => ({ mcpServers: [], skills: [] }),
        updateSettings: async settings => { calls.push(settings); },
      };
      store.set(appModeAtom, mode);
      store.set(conversationsAtom, fixtureChats);
      store.set(agentSessionsAtom, fixtureAgents);
      store.set(agentWorkspacesAtom, fixtureWorkspaces);
      store.set(currentAgentWorkspaceIdAtom, fixtureWorkspaces[0]?.id ?? '');
      store.set(currentAgentSessionIdAtom, activeAgent);
      store.set(currentConversationIdAtom, activeChat);
      store.set(sidebarCollapsedAtom, !!options.collapsed);
      store.set(productivityToolsAtom, { todosEnabled: true, calendarEnabled: true });
      store.set(updateStatusAtom, options.update ?? { status: 'idle' });
      store.set(activeViewAtom, 'conversations');
      const activeId = mode === 'agent' ? activeAgent : activeChat;
      store.set(tabsAtom, activeId ? [{ id: activeId, sessionId: activeId, type: mode, title: '当前会话' }] : []);
      store.set(activeTabIdAtom, activeId);
      root.render(React.createElement(Provider, { store }, React.createElement(TooltipProvider, null,
        React.createElement(LeftSidebar, { width: options.width ?? 256, noTransition: true }))));
      await until(() => document.querySelector('.gamma-sidebar'));
      await delay(80);
      return {
        root, calls,
        button: label => document.querySelector('button[aria-label="' + label + '"]'),
        row: id => document.querySelector('[data-session-switch-id="' + id + '"]'),
        state: () => ({
          mode: store.get(appModeAtom), agent: store.get(currentAgentSessionIdAtom), chat: store.get(currentConversationIdAtom),
          workspace: store.get(currentAgentWorkspaceIdAtom), activeTab: store.get(activeTabIdAtom),
          view: store.get(activeViewAtom), planning: store.get(planningTabAtom), capability: store.get(agentSkillsTabAtom),
          workspaceTab: store.get(agentDiffPanelTabAtom).get(store.get(currentAgentSessionIdAtom)),
          componentTabs: store.get(agentSessionComponentTabsAtomFamily(store.get(currentAgentSessionIdAtom) ?? '')),
          delegation: store.get(agentSideDelegationMapAtom).get(store.get(currentAgentSessionIdAtom)),
          workspaceOpen: store.get(agentSidePanelOpenMapAtom)[store.get(currentAgentSessionIdAtom)],
          collapsed: store.get(sidebarCollapsedAtom), settings: store.get(settingsOpenAtom), settingsTab: store.get(settingsTabAtom),
          search: store.get(searchDialogOpenAtom),
        }),
        closeSettings: () => store.set(settingsOpenAtom, false),
      };
    },
  };
`;
