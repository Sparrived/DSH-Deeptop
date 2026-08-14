import { todoStatusLabel, type TodoItem } from "../app/model";

type TodoCounts = {
  completed: number;
  inProgress: number;
  pending: number;
};

type TodoPanelProps = {
  todos: TodoItem[];
  collapsed: boolean;
  counts: TodoCounts;
  onToggle: () => void;
};

export function TodoPanel({ todos, collapsed, counts, onToggle }: TodoPanelProps) {
  return (
    <aside className={`todo-panel ${collapsed ? "collapsed" : ""}`} aria-label="当前会话任务清单" aria-live="polite">
      <header className="todo-panel-header">
        <div className="todo-panel-heading">
          <span className="todo-panel-mark" aria-hidden="true">✓</span>
          <div>
            <span className="todo-panel-kicker">当前会话</span>
            <h2>任务清单</h2>
          </div>
        </div>
        <div className="todo-panel-header-actions">
          {!collapsed && <span className="todo-panel-total">{counts.completed}/{todos.length}</span>}
          <button
            className="todo-panel-toggle"
            type="button"
            onClick={onToggle}
            aria-controls="todo-panel-content"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展开任务清单" : "收起任务清单"}
            title={collapsed ? "展开任务清单" : "收起任务清单"}
          >
            <span aria-hidden="true">{collapsed ? "‹" : "›"}</span>
          </button>
        </div>
      </header>
      <div id="todo-panel-content" className="todo-panel-body" hidden={collapsed}>
        <div className="todo-panel-summary">
          <div className="todo-progress-track" aria-label={`已完成 ${counts.completed} 项，共 ${todos.length} 项`}>
            <i style={{ width: `${todos.length ? (counts.completed / todos.length) * 100 : 0}%` }} />
          </div>
          <div className="todo-panel-counts">
            <span className="completed">{counts.completed} 已完成</span>
            <span className="in-progress">{counts.inProgress} 进行中</span>
            <span className="pending">{counts.pending} 待处理</span>
          </div>
        </div>
        <ol className="todo-list">
          {todos.map((item, index) => (
            <li className={`todo-item ${item.status}`} key={`${index}-${item.content}`}>
              <span className="todo-item-index">{String(index + 1).padStart(2, "0")}</span>
              <span className={`todo-item-status ${item.status}`} aria-label={todoStatusLabel(item.status)}>{item.status === "completed" ? "✓" : item.status === "in_progress" ? "·" : ""}</span>
              <span className="todo-item-content">{item.content}</span>
              <span className="todo-item-label">{todoStatusLabel(item.status)}</span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
