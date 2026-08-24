import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'

/**
 * 官方同名 ui-theme 设置命名空间（Host 注册，与 web-app bundle 一致）。
 *
 * 官方 `@deepseek-ai/dsh-client-ui-theme` 的 Host 半区注册 `ui-theme` 命名
 * 空间，字段 `preference: light | dark | system`（默认 system），供
 * settings.describe / mutate 读写。桌面 Profile 不加载 WebUI client bundle，
 * 由本插件注册同一命名空间与取值，使 Deeptop 的主题设置与官方共享同一份
 * settings.yaml 语义，并可与 web 端配置互相持久化。
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
}