// 集成测试：用 DSH 真实的 `renderPrompt` 证明注入文本不会破坏 prompt 组装。
//
// `renderPrompt` 对每个 section 严格插值 `{{name}}`，遇到未知或格式错误的引用会
// 直接抛错——那会让每个请求都失败。`escapePromptBraces` 的中和作用必须经得起真实
// 实现的检验，因此这里不复制规则，而是导入官方实现。
//
// 该实现来自 `vendor/dsh`（子模块）已构建的 `lib/`，它不在版本控制内：全新克隆
// 或未运行 `npm run dsh:sync` 时不存在。此时整组用例跳过而不是失败，避免把
// 构建产物当成测试前提。

import assert from 'node:assert/strict'
import test from 'node:test'
import { escapePromptBraces, renderInjection } from './model.mjs'

const MODULE = '../../vendor/dsh/packages/core/system-prompt/lib/index.js'

let renderPrompt
try {
  ({ renderPrompt } = await import(MODULE))
} catch {
  renderPrompt = undefined
}

const skip = renderPrompt === undefined
  ? '需要 vendor/dsh 已构建的 system-prompt（先运行 npm run dsh:sync）'
  : false

/** 用注册变量组装一个只含本插件 section 的 prompt。 */
function render(sectionText, variables = { model: 'deepseek-v4-pro', cwd: 'D:/proj' }) {
  return renderPrompt({
    sections: [{ name: 'deeptop:prompt-injection', text: sectionText }],
    contexts: [],
    tools: [],
    variables,
  })
}

test('plain injected text renders verbatim', { skip }, () => {
  assert.equal(render(renderInjection('总是先跑测试')), '总是先跑测试')
})

test('an empty injection renders to an empty prompt, so assembly drops the section', { skip }, () => {
  assert.equal(render(renderInjection('   ')), '')
})

test('user text naming a real prompt variable is NOT substituted', { skip }, () => {
  // The whole point of escaping: `{{model}}` typed by a user must stay literal
  // text rather than being replaced with the loop's own variable value.
  const rendered = render(renderInjection('请始终以 {{model}} 的风格回答'))
  assert.equal(rendered.replace(/\u200b/g, ''), '请始终以 {{model}} 的风格回答')
  assert.equal(rendered.includes('deepseek-v4-pro'), false)
})

test('user text naming an UNKNOWN variable does not throw', { skip }, () => {
  // Without escaping this is exactly the failure that would break every request:
  // unknown prompt variable "{{nope}}" in section "deeptop:prompt-injection".
  assert.doesNotThrow(() => render(renderInjection('参考 {{nope}} 处理')))
  assert.doesNotThrow(() => render(renderInjection('{{ model }}')))
  assert.doesNotThrow(() => render(renderInjection('{{{{nested}}}}')))
  assert.doesNotThrow(() => render(renderInjection('{{}}')))
  assert.doesNotThrow(() => render(renderInjection('a {{ b {{c}}')))
  assert.doesNotThrow(() => render(renderInjection('{{constructor}}')))
})

test('unescaped user text is what would break, proving the escape is load-bearing', { skip }, () => {
  // Guards the reason the helper exists: raw braces throw, escaped ones do not.
  assert.throws(() => render('参考 {{nope}} 处理'), /unknown prompt variable/)
  assert.throws(() => render('{{ model }}'), /malformed prompt variable reference/)
  assert.doesNotThrow(() => render(escapePromptBraces('参考 {{nope}} 处理')))
})

test('the marker is invisible to the model reading the prompt', { skip }, () => {
  const rendered = render(renderInjection('用 {{a}} 和 {b} 与 ${{c}} 的写法'))
  // Braces, braces-like prose, and shell expansions all survive intact.
  assert.equal(rendered.replace(/\u200b/g, ''), '用 {{a}} 和 {b} 与 ${{c}} 的写法')
})
