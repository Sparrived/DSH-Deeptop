import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { errorText } from "../app/model";
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

export function TerminalDock({ workspace, collapsed, locale = "zh", onToggle, onError }: TerminalDockProps) {
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [terminalHostElement, setTerminalHostElement] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pendingEventsRef = useRef(new Map<string, { text: string; exited: boolean }>());
  const aliveRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const refreshTerminals = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listTerminals();
      setTerminals(next);
      setSelectedId((current) => next.some((terminal) => terminal.id === current) ? current : next[0]?.id ?? "");
    } catch (error) {
      setTerminals([]);
      setSelectedId("");
      onError(t("terminal.errList", locale, { detail: errorText(error) }));
    } finally {
      setLoading(false);
    }
  }, [locale, onError]);

  useEffect(() => {
    void refreshTerminals();
  }, [refreshTerminals]);

  useEffect(() => {
    if (collapsed) return;
    void refreshTerminals();
  }, [collapsed, refreshTerminals]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      const current = sessionRef.current;
      sessionRef.current = null;
      if (current) void closeTerminal(current);
    };
  }, []);

  useEffect(() => {
    const host = terminalHostElement;
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
      theme: {
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
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const current = sessionRef.current;
      if (current) void resizeTerminal(current, cols, rows).catch(() => undefined);
    });
    const dataDisposable = terminal.onData((data) => {
      const current = sessionRef.current;
      if (current) void writeTerminal(current, data).catch((error) => onErrorRef.current(t("terminal.errInput", localeRef.current, { detail: errorText(error) })));
    });
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // The terminal can be measured while the Dock is hidden.
      }
    });
    resizeObserver.observe(host);
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Wait for the Dock to become visible before fitting again.
      }
    });

    return () => {
      resizeObserver.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminalReady(false);
    };
  }, [terminalHostElement]);

  useEffect(() => {
    if (!isTauri()) {
      setListenerReady(true);
      return;
    }
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const renderEvent = (event: { text: string; exited: boolean }) => {
      const terminal = terminalRef.current;
      if (event.exited) {
        terminal?.write(`\r\n\x1b[90m[${t("terminal.sessionExited", localeRef.current)}]\x1b[0m\r\n`);
        setExited(true);
        setSessionId(null);
        sessionRef.current = null;
      } else if (event.text) {
        terminal?.write(event.text);
      }
    };
    trackAsyncCleanup(cleanups, listenToTerminalOutput((event) => {
      if (cancelled) return;
      if (event.sessionId !== sessionRef.current) {
        const pending = pendingEventsRef.current.get(event.sessionId) ?? { text: "", exited: false };
        pending.text = `${pending.text}${event.text}`.slice(-64_000);
        pending.exited ||= event.exited;
        pendingEventsRef.current.set(event.sessionId, pending);
        while (pendingEventsRef.current.size > 8) {
          const oldest = pendingEventsRef.current.keys().next().value;
          if (oldest) pendingEventsRef.current.delete(oldest);
          else break;
        }
        return;
      }
      renderEvent(event);
    }), () => cancelled, () => {
      setListenerReady(true);
    }, (error) => onError(t("terminal.errConnect", locale, { detail: errorText(error) })));
    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      pendingEventsRef.current.clear();
      setListenerReady(false);
    };
  }, [locale, onError]);

  const selectedTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === selectedId) ?? terminals[0],
    [selectedId, terminals],
  );

  const stopSession = useCallback(async () => {
    const current = sessionRef.current;
    sessionRef.current = null;
    targetRef.current = null;
    setSessionId(null);
    setExited(false);
    if (current) await closeTerminal(current).catch(() => undefined);
  }, []);

  const startSession = useCallback(async () => {
    if (!workspace) {
      onError(t("terminal.errNoWorkspace", locale));
      return;
    }
    if (!selectedTerminal) {
      onError(t("terminal.errNoTerminal", locale));
      return;
    }
    if (!terminalReady || !listenerReady || startingRef.current) return;
    startingRef.current = true;
    setLaunching(true);
    try {
      await stopSession();
      terminalRef.current?.reset();
      const started = await startTerminal(workspace, selectedTerminal.id);
      if (!aliveRef.current) {
        await closeTerminal(started.sessionId).catch(() => undefined);
        return;
      }
      sessionRef.current = started.sessionId;
      targetRef.current = `${workspace}\u0000${selectedTerminal.id}`;
      setSessionId(started.sessionId);
      setExited(false);
      const pending = pendingEventsRef.current.get(started.sessionId);
      if (pending) {
        pendingEventsRef.current.delete(started.sessionId);
        terminalRef.current?.write(pending.text);
        if (pending.exited) {
          terminalRef.current?.write(`\r\n\x1b[90m[${t("terminal.sessionExited", locale)}]\x1b[0m\r\n`);
          setExited(true);
          setSessionId(null);
          sessionRef.current = null;
        }
      }
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // The ResizeObserver will retry when the viewport has dimensions.
        }
      });
    } catch (error) {
      onError(t("terminal.errStart", locale, { detail: errorText(error) }));
    } finally {
      startingRef.current = false;
      setLaunching(false);
    }
  }, [listenerReady, locale, onError, selectedTerminal, stopSession, terminalReady, workspace]);

  useEffect(() => {
    if (collapsed || !workspace || !selectedTerminal || sessionRef.current || exited) return;
    void startSession();
  }, [collapsed, exited, selectedTerminal, startSession, workspace]);

  useEffect(() => {
    if (!collapsed && sessionRef.current && targetRef.current !== `${workspace}\u0000${selectedTerminal?.id ?? ""}`) {
      void startSession();
    }
  }, [collapsed, selectedTerminal?.id, startSession, workspace]);

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
      icon="›_"
      total={sessionId ? t("terminal.running", locale) : terminals.length > 0 ? t("terminal.count", locale, { count: terminals.length }) : undefined}
      toggleGlyph="‹"
      onToggle={onToggle}
      railClassName="terminal-panel-rail"
      railMarkClassName="terminal-panel-rail-mark"
      headerMarkClassName="terminal-panel-mark"
      cardClassName="terminal-panel-card"
      headerClassName="terminal-panel-header"
      headingClassName="terminal-panel-heading"
      kickerClassName="terminal-panel-kicker"
      headerActionsClassName="terminal-panel-header-actions"
      totalClassName="terminal-panel-total"
      toggleClassName="terminal-panel-toggle"
      bodyClassName="terminal-panel-body"
    >
      <div className="terminal-panel-toolbar">
        <div className="terminal-panel-select-row">
          <select
            id="terminal-choice"
            aria-label={t("terminal.chooseShell", locale)}
            value={selectedTerminal?.id ?? ""}
            disabled={loading || launching || terminals.length === 0}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {terminals.length === 0 && <option value="">{t("terminal.noShell", locale)}</option>}
            {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
          </select>
          <button type="button" className="terminal-panel-refresh" onClick={() => void refreshTerminals()} disabled={loading || launching} title={t("terminal.redetect", locale)}>⟳</button>
          <button type="button" className="terminal-panel-restart" onClick={() => void startSession()} disabled={!workspace || !selectedTerminal || loading || launching} title={t("terminal.restart", locale)}>↻</button>
        </div>
        <span className="terminal-panel-path" title={workspace}>{workspace || t("terminal.noWorkspace", locale)}</span>
      </div>
      <div ref={setTerminalHostElement} className="terminal-panel-terminal" aria-label={t("terminal.nativeWindow", locale)} />
      {!workspace && <p className="terminal-panel-empty">{t("terminal.emptyHint", locale)}</p>}
      {workspace && terminals.length === 0 && !loading && <p className="terminal-panel-empty">{t("terminal.noEmbeddableShell", locale)}</p>}
      {workspace && exited && <p className="terminal-panel-empty">{t("terminal.sessionEnded", locale)}</p>}
    </DockFrame>
  );
}
