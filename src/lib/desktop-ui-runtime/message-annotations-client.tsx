import { useCallback, useState, useSyncExternalStore } from "react";
import type { MessageUiContext, DeeptopClientContext, SlotRenderContext } from "./types";
import { t } from "../../app/i18n";
import { createMessageAnnotationStore, type AnnotationStore } from "./message-annotation-store.ts";

function useAnnotationSnapshot(store: AnnotationStore, sessionId: string) {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(sessionId),
    () => store.get(sessionId),
  );
}

function AnnotationAction({
  message,
  context,
  store,
}: {
  message: MessageUiContext;
  context: SlotRenderContext;
  store: AnnotationStore;
}) {
  const currentSession = context.session;
  const annotations = useAnnotationSnapshot(store, message.sessionId);
  const current = annotations[message.messageId];
  const [busy, setBusy] = useState(false);
  const edit = useCallback(async () => {
    if (!currentSession || currentSession.sessionId !== message.sessionId || busy) return;
    const operationGeneration = context.sessionGeneration;
    let draft: string | null;
    try {
      draft = await context.host.prompt({
        title: t("dialog.annotationEdit.title", context.locale),
        value: current?.note ?? "",
        description: t("dialog.annotationEdit.description", context.locale),
      });
    } catch {
      // Host restart/disposal rejects the scoped prompt facade. The popup queue
      // belongs to the host shell, so this stale action must simply stop.
      return;
    }
    if (draft === null || (!draft.trim() && !current)) return;
    context.host.notify(t("notice.annotationSaving", context.locale));
    setBusy(true);
    try {
      if (draft.trim()) {
        const result = await store.put(message.sessionId, message.messageId, draft.trim(), operationGeneration);
        context.host.notify(
          result.switched
            ? t("notice.annotationSavedSwitched", context.locale)
            : current
              ? t("notice.annotationUpdated", context.locale)
              : t("notice.annotationAdded", context.locale),
        );
      } else if (current) {
        const result = await store.remove(message.sessionId, message.messageId, current.version, operationGeneration);
        context.host.notify(
          result.switched
            ? t("notice.annotationClearedSwitched", context.locale)
            : t("notice.annotationCleared", context.locale),
        );
      }
    } catch (error) {
      context.host.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, context, current, message, currentSession, store]);

  const label = current
    ? t("conversation.annotation.editShort", context.locale)
    : t("conversation.annotation.addShort", context.locale);
  return (
    <button
      type="button"
      disabled={busy}
      title={current ? t("conversation.annotation.edit", context.locale) : t("conversation.annotation.add", context.locale)}
      onClick={() => void edit()}
    >
      {busy ? t("common.saving", context.locale) : label}
    </button>
  );
}

function MessageAnnotation({
  message,
  context,
  store,
}: {
  message: MessageUiContext;
  context: SlotRenderContext;
  store: AnnotationStore;
}) {
  const annotations = useAnnotationSnapshot(store, message.sessionId);
  const note = annotations[message.messageId]?.note;
  if (!note) return null;
  return (
    <span className="message-annotation" title={t("conversation.annotation.label", context.locale)}>
      <i aria-hidden="true" />
      {note}
    </span>
  );
}

export function activate(context: DeeptopClientContext): void {
  const store = createMessageAnnotationStore(context);
  context.signal.addEventListener("abort", () => store.dispose(), { once: true });
  context.ui.register("conversation.message.actions", {
    kind: "action",
    id: "message-annotations.edit",
    order: 30,
    render: ({ message, ...slot }: SlotRenderContext) => message
      ? <AnnotationAction message={message} context={{ ...slot, message }} store={store} />
      : null,
  });
  context.ui.register("conversation.message.actions", {
    kind: "badge",
    id: "message-annotations.note",
    order: 20,
    render: ({ message, ...slot }: SlotRenderContext) => message
      ? <MessageAnnotation message={message} context={{ ...slot, message }} store={store} />
      : null,
  });
}
