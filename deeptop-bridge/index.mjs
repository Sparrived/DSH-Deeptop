import { DesktopBridge } from './bridge.mjs'

export const name = 'deeptop-bridge'
export const inject = ['apiProxy', 'pluginInventory', 'llm', 'typertGateway']
export function apply(ctx) {
  const bridge = new DesktopBridge(ctx)
  void bridge.start().catch(error => {
    bridge.writeFatal(error)
    ctx.get('appExit')?.(1)
  })
  return () => bridge.dispose()
}
