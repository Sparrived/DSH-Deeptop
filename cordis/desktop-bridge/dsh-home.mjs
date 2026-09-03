import { resolve } from 'node:path'

/**
 * Resolve the harness home the running DSH process owns.
 *
 * `dshHomePath` is the accessor app-boot provides on the root context before
 * any profile entry mounts, so a mounted context resolves the same home every
 * official plugin uses (`dshHome` config, then `$DSH_HOME`, then `~/.dsh`).
 * A launcher may instead expose the home as a plain `dshHome` string slot.
 * A context without `get` is not mounted: standalone callers and tests then
 * read the ambient `DSH_HOME` the desktop host exports to its child process.
 *
 * @param ctx - Cordis plugin context, or a plain object for standalone callers.
 * @returns the absolute harness home, or `undefined` when no source names one.
 */
export function resolveDshHome(ctx) {
  if (typeof ctx?.get !== 'function') return normalizeHome(process.env.DSH_HOME)
  const homePath = ctx.get('dshHomePath')
  if (typeof homePath === 'function') {
    const home = normalizeHome(homePath())
    if (home !== undefined) return home
  }
  return normalizeHome(ctx.get('dshHome'))
}

function normalizeHome(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : resolve(trimmed)
}
