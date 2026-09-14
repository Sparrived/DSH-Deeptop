import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Plus, RotateCw, TerminalSquare, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { errorText } from "../app/model";
import { activeTabAfterClose, pruneUnavailableTabs, resetTabsForWorkspaceChange, type TerminalTabRecord } from "../app/terminal-model";
import { t, type UiLocale } from "../app/i18n";
import {
  closeTerminal,
  isTauri,
  listenToTerminalOutput,
  listTerminals,
  resizeTerminal,
  startTerminal,
  writeTerminal,
  type TerminalOption,
  type TerminalOutput,
} from "../lib/desktop";
import { DockFrame } from "./DockFrame";
import { trackAsyncCleanup } from "../lib/async-cleanup";

type TerminalDockProps = {
  workspace: string;
  collapsed: boolean;
  locale?: UiLocale;
  onToggle: () => void;
  onError: (message: string) => void;
};

type TerminalTab = TerminalTabRecord;

type TerminalViewProps = {
  tab: TerminalTab;
  active: boolean;
  locale: UiLocale;
  onError: (message: string) => void;
  onSession: (tabId: string, sessionId: string | null, exited: boolean) => void;
  registerOutputHandler: (tabId: string, handler: ((event: TerminalOutput) => void) | null) => void;
};

const terminalTheme = {
  background: "#111815",
  foreground: "#d8e7da",
  cursor: "#79d8a8",
  cursorAccent: "#111815",
  selectionBackground: "#335544",
  black: "#111815",
  brightBlack: "#718477",
  red: "#ff7b72",
  brightRed: "#ff9b94",
  green: "#79d8a8",
  brightGreen: "#a8f0c3",
  yellow: "#e8c47a",
  brightYellow: "#f5d99b",
  blue: "#8ab4f8",
  brightBlue: "#b1ccff",
  magenta: "#d2a8ff",
  brightMagenta: "#e2c6ff",
  cyan: "#79d8d8",
  brightCyan: "#a7eeee",
  white: "#d8e7da",
  brightWhite: "#ffffff",
};

function TerminalView({ tab, active, locale, onError, onSession, registerOutputHandler }: TerminalViewProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef(tab.sessionId);
  const onErrorRef = useRef(onError);
  const onSessionRef = useRef(onSession);
  const localeRef = useRef(locale);
  onErrorRef.current = onError;
  onSessionRef.current = onSession;
  localeRef.current = locale;

  useEffect(() => {
    sessionRef.current = tab.sessionId;
    if (tab.sessionId === null && !tab.exited) terminalRef.current?.reset();
  }, [tab.exited, tab.sessionId]);

  useEffect(() => {
    if (!host) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Mono", "JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const sessionId = sessionRef.current;
      if (sessionId) void resizeTerminal(sessionId, cols, rows).catch(() => undefined);
    });
    const dataDisposable = terminal.onData((data) => {
      const sessionId = sessionRef.current;
      if (sessionId) void writeTerminal(sessionId, data).catch((error) => onErrorRef.current(t("terminal.errInput", localeRef.current, { detail: errorText(error) })));
    });
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* Hidden tabs have no measurable viewport. */ }
    });
    resizeObserver.observe(host);
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* The observer retries once visible. */ }
    });

    const handleOutput = (event: TerminalOutput) => {
      if (event.text) terminal.write(event.text);
      if (event.exited) {
        terminal.write(`\r\n\x1b[90m[${t("terminal.sessionExited", localeRef.current)}]\x1b[0m\r\n`);
        sessionRef.current = null;
        onSessionRef.current(tab.id, null, true);
      }
    };
    registerOutputHandler(tab.id, handleOutput);

    return () => {
      registerOutputHandler(tab.id, null);
      resizeObserver.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [host, registerOutputHandler, tab.id]);

  useEffect(() => {
    if (!active || !terminalRef.current) return;
    requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch { /* Wait for the layout to settle. */ }
      terminalRef.current?.focus();
    });
  }, [active]);

  return <div ref={setHost} className="terminal-panel-terminal" hidden={!active} aria-label={t("terminal.nativeWindow", locale)} />;
}

