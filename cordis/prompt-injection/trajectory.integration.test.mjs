// 集成测试：用桌面端真实的轨迹投影证明「全局提示词作为独立注入行可见」。
//
// 需求是注入必须作为一条单独的轨迹条目出现，而不是并进 system prompt。这里不复制
// 判断逻辑，而是把插件真实产出的消息交给 `transcriptFromHistory`，断言它成为自己的
// 「上下文注入」行、来源标注为 deeptop-prompt-injection，且正文原样保留。
//
// 该投影来自 `src/app/conversation-model.ts`，需要 Node 能直接加载 TypeScript；
// 运行环境不支持时整组用例跳过而不是失败。

import assert from 'node:assert/strict'
import test from 'node:test'
import { injectionMessage, nextInjection } from './model.mjs'

const MODULE = '../../src/app/conversation-model.ts'

let transcriptFromHistory
try {
  ({ transcriptFromHistory } = await import(MODULE))
} catch {
  transcriptFromHistory = undefined
}

const skip = transcriptFromHistory === undefined
  ? '需要 Node 能直接加载 src/app/conversation-model.ts'
  : false

const PLUGIN = 'deeptop-prompt-injection'

/** 把一个注入文本跑完整条链路：取值 → 组装消息 → 轨迹投影。 */
function project(text, previous = null) {
  const injected = nextInjection(previous, text)
  if (injected === undefined) return []
  const message = injectionMessage(injected, PLUGIN)
  return transcriptFromHistory([{
    event: {
      seq: 7,
      time: 1_700_000_000_000,
      type: 'user/message',
      data: { id: 'injected-1', ...message },
    },
  }], 'zh')
}

test('the injected text becomes its own trajectory row, not part of the system prompt', { skip }, () => {
  const [row, ...rest] = project('总是先跑测试')
  assert.equal(rest.length, 0, '一次注入只产生一行')
  // 独立的上下文注入行：既不是用户发言，也不是助手回合。
  assert.equal(row.injected, true)
  assert.equal(row.kind, 'system')
  assert.equal(row.label, '上下文注入')
  assert.equal(row.contextRole, 'inject')
  assert.equal(row.text, '总是先跑测试')
})

test('the row attributes itself to the plugin so the source is visible in the trajectory', { skip }, () => {
  const [row] = project('总是先跑测试')
  // 轨迹摘要里显示的就是这个来源名。
  assert.equal(row.source, PLUGIN)
  assert.equal(row.contextForm, 'snapshot')
})

test('a blank setting adds no row at all, so clearing the box switches injection off', { skip }, () => {
  assert.deepEqual(project(''), [])
  assert.deepEqual(project('   \n\t '), [])
  assert.deepEqual(project(undefined), [])
})

test('an unchanged setting adds no new row on later steps', { skip }, () => {
  assert.deepEqual(project('总是先跑测试', '总是先跑测试'), [])
})

test('clearing an active injection leaves a visible row telling the model it is void', { skip }, () => {
  const [row] = project('', '总是先跑测试')
  assert.equal(row.injected, true)
  assert.equal(row.label, '上下文注入')
  assert.equal(row.source, PLUGIN)
  assert.match(row.text, /no longer applies/)
})

test('prompt-variable syntax typed by the user stays literal in the row', { skip }, () => {
  const text = '请始终以 {{model}} 的风格回答'
  const [row] = project(text)
  // 注入内容不经过 system prompt 的模板插值，所以 `{{model}}` 既不被替换也不被改写。
  assert.equal(row.text, text)
  assert.equal(row.text.includes('\u200b'), false, '不应插入零宽字符')
})
