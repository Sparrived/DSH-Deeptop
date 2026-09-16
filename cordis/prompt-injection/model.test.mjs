import assert from 'node:assert/strict'
import test from 'node:test'
import { CLEARED_INJECTION, nextInjection } from './model.mjs'

test('injects nothing on the first step when the setting is absent or blank', () => {
  assert.equal(nextInjection(null, undefined), undefined)
  assert.equal(nextInjection(null, ''), undefined)
  assert.equal(nextInjection(null, '   \n\t '), undefined)
  assert.equal(nextInjection(null, 7), undefined)
})

test('injects the trimmed text of a fresh setting', () => {
  assert.equal(nextInjection(null, '  总是先跑测试  '), '总是先跑测试')
})

test('keeps the user text verbatim, including prompt-variable-looking braces', () => {
  // 注入内容直接成为 user/message，不参与 system prompt 的模板插值，
  // 所以 `{{name}}` 必须原样保留，不能被改写也不能被替换。
  assert.equal(nextInjection(null, '请始终以 {{model}} 的风格回答'), '请始终以 {{model}} 的风格回答')
  assert.equal(nextInjection(null, '用 {{{ 和 }}} 与 {{}} 的写法'), '用 {{{ 和 }}} 与 {{}} 的写法')
})

test('re-injects only when the text actually changes', () => {
  assert.equal(nextInjection('旧的注入', '旧的注入'), undefined)
  // 只有首尾空白不同不算变化，否则每个 step 都会白白追加一行。
  assert.equal(nextInjection('旧的注入', '  旧的注入\n'), undefined)
  assert.equal(nextInjection('旧的注入', '新的注入'), '新的注入')
})

test('clearing the setting tells the model the earlier injection is void', () => {
  assert.equal(nextInjection('旧的注入', ''), CLEARED_INJECTION)
  // 已经声明过失效后不再重复追加。
  assert.equal(nextInjection(CLEARED_INJECTION, ''), undefined)
  assert.equal(nextInjection(CLEARED_INJECTION, '   '), undefined)
})

test('a new text after clearing is injected again, and so is the same text later', () => {
  assert.equal(nextInjection(CLEARED_INJECTION, '重新启用'), '重新启用')
  // 清空后重新写回原文，需要重新注入，而不是被当成"没变"。
  assert.equal(nextInjection(CLEARED_INJECTION, '旧的注入'), '旧的注入')
})
