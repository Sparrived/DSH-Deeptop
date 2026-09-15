import { Check, Pencil, X } from "lucide-react";
import { textFromContent } from "../app/model";
import type { DshQueueItem } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

type QueueDockProps = {
  /** 界面语言：排队列表文案按语言渲染。 */
  locale?: UiLocale;
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
  locale = "zh",
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
      <span className="queue-dock-label">{t("queue.label", locale)}</span>
      <div className="queue-dock-items">
        {items.filter((item) => item.placement !== "context").map((item) => (
          <div className={`queue-dock-item${editingId === item.id ? " editing" : ""}`} key={item.id}>
            {editingId === item.id ? (
              <>
                <input value={editingText} onChange={(event) => onEditingTextChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onSave(item.id); if (event.key === "Escape") onCancelEdit(); }} aria-label={t("queue.edit", locale)} autoFocus />
                <div className="queue-dock-item-actions">
                  <button onClick={() => void onSave(item.id)} title={t("queue.save", locale)}><Check aria-hidden="true" /></button>
                  <button onClick={onCancelEdit} title={t("queue.cancelEdit", locale)}><X aria-hidden="true" /></button>
                </div>
              </>
            ) : (
              <>
                <span className={`queue-dock-item-mode ${item.placement}`}>
                  {item.placement === "steering" ? t("composer.steerLabel", locale) : t("composer.queueLabel", locale)}
                </span>
                <span>{textFromContent(item.message.content, locale) || t("queue.unnamed", locale)}</span>
                <div className="queue-dock-item-actions">
                  <button onClick={() => onBeginEdit(item)} title={t("queue.edit", locale)}><Pencil aria-hidden="true" /></button>
                  <button onClick={() => void onRemove(item.id)} title={t("queue.remove", locale)}><X aria-hidden="true" /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
