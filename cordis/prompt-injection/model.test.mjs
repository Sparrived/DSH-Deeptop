import assert from 'node:assert/strict'
import test from 'node:test'
import { escapePromptBraces, renderInjection } from './model.mjs'

test('renders nothing for an absent or blank value, so clearing the box disables injection', () => {
  assert.equal(renderInjection(undefined), '')
  assert.equal(renderInjection(''), '')
  assert.equal(renderInjection('   \n\t '), '')
  assert.equal(renderInjection(7), '')
})

test('trims the injected text', () => {
  assert.equal(renderInjection('  总是先跑测试  '), '总是先跑测试')
})

test('neutralizes a variable opener so user text cannot break prompt assembly', () => {
  // `renderPrompt` throws on an unknown or malformed `{{name}}` reference, so a
  // user typing braces must not reach assembly as a complete group.
  assert.equal(escapePromptBraces('use {{model}} here'), 'use {\u200b{model}} here')
  assert.equal(escapePromptBraces('{{'), '{\u200b{')
  assert.equal(escapePromptBraces('a {{ b {{c}}'), 'a {\u200b{ b {\u200b{c}}')
  assert.equal(escapePromptBraces('plain text'), 'plain text')
  assert.equal(escapePromptBraces('single { brace } stays'), 'single { brace } stays')
})

test('neutralizes runs of three or more braces too', () => {
  // Splitting on `{{` would leave `{{` behind in `{{{{x}}}}`, so the rule rewrites
  // every brace that opens a pair rather than the pair itself.
  assert.equal(escapePromptBraces('{{{{x}}}}'), '{\u200b{\u200b{\u200b{x}}}}')
})

test('leaves no complete group in rendered text and stays readable without the marker', () => {
  for (const text of ['{{cwd}}', '{{ model }}', '{{{{nested}}}}', 'x{{{y}}}', '{{{', '}}}}', '{{}}']) {
    const rendered = escapePromptBraces(text)
    assert.equal(/\{\{[^{}]*\}\}/.test(rendered), false, `still a group: ${JSON.stringify(rendered)}`)
    // Only an invisible character is added, so the model still reads the braces.
    assert.equal(rendered.replace(/\u200b/g, ''), text)
  }
})

test('keeps a lone opener literal, matching renderPrompt', () => {
  // A `{{` with no later `}}` is already literal prose; the marker is harmless.
  assert.equal(escapePromptBraces('{{unclosed').replace(/\u200b/g, ''), '{{unclosed')
})
