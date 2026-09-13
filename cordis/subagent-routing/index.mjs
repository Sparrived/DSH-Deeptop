// 子代理模型路由的 Host 插件。
//
// 本插件只拥有「说明」这一层：用户在设置里为每个可选路由写一句「何时使用」，
// 插件把这段文字注入每个 Session 的 system prompt，并把它投影到支持
// `models[].description` 的 provider catalog。白名单（能选哪些路由）仍由官方
// `subagent-model-selection` 命名空间强制，桌面设置面板负责写入，本插件不写政策。

import Schema from '@deepseek-ai/schemastery'
import {
  ROUTING_NAMESPACE,
  SECTION_NAME,
  SECTION_ORDER,
  isRecord,
  modelsWithNotes,
  notesByProvider,
  renderGuidance,
  supportsModelDescription,
  valueAtPath,
} from './model.mjs'

export const name = 'deeptop-subagent-routing'

export const inject = ['settings', 'systemPrompt']

export function apply(ctx) {
  const scope = ctx.settings.register(ROUTING_NAMESPACE, Schema.object({
    routes: Schema.array(Schema.object({
      provider: Schema.string().required(),
      model: Schema.string().required(),
      note: Schema.string().default(''),
    })).default([]),
    guidance: Schema.string().default(''),
  }))

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => renderGuidance(scope.get()?.routes, scope.get()?.guidance),
  })

  scope.watch((next) => {
    // 投影失败不得影响触发它的那次设置提交。
    return projectModelNotes(ctx, next).catch((error) => {
      ctx.logger?.warn?.(`subagent routing: model description projection failed: ${error?.message ?? error}`)
    })
  })
}

/**
 * 把每个路由的说明写进所属 provider catalog 的 `description`。
 *
 * 只处理在 `ctx.llm.listConfigurableProviders()` 中登记、且自身 schema 声明了
 * `models[].description` 的命名空间：该字段是 `list_subagent_models` 唯一会读到的
 * 说明来源，写不进去的后端（例如 llm-pi-ai）由 system prompt 引导段保底。
 * 空的说明不动 catalog；已等于目标文本的条目不会被重写。
 *
 * @param ctx - 插件上下文。
 * @param value - `deeptop-subagent-routing` 的当前值。
 */
async function projectModelNotes(ctx, value) {
  const grouped = notesByProvider(value?.routes)
  if (grouped.size === 0) return
  const llm = ctx.get('llm')
  if (typeof llm?.listConfigurableProviders !== 'function') return
  const directory = llm.listConfigurableProviders()
  const descriptors = ctx.settings.describe()
  for (const [provider, notes] of grouped) {
    const entry = directory.find((candidate) => candidate?.provider === provider)
    if (entry === undefined || typeof entry.settingsNs !== 'string') continue
    const descriptor = descriptors.find((candidate) => candidate?.ns === entry.settingsNs)
    if (descriptor === undefined || !supportsModelDescription(descriptor.schema)) continue
    const settingsPath = Array.isArray(entry.settingsPath) ? [...entry.settingsPath] : []
    const profile = valueAtPath(descriptor.value, settingsPath)
    const models = isRecord(profile) && Array.isArray(profile.models) ? profile.models : []
    const applied = modelsWithNotes(models, notes)
    if (!applied.changed) continue
    // 写整个数组：DSH 的 settings.mutate 路径操作不支持数组下标，且 catalog 的
    // 解析值已经带上 schema 默认项，这里只改其中一条的说明。
    await ctx.settings.mutate(entry.settingsNs, [{
      op: 'set',
      path: [...settingsPath, 'models'],
      value: applied.models,
    }])
  }
}
