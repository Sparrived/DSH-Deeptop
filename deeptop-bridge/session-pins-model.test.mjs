import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSessionPinIds, parseLegacySessionPinStore, pinnedForWorkspace } from './session-pins-model.mjs'

test('normalizes legacy ids and rejects non-array values', () => {
  assert.deepEqual(normalizeSessionPinIds(['session-1', 'session-1', '', null, 'session-2']), ['session-1', 'session-2'])
  assert.deepEqual(normalizeSessionPinIds(undefined), [])
})

test('parses only the supported legacy store version', () => {
  assert.deepEqual(parseLegacySessionPinStore({
    version: 1,
    workspaces: { 'workspace-1': ['session-1', 'session-1'], empty: [] },
  }), { 'workspace-1': ['session-1'] })
  assert.deepEqual(parseLegacySessionPinStore({ version: 2, workspaces: { 'workspace-1': ['session-1'] } }), {})
})

test('filters pins against authoritative workspace membership', () => {
  assert.deepEqual(
    pinnedForWorkspace({ id: 'workspace-1', sessionIds: ['session-2'] }, ['session-1', 'session-2', 'session-2']),
    ['session-2'],
  )
})
