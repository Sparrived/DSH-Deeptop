import { DesktopBridge } from './bridge.mjs'

export const name = 'deeptop-bridge'
export const inject = ['pluginInventory', 'llm', 'typertGateway', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'sessionQuery', 'messageAnnotations', 'agents', 'sessionController', 'workspaceController', 'settingsController', 'subagents', 'agentPresets', 'goals']

export function apply(ctx) {
  const bridge = new DesktopBridge(ctx)
  void bridge.start().catch(async error => {
    try {
      await bridge.writeFatal(error)
    } catch {
      // stdout itself may be the failure; never turn that into an unhandled rejection.
    } finally {
      ctx.get('appExit')?.(1)
    }
  })
  return () => bridge.dispose()
}
