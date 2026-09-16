// 全局提示词注入的 Host 插件。
//
// 用户在设置里写一段全局指令，插件把它作为一条独立的 `user/message` 追加到每个
// Session 的下一步请求前。它不并入 system prompt，因此在会话轨迹里单独可见，
// 来源标注为 `deeptop-prompt-injection`。
//
// 文本为空时不追加任何消息，所以清空输入框就是关闭注入，不需要额外的启用开关。
// 取值在每个 step 组装时读取，改动对已存在的会话同样生效；只有内容真正变化才追加，
// 未改动的 step 不会重复注入。清空后追加一条说明，让模型知道旧的注入已失效。

import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { injectionMessage, nextInjection, PROMPT_NAMESPACE } from './model.mjs'

export const name = 'deeptop-prompt-injection'

export const inject = ['settings']

/**
 * 读取本插件在当前请求里最后可见的注入正文。
 *
 * 只扫描当前 surface：被压缩或替换掉的注入不再发给模型，因此需要重新注入，
 * 而不是因为日志里还留着就跳过。
 * @param session - 目标会话。
 * @param plugin - 本插件的 `name`，用于识别自己写入的消息。
 * @returns 最后一条可见注入的正文；没有可见注入时为 `null`。
 */
function lastInjection(session, plugin) {
  for (const seq of session.surface.nodes.toReversed()) {
    const event = session.eventAt(seq)
    if (event?.type !== 'user/message') continue
    const source = event.data.source
    if (source?.kind !== 'plugin' || source.plugin !== plugin) continue
    const [block] = event.data.content
    return block?.type === 'text' ? block.text : null
  }
  return null
}

export function apply(ctx) {
  const scope = ctx.settings.register(PROMPT_NAMESPACE, Schema.object({
    // `role('textarea')` is the generic settings form's multi-line hint: the
    // desktop renders this field as a textarea from the schema alone.
    text: Schema.string().role('textarea').description('Injected before every Session step as its own context message').default(''),
  }))

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const text = nextInjection(lastInjection(agent.session, name), scope.get()?.text)
    if (text === undefined) return decision
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage(injectionMessage(text, name))],
    }
  }, { prepend: true })
}
