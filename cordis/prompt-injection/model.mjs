// Pure text rules shared by the prompt-injection Host plugin and its tests.

/** 承载注入文本的 DSH 设置命名空间，也是插件在会话轨迹里的来源标识。 */
export const PROMPT_NAMESPACE = 'deeptop-prompt-injection'

/**
 * 关闭注入时追加的说明。
 *
 * 注入内容是持久化的会话轨迹：清空设置只影响后续追加，无法改写已经进入历史的注入，
 * 模型仍会读到旧指令。这条消息把"已经没有注入"告诉模型，让清空真正生效。
 */
export const CLEARED_INJECTION = 'Global prompt injection: none. Any earlier global prompt injection no longer applies.'

/**
 * 计算这一步要追加的注入文本。
 *
 * 文本直接成为一条 `user/message`，不参与 system prompt 的模板插值，所以用户写下的
 * `{{name}}` 原样保留，只有首尾空白被去掉。
 * @param previous - 本插件在该会话中最后写入的注入正文，`null` 表示尚未注入过。
 * @param value - `deeptop-prompt-injection` 命名空间的 `text` 字段。
 * @returns 要追加的正文；`undefined` 表示这一步无需注入。
 */
export function nextInjection(previous, value) {
  const text = typeof value === 'string' ? value.trim() : ''
  // CLEARED_INJECTION 代表"没有注入"，所以再次清空不会反复追加说明。
  const injected = previous == null || previous === CLEARED_INJECTION ? '' : previous
  if (text === injected) return undefined
  return text === '' ? CLEARED_INJECTION : text
}

/**
 * 组装要追加的 `user/message` 载荷。
 *
 * `source.kind = 'plugin'` 让桌面端把它作为上下文注入行而不是用户发言；
 * `source.plugin` 成为轨迹里显示来源，`form`/`sections` 与 DSH 自身的运行时快照一致。
 * @param text - `nextInjection` 给出的正文。
 * @param plugin - 插件的 `name`。
 * @returns 交给 `createUserMessage` 的内容与来源。
 */
export function injectionMessage(text, plugin) {
  return {
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin, form: 'snapshot', sections: [{ name: plugin, text }] },
  }
}
