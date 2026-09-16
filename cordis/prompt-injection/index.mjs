// 全局提示词注入的 Host 插件。
//
// 用户在设置里写一段全局指令，插件把它作为 system prompt 的一个 section 注入
// 每个 Session。文本为空时 section 渲染为空，prompt 组装会丢弃它，因此清空输入框
// 就是关闭注入，不需要额外的启用开关。取值在每个请求组装时读取，改动对已存在的
// 会话同样生效。

import Schema from '@deepseek-ai/schemastery'
import { PROMPT_NAMESPACE, SECTION_NAME, SECTION_ORDER, renderInjection } from './model.mjs'

export const name = 'deeptop-prompt-injection'

export const inject = ['settings', 'systemPrompt']

export function apply(ctx) {
  const scope = ctx.settings.register(PROMPT_NAMESPACE, Schema.object({
    // `role('textarea')` is the generic settings form's multi-line hint: the
    // desktop renders this field as a textarea from the schema alone, so the
    // plugin owns no panel component.
    text: Schema.string().role('textarea').description('Injected into every Session system prompt').default(''),
  }))

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => renderInjection(scope.get()?.text),
  })
}
