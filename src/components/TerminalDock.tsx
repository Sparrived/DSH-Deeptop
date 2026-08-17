import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "../app/model";
import { listTerminals, openTerminal, type TerminalOption } from "../lib/desktop";
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
    if (!collapsed) void refreshTerminals();
  }, [collapsed, refreshTerminals]);

  const selectedTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === selectedId) ?? terminals[0],
    [selectedId, terminals],
  );

  async function launch() {
    if (!workspace) {
      onError("请先选择一个工作区，再启动终端");
      return;
    }
    if (!selectedTerminal) {
      onError("当前系统没有检测到可用终端");
      return;
    }
    setLaunching(true);
    try {
      await openTerminal(workspace, selectedTerminal.id);
    } catch (error) {
      onError(`启动终端失败：${errorText(error)}`);
    } finally {
      setLaunching(false);
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
      total={terminals.length > 0 ? terminals.length : undefined}
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
      <div className="terminal-panel-summary">
        <span className="terminal-panel-live">{loading ? "检测中…" : `${terminals.length} 个可用终端`}</span>
        <span className="terminal-panel-path" title={workspace}>{workspace || "未选择工作目录"}</span>
      </div>
      <div className="terminal-panel-form">
        <label htmlFor="terminal-choice">选择终端</label>
        <div className="terminal-panel-select-row">
          <select
            id="terminal-choice"
            value={selectedTerminal?.id ?? ""}
            disabled={loading || launching || terminals.length === 0}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {terminals.length === 0 && <option value="">未检测到终端</option>}
            {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
          </select>
          <button type="button" className="terminal-panel-refresh" onClick={() => void refreshTerminals()} disabled={loading || launching} title="重新检测终端">⟳</button>
        </div>
        {selectedTerminal && <p className="terminal-panel-description">{selectedTerminal.description}</p>}
        <button type="button" className="terminal-panel-launch" onClick={() => void launch()} disabled={!workspace || !selectedTerminal || loading || launching}>
          <span aria-hidden="true">↗</span>{launching ? "正在启动…" : "在工作区打开终端"}
        </button>
        {!workspace && <p className="terminal-panel-empty">选择工作区后，这里会以该目录作为终端起点。</p>}
        {workspace && terminals.length === 0 && !loading && <p className="terminal-panel-empty">未检测到系统终端。请安装终端应用后重新检测。</p>}
      </div>
    </DockFrame>
  );
}
