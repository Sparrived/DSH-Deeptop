import { transcriptFromHistory, type ChildSubagentEntry, type SubagentSession } from "../app/model";
import { MarkdownContent } from "../lib/markdown";
import type { DshSubagentCatalog } from "../lib/desktop";

type AsyncAction = () => void | Promise<unknown>;

interface SubagentsSurfacePanelProps {
  subagents: DshSubagentCatalog | null;
  session: SubagentSession | null;
  composer: string;
  onOpen: (entry: ChildSubagentEntry) => void | Promise<unknown>;
  onCloseSession: () => void;
  onComposerChange: (value: string) => void;
  onPrompt: AsyncAction;
  onInterrupt: (address: SubagentSession["address"]) => void | Promise<unknown>;
}

export function SubagentsSurfacePanel({ subagents, session, composer, onOpen, onCloseSession, onComposerChange, onPrompt, onInterrupt }: SubagentsSurfacePanelProps) {
  return <div className="surface-content"><div className="surface-intro"><strong>Subagents</strong><p>从当前会话打开子 Agent 的独立历史；可继续子 Agent 支持追问和中断。</p></div><div className="surface-list">{!subagents || subagents.entries.length === 0 ? <p className="surface-muted">当前会话没有子 Agent。</p> : subagents.entries.map((entry) => entry.kind === "diagnostic" ? <div className="surface-row compact" key={entry.id}><div><strong>{entry.id}</strong><small>不可用：{entry.reason}</small></div></div> : <div className="surface-row compact" key={entry.id}><div><strong>{entry.label || entry.id}</strong><small>{entry.mode} · {entry.activity === "running" ? "运行中" : "已停止"}</small></div><button onClick={() => void onOpen(entry)}>打开</button></div>)}</div>{session && <div className="subagent-view"><div className="subagent-view-head"><strong>{session.address.childSessionId}</strong><button onClick={onCloseSession}>关闭</button></div><div className="subagent-history">{transcriptFromHistory(session.history).map((item) => <div className={"subagent-message " + item.kind} key={item.key}><small>{item.label}</small><MarkdownContent text={item.text} /></div>)}</div>{session.address.mode === "continuable" && <div className="subagent-compose"><input value={composer} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onPrompt(); }} placeholder="追问子 Agent" /><button onClick={() => void onInterrupt(session.address)} title="中断子 Agent">停</button><button onClick={() => void onPrompt()}>发送</button></div>}</div>}</div>;
}
