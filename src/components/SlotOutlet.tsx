import { useState, useSyncExternalStore, type MouseEvent } from "react";
import type { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import type { RegisteredContribution } from "../lib/desktop-ui-runtime/types";
import type { SlotRenderContext } from "../lib/desktop-ui-runtime/types";
import { PluginErrorBoundary } from "./PluginErrorBoundary";

export interface SlotOutletProps {
  runtime: DesktopUiRuntime;
  slot: Parameters<DesktopUiRuntime["slots"]["snapshot"]>[0];
  context: SlotRenderContext;
  /**
   * "menu-item": vertical action lists (context menus); declarative badges are
   * omitted there because a text badge is not a menu row.
   * "inline": badges and actions render in place (row trailing areas).
   * "message-actions": action contributions render in message action rows.
   * "message-badge": badge contributions render beside a message.
   */
  variant?: "menu-item" | "inline" | "message-actions" | "message-badge";
  /**
   * Render only the contributions this predicate accepts. Settings sections
   * use it to mount just the selected panel from a slot that declares many.
   */
  filter?: (contribution: RegisteredContribution) => boolean;
  onActionError?: (message: string) => void;
}

/**
 * Hosts every contribution registered on one slot (docs §10.1): stable
 * ordering comes from the registry snapshot, each entry is error-isolated, and
 * host-declared contributions render through native generic controls so their
 * invocations stay on the restricted ui.plugin.invoke route.
 */
export function SlotOutlet({ runtime, slot, context, variant = "menu-item", filter, onActionError }: SlotOutletProps) {
  const snapshot = useSyncExternalStore(
    (listener) => runtime.slots.subscribe(listener),
    () => runtime.slots.snapshot(slot),
    () => runtime.slots.snapshot(slot),
  );
  const contributions = filter ? snapshot.filter(filter) : snapshot;
  if (contributions.length === 0) return null;

  return (
    <>
      {contributions.map((contribution) => {
        if (contribution.declarative) {
          const key = `${contribution.pluginId}:${contribution.contributionId}`;
          if (variant === "message-actions" || variant === "message-badge") return null;
          if (variant === "menu-item") {
            return contribution.declarative.kind === "action"
              ? <DeclarativeActionItem key={key} runtime={runtime} contribution={contribution} context={context} onActionError={onActionError} />
              : null;
          }
          return variant === "inline"
            ? <DeclarativeInlineItem key={key} runtime={runtime} contribution={contribution} context={context} onActionError={onActionError} />
            : null;
        }
        if (variant === "message-actions" && contribution.kind !== "action") return null;
        if (variant === "message-badge" && contribution.kind !== "badge") return null;
        const Render = contribution.render;
        if (!Render) return null;
        return (
          <PluginErrorBoundary
            key={`${contribution.pluginId}:${contribution.contributionId}`}
            pluginId={contribution.pluginId}
            contributionId={contribution.contributionId}
            onError={onActionError ? (info) => onActionError(info.message) : undefined}
          >
            <Render {...context} />
          </PluginErrorBoundary>
        );
      })}
    </>
  );
}

interface DeclarativeItemProps {
  runtime: DesktopUiRuntime;
  contribution: RegisteredContribution;
  context: SlotRenderContext;
  onActionError?: (message: string) => void;
}

function DeclarativeActionItem({ runtime, contribution, context, onActionError }: DeclarativeItemProps) {
  const [pending, setPending] = useState(false);
  const declarative = contribution.declarative;
  if (!declarative || declarative.kind !== "action") return null;

  const invoke = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      await runtime.invokeDeclarative(contribution.pluginId, declarative, { sessionId: context.session?.sessionId ?? null });
    } catch (error) {
      onActionError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      role="menuitem"
      disabled={pending}
      data-plugin-id={contribution.pluginId}
      onClick={(event) => void invoke(event)}
    >
      {declarative.label}{pending ? "…" : ""}
    </button>
  );
}

function DeclarativeInlineItem({ runtime, contribution, context, onActionError }: DeclarativeItemProps) {
  const [pending, setPending] = useState(false);
  const declarative = contribution.declarative;
  if (!declarative) return null;

  if (declarative.kind === "badge") {
    return (
      <span className="plugin-declarative-badge" data-plugin-id={contribution.pluginId} title={declarative.label}>
        {declarative.label}
      </span>
    );
  }

  const invoke = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      await runtime.invokeDeclarative(contribution.pluginId, declarative, { sessionId: context.session?.sessionId ?? null });
    } catch (error) {
      onActionError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className="plugin-declarative-action"
      data-plugin-id={contribution.pluginId}
      title={declarative.label}
      aria-label={declarative.label}
      disabled={pending}
      onClick={(event) => void invoke(event)}
    >
      {declarative.label}
    </button>
  );
}
