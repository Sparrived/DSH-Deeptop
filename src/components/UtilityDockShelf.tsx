import { type ReactNode } from "react";
import { Bot, CheckSquare, ListTodo, PackageOpen } from "lucide-react";
import { t, type UiLocale } from "../app/i18n";

export type UtilityDockId = "tasks" | "todo" | "deliverables" | "subagent";

type UtilityDockItem = {
  id: UtilityDockId;
  label: string;
  icon: ReactNode;
  count?: ReactNode;
  content: ReactNode;
};

type UtilityPanelEmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
};

type UtilityDockShelfProps = {
  active: UtilityDockId | null;
  onSelect: (id: UtilityDockId) => void;
  tasks: ReactNode;
  todo: ReactNode;
  deliverables: ReactNode;
  subagent: ReactNode;
  taskCount?: ReactNode;
  todoCount?: ReactNode;
  deliverableCount?: ReactNode;
  subagentCount?: ReactNode;
  locale?: UiLocale;
};

/** A deliberate default page when a session utility has no data yet. */
export function UtilityPanelEmptyState({ icon, title, description }: UtilityPanelEmptyStateProps) {
  return <section className="utility-panel-empty">
    <span className="utility-panel-empty-icon" aria-hidden="true">{icon}</span>
    <strong>{title}</strong>
    <p>{description}</p>
  </section>;
}

/** The fixed four-entry session workbench that replaces the utility Dock rails. */
export function UtilityDockShelf({
  active,
  onSelect,
  tasks,
  todo,
  deliverables,
  subagent,
  taskCount,
  todoCount,
  deliverableCount,
  subagentCount,
  locale = "zh",
}: UtilityDockShelfProps) {
  const items: readonly UtilityDockItem[] = [
    { id: "tasks", label: t("todo.title", locale), icon: <ListTodo />, count: taskCount, content: tasks },
    { id: "todo", label: t("todo.listTitle", locale), icon: <CheckSquare />, count: todoCount, content: todo },
    { id: "deliverables", label: t("deliverables.title", locale), icon: <PackageOpen />, count: deliverableCount, content: deliverables },
    { id: "subagent", label: t("subagent.title", locale), icon: <Bot />, count: subagentCount, content: subagent },
  ];
  const selected = active ? items.find((item) => item.id === active) ?? null : null;

  return (
    <aside className={`utility-panel-shelf${selected ? " open" : ""}`} aria-label={t("dock.shelfAria", locale)}>
      {selected && <section key={selected.id} id={`utility-panel-${selected.id}`} className="utility-panel-content" role="tabpanel" aria-label={selected.label}>
        {selected.content}
      </section>}
      <div className="utility-panel-tabs" role="tablist" aria-label={t("dock.shelfAria", locale)}>
        {items.map((item) => {
          const selectedItem = item.id === active;
          return <button
            className={`utility-panel-tab${selectedItem ? " selected" : ""}`}
            type="button"
            role="tab"
            key={item.id}
            aria-selected={selectedItem}
            aria-controls={selectedItem ? `utility-panel-${item.id}` : undefined}
            title={item.label}
            onClick={() => onSelect(item.id)}
          >
            <span className="utility-panel-tab-icon" aria-hidden="true">{item.icon}</span>
            <span className="utility-panel-tab-label">{item.label}</span>
            {item.count !== undefined && <span className="utility-panel-tab-count">{item.count}</span>}
          </button>;
        })}
      </div>
    </aside>
  );
}
