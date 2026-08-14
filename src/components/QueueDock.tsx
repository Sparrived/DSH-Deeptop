import { textFromContent } from "../app/model";
import type { DshQueueItem } from "../lib/desktop";

type QueueDockProps = {
  items: DshQueueItem[];
  editingId: string | null;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onSave: (itemId: string) => void | Promise<void>;
  onCancelEdit: () => void;
  onBeginEdit: (item: DshQueueItem) => void;
  onRemove: (itemId: string) => void | Promise<void>;
};

export function QueueDock({
  items,
  editingId,
  editingText,
  onEditingTextChange,
  onSave,
  onCancelEdit,
  onBeginEdit,
  onRemove,
}: QueueDockProps) {
  if (items.length === 0) return null;

  return (
    <div className="queue-dock">
      <span className="queue-dock-label">待处理消息</span>
      <div className="queue-dock-items">
        {items.filter((item) => item.placement !== "context").map((item) => (
          <div className={`queue-dock-item${editingId === item.id ? " editing" : ""}`} key={item.id}>
            {editingId === item.id ? (
              <>
                <input value={editingText} onChange={(event) => onEditingTextChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onSave(item.id); if (event.key === "Escape") onCancelEdit(); }} aria-label="编辑排队消息" autoFocus />
                <div className="queue-dock-item-actions">
                  <button onClick={() => void onSave(item.id)} title="保存排队消息">✓</button>
                  <button onClick={onCancelEdit} title="取消编辑">×</button>
                </div>
              </>
            ) : (
              <>
                <span>{textFromContent(item.message.content) || "未命名消息"}</span>
                <div className="queue-dock-item-actions">
                  <button onClick={() => onBeginEdit(item)} title="编辑排队消息">✎</button>
                  <button onClick={() => void onRemove(item.id)} title="移除排队消息">×</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
