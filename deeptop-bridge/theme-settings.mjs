import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'

/**
 * 官方同名 ui-theme / locale 设置命名空间（Host 注册，与 web-app bundle 一致）。
 *
 * 官方 `@deepseek-ai/dsh-client-ui-theme` 与 `@deepseek-ai/dsh-client-locale`
 * 的 Host 半区分别注册 `ui-theme`（preference: light|dark|system）与
 * `locale`（preference: zh|en，可选）。桌面 Profile 不加载 WebUI client
 * bundle，由本插件注册同一命名空间与取值，使 Deeptop 的主题与语言设置与
 * 官方共享同一份 settings.yaml 语义，并可与 web 端配置互相持久化。
 */

export const name = 'deeptop-theme-settings'

export const inject = ['settings']

export function apply(ctx) {
  const preferenceSchema = Schema.union([
    Schema.const('light').description('Light theme'),
    Schema.const('dark').description('Dark theme'),
    Schema.const('system').description('Follow the system'),
  ]).default('system')

  const themeSchema = Schema.object({
    preference: preferenceSchema,
  })

  ctx.settings.register(settingsNamespace('ui-theme'), themeSchema)

  const localeSchema = Schema.object({
    preference: Schema.union([
      Schema.const('zh').description('Chinese'),
      Schema.const('en').description('English'),
    ]).required(false),
  })

  ctx.settings.register(settingsNamespace('locale'), localeSchema)
}