import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareContributionOrder,
  normalizeUiPluginDescriptor,
  sdkVersionCompatible,
  toSessionUiContext,
  UI_RUNTIME_SDK_VERSION,
  UI_RUNTIME_SLOTS,
} from './ui-plugin-model.ts'

test('slot whitelist covers the first-version fixed slots', () => {
  assert.ok(UI_RUNTIME_SLOTS.includes('session.context-menu'))
  assert.equal(new Set(UI_RUNTIME_SLOTS).size, UI_RUNTIME_SLOTS.length, 'slot names stay unique')
})

test('descriptor normalization accepts valid items and skips broken ones with diagnostics', () => {
  const valid = {
    pluginId: 'example.session-pins',
    version: '0.1.0',
    displayName: 'Session Pins',
    status: 'available',
    client: { entryId: 'example.session-pins/client', format: 'esm', sdkVersion: '^1.0.0' },
    slots: ['session.context-menu', 'unknown.slot'],
    capabilities: {
      remotes: [{ namespace: 'sessionPins', methods: ['list', 'toggle'] }],
      events: ['sessionPins/changed'],
      storage: 'session-pins',
    },
    contributions: [
      { kind: 'action', id: 'pins.toggle', slot: 'session.context-menu', label: '置顶会话', invoke: { namespace: 'sessionPins', method: 'toggle' } },
      { kind: 'weird', id: 'x' },
      null,
    ],
  }
  // Unknown slot names are filtered; at least one known slot keeps the plugin.
  const withUnknownSlot = { ...valid, client: undefined }
  const filtered = normalizeUiPluginDescriptor(withUnknownSlot).descriptor
  assert.deepEqual(filtered?.slots, ['session.context-menu'])
  assert.equal(filtered?.contributions.length, 1, 'only well-formed contributions survive')
  assert.equal(filtered?.client, undefined)

  const noKnownSlots = normalizeUiPluginDescriptor({ ...valid, slots: ['unknown.slot'] })
  assert.equal(noKnownSlots.descriptor, null)
  assert.match(noKnownSlots.diagnostic ?? '', /没有已知 Slot/)

  const ok = normalizeUiPluginDescriptor({ ...valid, client: undefined }).descriptor
  assert.equal(ok?.pluginId, 'example.session-pins')
  assert.deepEqual(ok?.capabilities.remotes, [{ namespace: 'sessionPins', methods: ['list', 'toggle'] }])
  assert.equal(normalizeUiPluginDescriptor('nope').descriptor, null)
  assert.match(normalizeUiPluginDescriptor({ version: '1.0.0' }).diagnostic ?? '', /pluginId/)
})

test('SDK range checks pin majors and tilde pins minors', () => {
  const runtime = UI_RUNTIME_SDK_VERSION
  assert.equal(sdkVersionCompatible('^1.0.0', runtime), true)
  assert.equal(sdkVersionCompatible('~1.0.0', runtime), true)
  assert.equal(sdkVersionCompatible('~1.1.0', runtime), false)
  assert.equal(sdkVersionCompatible('^2.0.0', runtime), false)
  assert.equal(sdkVersionCompatible('1.0.0', runtime), true)
  assert.equal(sdkVersionCompatible('latest', runtime), false)
  assert.equal(sdkVersionCompatible('', runtime), false)
  assert.equal(sdkVersionCompatible('^1.0.0', ''), false)
})

test('contribution ordering is deterministic across plugins', () => {
  const order = (item) => item
  assert.equal(compareContributionOrder(order({ order: 1, id: 'b', pluginId: 'a' }), order({ order: 2, id: 'a', pluginId: 'z' }), ), -1)
  assert.equal(compareContributionOrder(order({ id: 'b', pluginId: 'a' }), order({ order: -1, id: 'a', pluginId: 'z' })), 1)
  assert.equal(compareContributionOrder(order({ id: 'b', pluginId: 'a' }), order({ id: 'a', pluginId: 'a' })), 1)
  assert.equal(compareContributionOrder(order({ id: 'a', pluginId: 'a' }), order({ id: 'a', pluginId: 'a' })), 0)
  assert.equal(compareContributionOrder(order({ order: 3, id: 'a', pluginId: 'a' }), order({ order: 3, id: 'a', pluginId: 'b' })), -1)
})

test('session context projection keeps only the serializable view', () => {
  const context = toSessionUiContext({
    sessionId: 's-1',
    running: true,
    blank: false,
    cwd: 'D:\\repo',
    agentPreset: 'standard',
    parentSessionId: 'parent-9',
  }, '修复登录')
  assert.deepEqual(context, {
    sessionId: 's-1',
    title: '修复登录',
    cwd: 'D:\\repo',
    running: true,
    blank: false,
    agentPreset: 'standard',
  })
})
