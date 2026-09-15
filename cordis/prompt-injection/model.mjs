// Pure text rules shared by the prompt-injection Host plugin and its tests.

export const PROMPT_NAMESPACE = 'deeptop-prompt-injection'
export const SECTION_NAME = 'deeptop:prompt-injection'
/**
 * Sits just after the deployment persona prefix (0) and before PLAN_POLICY (500),
 * so an end-user addition reads as part of the opening system prompt.
 */
export const SECTION_ORDER = 10

/**
 * Neutralize `{{` so user-authored text can never be read as a prompt variable.
 *
 * `renderPrompt` interpolates every section strictly and throws on a malformed or
 * unknown `{{name}}` reference. A user pasting a prompt template (`{{variable}}`
 * syntax is common) would otherwise fail assembly for every request, so a
 * zero-width space is inserted after each `{` that opens a pair: visually and
 * semantically identical to a model, but no complete group remains. The lookahead
 * is required because splitting on `{{` still leaves `{{` behind in a run of
 * three or more braces (`{{{{x}}}}`).
 * @param text - user-authored prompt text.
 * @returns the same text with no recognizable variable opener.
 */
export function escapePromptBraces(text) {
  return text.replace(/\{(?=\{)/g, '{\u200b')
}

/**
 * Render the model-visible section text.
 *
 * An absent or blank value yields an empty section, which prompt assembly drops,
 * so clearing the box disables the injection without a separate toggle.
 * @param value - the `text` field of the `deeptop-prompt-injection` namespace.
 * @returns the section text, or `''` when nothing is injected.
 */
export function renderInjection(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''
  return escapePromptBraces(trimmed)
}
