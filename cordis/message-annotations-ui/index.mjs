// Host registration for the built-in message-annotation client module. The
// annotation domain stays in message-annotations.mjs; this adapter only exposes
// its already validated operations to the scoped Deeptop UI Runtime route.

export const name = 'message-annotations-ui'
export const inject = ['deeptopUiRegistry', 'messageAnnotations']

export function apply(ctx) {
  const registry = ctx.get('deeptopUiRegistry')
  const annotations = ctx.get('messageAnnotations')
  const dispose = registry.registerUiPlugin({
    schemaVersion: 1,
    pluginId: 'deeptop.message-annotations',
    version: '0.1.0',
    displayName: 'Message annotations',
    client: {
      entryId: 'deeptop.message-annotations/client',
      format: 'esm',
      sdkVersion: '^1.0.0',
    },
    ui: {
      slots: ['conversation.message.actions'],
    },
    capabilities: {
      remotes: [{ namespace: 'messageAnnotations', methods: ['list', 'put', 'delete'] }],
    },
    remoteHandlers: {
      messageAnnotations: {
        list: (args) => annotations.list(args),
        put: (args) => annotations.put(args),
        delete: (args) => annotations.delete(args),
      },
    },
  })
  return () => dispose()
}
