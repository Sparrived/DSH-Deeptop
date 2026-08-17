import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../app/model";
import {
  closeTerminal,
  isTauri,
  listenToTerminalOutput,
  listTerminals,
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

const MAX_TERMINAL_OUTPUT = 120_000;

export function TerminalDock({ workspace, collapsed, onToggle, onError }: TerminalDockProps) {
  const [terminals, setTerminals] = useState<TerminalOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [exited, setExited] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

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
    const viewport = outputRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listenToTerminalOutput((event) => {
      if (event.sessionId !== sessionRef.current) return;
      if (event.exited) {
        setExited(true);
        setSessionId(null);
        sessionRef.current = null;
        return;
      }
      if (event.text) {
        setOutput((current) => `${current}${event.text}`.slice(-MAX_TERMINAL_OUTPUT));
      }
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((error) => onError(`连接终端输出失败：${errorText(error)}`));
    return () => {
      cancelled = true;
      unlisten?.();
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
    if (startingRef.current) return;
    startingRef.current = true;
    setLaunching(true);
    try {
      await stopSession();
      setOutput("");
      setInput("");
      const started = await startTerminal(workspace, selectedTerminal.id);
      sessionRef.current = started.sessionId;
      targetRef.current = `${workspace}\u0000${selectedTerminal.id}`;
      setSessionId(started.sessionId);
      setExited(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) {
      onError(`启动内嵌终端失败：${errorText(error)}`);
    } finally {
      startingRef.current = false;
      setLaunching(false);
    }
  }, [onError, selectedTerminal, stopSession, workspace]);

  useEffect(() => {
    if (collapsed || !workspace || !selectedTerminal || sessionRef.current || exited) return;
    void startSession();
  }, [collapsed, exited, selectedTerminal, startSession, workspace]);

  useEffect(() => {
    if (!collapsed && sessionRef.current && targetRef.current !== `${workspace}\u0000${selectedTerminal?.id ?? ""}`) {
      void startSession();
    }
  }, [collapsed, selectedTerminal?.id, startSession, workspace]);

  useEffect(() => () => {
    const current = sessionRef.current;
    if (current) void closeTerminal(current);
  }, []);

  async function submitInput() {
    const current = sessionRef.current;
    const command = input;
    if (!current || !command.trim()) return;
    setInput("");
    try {
      await writeTerminal(current, `${command}\r\n`);
    } catch (error) {
      onError(`发送终端输入失败：${errorText(error)}`);
    }
  }

  return (
    <DockFrame
      id="terminal-dock"
      side="left"
      className="terminal-panel"
      collapsed={collapsed}
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
      <pre ref={outputRef} className="terminal-panel-output" aria-label="终端输出">{output || (launching ? "正在启动…" : !workspace ? "选择工作区后，终端会直接显示在这里。" : exited ? "终端会话已结束。" : "")}</pre>
      <form className="terminal-panel-input-row" onSubmit={(event) => { event.preventDefault(); void submitInput(); }}>
        <span aria-hidden="true">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
          disabled={!sessionId || launching || exited}
          placeholder={sessionId ? "输入命令并回车" : "终端尚未启动"}
          aria-label="终端输入"
        />
      </form>
      {!workspace && <p className="terminal-panel-empty">选择工作区后，终端会直接显示在 Dock 内。</p>}
      {workspace && terminals.length === 0 && !loading && <p className="terminal-panel-empty">未检测到可内嵌 shell，请安装 bash、zsh 或 PowerShell。</p>}
    </DockFrame>
  );
}