export function TerminalDock({ workspace, collapsed, locale = "zh", onToggle, onError }: TerminalDockProps) {
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const tabsRef = useRef<TerminalTab[]>([]);
  const aliveRef = useRef(true);
  const startingRef = useRef(new Set<string>());
  const outputHandlersRef = useRef(new Map<string, (event: TerminalOutput) => void>());
  const pendingEventsRef = useRef(new Map<string, TerminalOutput>());
  const closedSessionsRef = useRef(new Set<string>());
  const lastWorkspaceRef = useRef(workspace);
  const workspaceGenerationRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  tabsRef.current = tabs;

  const registerOutputHandler = useCallback((tabId: string, handler: ((event: TerminalOutput) => void) | null) => {
    if (!handler) {
      outputHandlersRef.current.delete(tabId);
      return;
    }
    outputHandlersRef.current.set(tabId, handler);
    const sessionId = tabsRef.current.find((tab) => tab.id === tabId)?.sessionId;
    if (!sessionId) return;
    const pending = pendingEventsRef.current.get(sessionId);
    if (!pending) return;
    pendingEventsRef.current.delete(sessionId);
    requestAnimationFrame(() => {
      if (outputHandlersRef.current.get(tabId) === handler) handler(pending);
    });
  }, []);

  const refreshTerminals = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listTerminals();
      setTerminals(next);
    } catch (error) {
      setTerminals([]);
      onErrorRef.current(t("terminal.errList", locale, { detail: errorText(error) }));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => { void refreshTerminals(); }, [refreshTerminals]);
  useEffect(() => {
    if (!collapsed) void refreshTerminals();
  }, [collapsed, refreshTerminals]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      for (const tab of tabsRef.current) {
        if (tab.sessionId) {
          closedSessionsRef.current.add(tab.sessionId);
          void closeTerminal(tab.sessionId);
        }
      }
      outputHandlersRef.current.clear();
      pendingEventsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setListenerReady(true);
      return;
    }
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    trackAsyncCleanup(cleanups, listenToTerminalOutput((event) => {
      if (cancelled || closedSessionsRef.current.has(event.sessionId)) return;
      const target = tabsRef.current.find((tab) => tab.sessionId === event.sessionId);
      if (target) {
        const handler = outputHandlersRef.current.get(target.id);
        if (handler) handler(event);
        else {
          const pending = pendingEventsRef.current.get(event.sessionId) ?? { ...event, text: "" };
          pending.text = `${pending.text}${event.text}`.slice(-64_000);
          pending.exited ||= event.exited;
          pending.exitCode = event.exitCode;
          pendingEventsRef.current.set(event.sessionId, pending);
        }
        return;
      }
      const pending = pendingEventsRef.current.get(event.sessionId) ?? { ...event, text: "" };
      pending.text = `${pending.text}${event.text}`.slice(-64_000);
      pending.exited ||= event.exited;
      pending.exitCode = event.exitCode;
      pendingEventsRef.current.set(event.sessionId, pending);
      while (pendingEventsRef.current.size > 24) {
        const oldest = pendingEventsRef.current.keys().next().value;
        if (oldest) pendingEventsRef.current.delete(oldest);
        else break;
      }
    }), () => cancelled, () => setListenerReady(true), (error) => onErrorRef.current(t("terminal.errConnect", locale, { detail: errorText(error) })));
    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      setListenerReady(false);
    };
  }, [locale]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0], [activeTabId, tabs]);
  const activeTabIdResolved = activeTab?.id ?? "";

  const updateTab = useCallback((tabId: string, project: (tab: TerminalTab) => TerminalTab) => {
    setTabs((current) => current.map((tab) => tab.id === tabId ? project(tab) : tab));
  }, []);

  const closeTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;
    if (tab.sessionId) {
      closedSessionsRef.current.add(tab.sessionId);
      await closeTerminal(tab.sessionId).catch(() => undefined);
    }
    startingRef.current.delete(tabId);
    outputHandlersRef.current.delete(tabId);
    if (tab.sessionId) pendingEventsRef.current.delete(tab.sessionId);
    setTabs((current) => {
      const next = current.filter((item) => item.id !== tabId);
      if (activeTabIdResolved === tabId) setActiveTabId(activeTabAfterClose(current, tabId, activeTabIdResolved));
      return next;
    });
  }, [activeTabIdResolved]);

  const restartTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab?.sessionId) {
      closedSessionsRef.current.add(tab.sessionId);
      await closeTerminal(tab.sessionId).catch(() => undefined);
    }
    updateTab(tabId, (current) => ({ ...current, sessionId: null, exited: false }));
  }, [updateTab]);

  const startTab = useCallback(async (tab: TerminalTab) => {
    if (!workspace || !listenerReady || startingRef.current.has(tab.id) || tab.sessionId) return;
    if (!terminals.some((item) => item.id === tab.terminalId)) return;
    startingRef.current.add(tab.id);
    setLaunching(true);
    const workspaceGeneration = workspaceGenerationRef.current;
    try {
      const started = await startTerminal(workspace, tab.terminalId);
      closedSessionsRef.current.delete(started.sessionId);
      const currentTab = tabsRef.current.find((item) => item.id === tab.id);
      if (!aliveRef.current || workspaceGenerationRef.current !== workspaceGeneration || lastWorkspaceRef.current !== workspace || !currentTab || currentTab.terminalId !== tab.terminalId) {
        closedSessionsRef.current.add(started.sessionId);
        await closeTerminal(started.sessionId).catch(() => undefined);
        return;
      }
      updateTab(tab.id, (current) => ({ ...current, sessionId: started.sessionId, exited: false }));
    } catch (error) {
      onErrorRef.current(t("terminal.errStart", locale, { detail: errorText(error) }));
    } finally {
      startingRef.current.delete(tab.id);
      setLaunching(startingRef.current.size > 0);
    }
  }, [listenerReady, locale, terminals, updateTab, workspace]);

  const addTab = useCallback(() => {
    const selectedTerminal = terminals[0];
    if (!workspace) {
      onErrorRef.current(t("terminal.errNoWorkspace", locale));
      return;
    }
    if (!selectedTerminal) {
      onErrorRef.current(t("terminal.errNoTerminal", locale));
      return;
    }
    if (launching) return;
    const tab: TerminalTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      terminalId: selectedTerminal.id,
      sessionId: null,
      exited: false,
    };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, [launching, locale, terminals, workspace]);

  const changeShell = useCallback(async (tab: TerminalTab, terminalId: string) => {
    if (tab.terminalId === terminalId) return;
    if (tab.sessionId) {
      closedSessionsRef.current.add(tab.sessionId);
      await closeTerminal(tab.sessionId).catch(() => undefined);
    }
    updateTab(tab.id, (current) => ({ ...current, terminalId, sessionId: null, exited: false }));
  }, [updateTab]);

  useEffect(() => {
    const available = terminals.map((terminal) => terminal.id);
    const removed = tabsRef.current.filter((tab) => !available.includes(tab.terminalId));
    removed.forEach((tab) => {
      if (tab.sessionId) {
        closedSessionsRef.current.add(tab.sessionId);
        void closeTerminal(tab.sessionId);
      }
    });
    const next = pruneUnavailableTabs(tabs, available, activeTabId);
    if (next.tabs.length !== tabs.length) setTabs(next.tabs);
    if (next.activeId !== activeTabId) setActiveTabId(next.activeId);
  }, [activeTabId, tabs, terminals]);

  useEffect(() => {
    if (resetTabsForWorkspaceChange(lastWorkspaceRef.current, workspace)) {
      lastWorkspaceRef.current = workspace;
      workspaceGenerationRef.current += 1;
      for (const tab of tabsRef.current) {
        if (tab.sessionId) {
          closedSessionsRef.current.add(tab.sessionId);
          void closeTerminal(tab.sessionId);
        }
      }
      setTabs([]);
      setActiveTabId("");
      pendingEventsRef.current.clear();
      return;
    }
    if (collapsed || !listenerReady || !workspace || !terminals[0]) return;
    if (!activeTab) {
      addTab();
      return;
    }
    if (!activeTab.sessionId && !activeTab.exited) void startTab(activeTab);
  }, [activeTab, addTab, collapsed, listenerReady, startTab, terminals, workspace]);

  const tabName = (tab: TerminalTab) => terminals.find((terminal) => terminal.id === tab.terminalId)?.name ?? t("terminal.unknownShell", locale);

  return (
    <DockFrame
      id="terminal-dock"
      side="left"
      className="terminal-panel"
      collapsed={collapsed}
      keepBodyMounted
      label={t("terminal.label", locale)}
      title={t("terminal.title", locale)}
      kicker={t("terminal.kicker", locale)}
       icon={<TerminalSquare />}
       toggleGlyph={<ChevronLeft />}
      onToggle={onToggle}
      railClassName="terminal-panel-rail"
      railMarkClassName="terminal-panel-rail-mark"
      headerMarkClassName="terminal-panel-mark"
      cardClassName="terminal-panel-card"
      headerClassName="terminal-panel-header"
      headingClassName="terminal-panel-heading"
      kickerClassName="terminal-panel-kicker"
      headerActionsClassName="terminal-panel-header-actions"
      toggleClassName="terminal-panel-toggle"
      bodyClassName="terminal-panel-body"
    >
      <div className="terminal-panel-toolbar">
        <div className="terminal-panel-tabs" role="tablist" aria-label={t("terminal.tabsAria", locale)}>
          {tabs.map((tab, index) => (
            <div key={tab.id} className={`terminal-panel-tab${tab.id === activeTabIdResolved ? " active" : ""}${tab.exited ? " exited" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabIdResolved}
                aria-controls={`terminal-view-${tab.id}`}
                data-terminal-tab={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                title={tabName(tab)}
              >
                <span className="terminal-panel-tab-index">{index + 1}</span>
                <span className="terminal-panel-tab-name">{tabName(tab)}</span>
                {tab.sessionId && <span className="terminal-panel-tab-status" aria-label={t("terminal.running", locale)} />}
              </button>
              <button type="button" className="terminal-panel-tab-close" onClick={() => void closeTab(tab.id)} aria-label={t("terminal.closeTab", locale, { name: tabName(tab) })} title={t("terminal.closeTab", locale, { name: tabName(tab) })}><X aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className="terminal-panel-new" onClick={addTab} disabled={loading || launching || !workspace || terminals.length === 0} aria-label={t("terminal.newTab", locale)} title={t("terminal.newTab", locale)}><Plus aria-hidden="true" /></button>
        </div>
        <div className="terminal-panel-select-row">
          <select
            aria-label={t("terminal.chooseShell", locale)}
            value={activeTab?.terminalId ?? terminals[0]?.id ?? ""}
            disabled={loading || launching || !activeTab || terminals.length === 0}
            onChange={(event) => { if (activeTab) void changeShell(activeTab, event.target.value); }}
          >
            {terminals.length === 0 && <option value="">{t("terminal.noShell", locale)}</option>}
            {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
          </select>
          <button type="button" className="terminal-panel-restart" onClick={() => activeTab && void restartTab(activeTab.id)} disabled={!activeTab || loading || launching} title={t("terminal.restart", locale)}><RotateCw aria-hidden="true" /></button>
        </div>
        <span className="terminal-panel-path" title={workspace}>{workspace || t("terminal.noWorkspace", locale)}</span>
      </div>
      <div className="terminal-panel-views">
        {tabs.map((tab) => <div key={tab.id} id={`terminal-view-${tab.id}`} role="tabpanel" aria-hidden={tab.id !== activeTabIdResolved}>
          <TerminalView
            tab={tab}
            active={tab.id === activeTabIdResolved}
            locale={locale}
            onError={onError}
            onSession={(tabId, sessionId, exited) => updateTab(tabId, (current) => ({ ...current, sessionId, exited }))}
            registerOutputHandler={registerOutputHandler}
          />
          {workspace && tab.exited && tab.id === activeTabIdResolved && <p className="terminal-panel-empty">{t("terminal.sessionEnded", locale)}</p>}
        </div>)}
      </div>
      {!workspace && <p className="terminal-panel-empty">{t("terminal.emptyHint", locale)}</p>}
      {workspace && terminals.length === 0 && !loading && <p className="terminal-panel-empty">{t("terminal.noEmbeddableShell", locale)}</p>}
    </DockFrame>
  );
}
