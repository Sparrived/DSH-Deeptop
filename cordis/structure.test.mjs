import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const pluginDirectories = [
  'desktop-bridge',
  'message-annotations',
  'message-annotations-ui',
  'prompt-injection',
  'prompt-injection-ui',
  'session-pins',
  'skill-installer',
  'subagent-routing',
  'theme-settings',
  'ui-registry',
]

const pluginExports = {
  '.': './desktop-bridge/index.mjs',
  './desktop-bridge': './desktop-bridge/index.mjs',
  './message-annotations': './message-annotations/index.mjs',
  './message-annotations-ui': './message-annotations-ui/index.mjs',
  './prompt-injection': './prompt-injection/index.mjs',
  './prompt-injection-ui': './prompt-injection-ui/index.mjs',
  './session-pins': './session-pins/index.mjs',
  './skill-installer': './skill-installer/index.mjs',
  './skill-install-plugin': './skill-installer/index.mjs',
  './subagent-routing': './subagent-routing/index.mjs',
  './theme-settings': './theme-settings/index.mjs',
  './ui-registry': './ui-registry/index.mjs',
}

test('keeps every built-in Cordis plugin in its own directory', async () => {
  const manifest = JSON.parse(await readFile(join(import.meta.dirname, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'deeptop-bridge', 'the runtime package name stays compatible with existing desktop Profiles')
  for (const [name, target] of Object.entries(pluginExports)) {
    assert.equal(manifest.exports[name], target, `${name} must resolve through its plugin directory`)
  }
  for (const directory of pluginDirectories) {
    assert.equal((await stat(join(import.meta.dirname, directory, 'index.mjs'))).isFile(), true)
  }
  const rootModules = (await readdir(import.meta.dirname, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
    .map(entry => entry.name)
    .filter(name => name !== 'structure.test.mjs')
  assert.deepEqual(rootModules, [], 'Cordis plugin modules must not be flattened into the package root')
})
