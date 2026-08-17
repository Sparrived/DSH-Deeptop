import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { errorText } from "../app/model";
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

type TerminalDockProps = {
  workspace: string;
  collapsed: boolean;
  onToggle: () => void;
  onError: (message: string) => void;
};

export function TerminalDock({ workspace, collapsed, onToggle, onError }: TerminalDockProps) {
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pendingEventsRef = useRef(new Map<string, { text: string; exited: boolean }>());
  const aliveRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refreshTerminals = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listTerminals();
      setTerminals(next);
      setSelectedId((current) => next.some((terminal) => terminal.id === current) ? current : next[0]?.id ?? "");
    } catch (error) {
      setTerminals([]);
      setSelectedId("");
      onError(`读取终端列表失败：${errorText(error)}`);
    } finally {
      setLoading(false);
    }
  }, [onError]);

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
    const host = terminalHostRef.current;
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
      if (current) void writeTerminal(current, data).catch((error) => onErrorRef.current(`发送终端输入失败：${errorText(error)}`));
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
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setListenerReady(true);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const renderEvent = (event: { text: string; exited: boolean }) => {
      const terminal = terminalRef.current;
      if (event.exited) {
        terminal?.write("\r\n\x1b[90m[终端会话已结束]\x1b[0m\r\n");
        setExited(true);
        setSessionId(null);
        sessionRef.current = null;
      } else if (event.text) {
        terminal?.write(event.text);
      }
    };
    void listenToTerminalOutput((event) => {
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
    }).then((stop) => {
      if (cancelled) stop();
      else {
        unlisten = stop;
        setListenerReady(true);
      }
    }).catch((error) => onError(`连接终端输出失败：${errorText(error)}`));
    return () => {
      cancelled = true;
      unlisten?.();
      setListenerReady(false);
    };
  }, [onError]);

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
      onError("请先选择一个工作区，再启动终端");
      return;
    }
    if (!selectedTerminal) {
      onError("当前系统没有检测到可用终端");
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
          terminalRef.current?.write("\r\n\x1b[90m[终端会话已结束]\x1b[0m\r\n");
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
      onError(`启动内嵌终端失败：${errorText(error)}`);
    } finally {
      startingRef.current = false;
      setLaunching(false);
    }
  }, [listenerReady, onError, selectedTerminal, stopSession, terminalReady, workspace]);

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
      label="工作区终端"
      title="终端"
      kicker="当前工作区"
      icon="›_"
      total={sessionId ? "运行中" : terminals.length > 0 ? `${terminals.length} 个` : undefined}
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
            aria-label="选择内嵌终端"
            value={selectedTerminal?.id ?? ""}
            disabled={loading || launching || terminals.length === 0}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {terminals.length === 0 && <option value="">未检测到 shell</option>}
            {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
          </select>
          <button type="button" className="terminal-panel-refresh" onClick={() => void refreshTerminals()} disabled={loading || launching} title="重新检测 shell">⟳</button>
          <button type="button" className="terminal-panel-restart" onClick={() => void startSession()} disabled={!workspace || !selectedTerminal || loading || launching} title="重启终端会话">↻</button>
        </div>
        <span className="terminal-panel-path" title={workspace}>{workspace || "未选择工作目录"}</span>
      </div>
      <div ref={terminalHostRef} className="terminal-panel-terminal" aria-label="原生终端窗口" />
      {!workspace && <p className="terminal-panel-empty">选择工作区后，终端会直接显示在 Dock 内。</p>}
      {workspace && terminals.length === 0 && !loading && <p className="terminal-panel-empty">未检测到可内嵌 shell，请安装 bash、zsh 或 PowerShell。</p>}
      {workspace && exited && <p className="terminal-panel-empty">终端会话已结束，点击右上角 ↻ 重新启动。</p>}
    </DockFrame>
  );
}
