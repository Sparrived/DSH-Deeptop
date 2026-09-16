/**
 * Settings-section identity for plugin-contributed panels.
 *
 * The settings nav is one flat list: built-in sections keep their literal ids,
 * while a plugin panel is addressed by the composite id of the contribution
 * that declares it. Keeping the encoding here — rather than inline in the
 * nav — gives the plugin path one place to parse and compare ids, and keeps a
 * plugin from colliding with a built-in section name.
 */

/** Prefix that marks a settings section as plugin-contributed. */
const PLUGIN_SECTION_PREFIX = "plugin:";

/**
 * Built-in settings sections, in nav order. Mirrors the literal ids the app
 * renders; kept here so a plugin-supplied section id can be validated before it
 * reaches the selection state.
 */
export const BUILTIN_SETTINGS_SECTIONS = [
  "general",
  "appearance",
  "dock",
  "keyboard",
  "models",
  "presets",
  "tools",
  "plugins",
  "logs",
  "about",
] as const;

export type BuiltinSettingsSectionId = (typeof BUILTIN_SETTINGS_SECTIONS)[number];

/**
 * Accept a section id that arrived from plugin code.
 *
 * A plugin may navigate to a built-in section or to another panel's composite
 * id, but never to an arbitrary string: an unvalidated id would leave the
 * content column rendering nothing while the nav shows no selection.
 */
export function acceptedSettingsSectionId(id: string): BuiltinSettingsSectionId | PluginSectionId | undefined {
  if (isPluginSectionId(id)) return id;
  return (BUILTIN_SETTINGS_SECTIONS as readonly string[]).includes(id)
    ? id as BuiltinSettingsSectionId
    : undefined;
}

/** A settings section id owned by a plugin contribution. */
export type PluginSectionId = `plugin:${string}`;

/**
 * Address one plugin settings panel.
 *
 * `pluginId` may itself contain dots but never `:` (the manifest id grammar is
 * lowercase, dot-separated), so splitting on the first `:` after the prefix
 * recovers both parts unambiguously.
 */
export function pluginSectionId(pluginId: string, contributionId: string): PluginSectionId {
  return `${PLUGIN_SECTION_PREFIX}${pluginId}:${contributionId}`;
}

/** Parse a plugin section id back into its parts; undefined for built-in ids. */
export function parsePluginSectionId(id: string): { pluginId: string; contributionId: string } | undefined {
  if (!id.startsWith(PLUGIN_SECTION_PREFIX)) return undefined;
  const rest = id.slice(PLUGIN_SECTION_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) return undefined;
  return { pluginId: rest.slice(0, separator), contributionId: rest.slice(separator + 1) };
}

/** True when the id belongs to a plugin-contributed section. */
export function isPluginSectionId(id: string): id is PluginSectionId {
  return parsePluginSectionId(id) !== undefined;
}

/** The section id owned by one registered contribution. */
export function contributionSectionId(contribution: { pluginId: string; contributionId: string }): PluginSectionId {
  return pluginSectionId(contribution.pluginId, contribution.contributionId);
}
