// Host registration for the prompt-injection client module. The injection
// domain stays in `deeptop-prompt-injection`: that plugin owns the namespace and
// the pre-step context message, while this adapter declares the settings panel
// and the scoped settings ceiling the client module renders inside.

export const name = 'deeptop-prompt-injection-ui'

export const inject = ['deeptopUiRegistry']

export function apply(ctx) {
  const registry = ctx.get('deeptopUiRegistry')
  const dispose = registry.registerUiPlugin({
    schemaVersion: 1,
    pluginId: 'deeptop.prompt-injection',
    version: '0.1.0',
    displayName: 'Prompt injection',
    client: {
      entryId: 'deeptop.prompt-injection/client',
      format: 'esm',
      sdkVersion: '^1.0.0',
    },
    ui: {
      slots: ['settings.sections'],
    },
    capabilities: {
      // The ceiling this plugin may read and write; declaring it is not a grant,
      // because every call names the namespace and the route re-checks this list.
      settings: ['deeptop-prompt-injection'],
    },
  })
  return () => dispose()
}
