import { useCallback, useSyncExternalStore } from "react";
import type { DesktopUiRuntime } from "../lib/desktop-ui-runtime/client-runtime";
import type { RegisteredContribution, SlotRenderContext } from "../lib/desktop-ui-runtime/types";
import type { UiLocale } from "../app/i18n";
import { contributionSectionId, pluginSectionId, type PluginSectionId } from "../app/settings-section-model";
import { SlotOutlet } from "./SlotOutlet";

/**
 * Host for plugin-contributed settings sections (docs/DEEPTOP_UI_RUNTIME.md
 * §10.3). One `settings.sections` contribution of kind `panel` becomes a nav
 * entry plus, while selected, the content column — so a plugin adds its own
 * settings surface without the desktop app naming it anywhere.
 *
 * Built-in sections stay owned by the app: their ids are plain literals and
 * never collide with a plugin id, which always carries the `plugin:` prefix.
 */

/** The active contribution id for one section id; empty when it is not a plugin section. */
function filterForSection(sectionId: string): ((contribution: RegisteredContribution) => boolean) {
  return (contribution) => contribution.kind === "panel"
    && contributionSectionId(contribution) === sectionId;
}

/** Ordered panel contributions of the slot; the snapshot identity is the registry's. */
function usePanelContributions(runtime: DesktopUiRuntime): readonly RegisteredContribution[] {
  const snapshot = useSyncExternalStore(
    (listener) => runtime.slots.subscribe(listener),
    () => runtime.slots.snapshot("settings.sections"),
    () => runtime.slots.snapshot("settings.sections"),
  );
  return snapshot.filter((contribution) => contribution.kind === "panel");
}

export interface SettingsPluginSectionNavProps {
  runtime: DesktopUiRuntime;
  activeSectionId: string;
  /** Live locale; a translated plugin label is resolved here, not at activation. */
  locale: UiLocale;
  /** Only plugin sections are selectable here, so the id is narrowed accordingly. */
  onSelectSection: (sectionId: PluginSectionId) => void;
}

/** Nav entries contributed by plugins; renders nothing when no plugin ships a panel. */
export function SettingsPluginSectionNav({ runtime, activeSectionId, locale, onSelectSection }: SettingsPluginSectionNavProps) {
  const panels = usePanelContributions(runtime);
  if (panels.length === 0) return null;
  return (
    <>
      {panels.map((contribution) => {
        const sectionId = contributionSectionId(contribution);
        // `title` names a panel that also renders elsewhere; a settings section
        // is only ever a nav entry, so `label` is the expected source. A
        // function label re-reads the locale on every render, so switching
        // language retranslates the nav without re-activating the plugin.
        const written = typeof contribution.label === "function" ? contribution.label(locale) : contribution.label;
        const label = written ?? contribution.title ?? contribution.contributionId;
        return <button
          key={sectionId}
          type="button"
          className={activeSectionId === sectionId ? "selected" : ""}
          data-plugin-section={pluginSectionId(contribution.pluginId, contribution.contributionId)}
          onClick={() => onSelectSection(sectionId)}
        >
          <strong>{label}</strong><small>{contribution.pluginId}</small>
        </button>;
      })}
    </>
  );
}

export interface SettingsPluginSectionPanelProps {
  runtime: DesktopUiRuntime;
  context: SlotRenderContext;
  activeSectionId: PluginSectionId;
  onActionError?: (message: string) => void;
}

/** The selected plugin panel; error-isolated per contribution by SlotOutlet. */
export function SettingsPluginSectionPanel({ runtime, context, activeSectionId, onActionError }: SettingsPluginSectionPanelProps) {
  const filter = useCallback(filterForSection(activeSectionId), [activeSectionId]);
  return <SlotOutlet
    runtime={runtime}
    slot="settings.sections"
    context={context}
    filter={filter}
    onActionError={onActionError}
  />;
}
