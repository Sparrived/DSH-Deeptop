import { Fragment, type ReactNode } from "react";

type UtilityDockId = "tasks" | "todo" | "deliverables";

type UtilityDockShelfProps = {
  tasks?: ReactNode;
  todo?: ReactNode;
  deliverables?: ReactNode;
  order?: readonly UtilityDockId[];
};

const defaultOrder: readonly UtilityDockId[] = ["tasks", "todo", "deliverables"];

/** Owns the canonical order and shared right-side layout boundary for utility docks. */
export function UtilityDockShelf({ tasks, todo, deliverables, order = defaultOrder }: UtilityDockShelfProps) {
  const contents: Record<UtilityDockId, ReactNode | undefined> = { tasks, todo, deliverables };
  const visible = order
    .map((id) => ({ id, content: contents[id] }))
    .filter((item): item is { id: UtilityDockId; content: ReactNode } => item.content !== undefined && item.content !== null);

  return (
    <div className="utility-panel-shelf" aria-label="当前会话面板">
      {visible.map(({ id, content }) => <Fragment key={id}>{content}</Fragment>)}
    </div>
  );
}
