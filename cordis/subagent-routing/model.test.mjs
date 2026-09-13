import assert from 'node:assert/strict'
import test from 'node:test'
import {
  modelsWithNotes,
  normalizeRoutes,
  notesByProvider,
  renderGuidance,
  routesToAllowedModels,
  supportsModelDescription,
  valueAtPath,
} from './model.mjs'

test('normalizes routes by trimming and dropping incomplete or duplicate entries', () => {
  const routes = normalizeRoutes([
    { provider: ' deepseek-official ', model: 'deepseek-v4-pro', note: ' 疑难推理 ' },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', note: '重复' },
    { provider: '', model: 'x' },
    { provider: 'p' },
    { provider: 'p', model: '   ' },
    null,
    'nope',
    { provider: 'p', model: 'm' },
  ])
  assert.deepEqual(routes, [
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', note: '疑难推理' },
    { provider: 'p', model: 'm', note: '' },
  ])
  assert.deepEqual(normalizeRoutes(undefined), [])
  assert.deepEqual(normalizeRoutes({ provider: 'p', model: 'm' }), [])
})

test('projects routes onto the official exact-route list', () => {
  assert.deepEqual(
    routesToAllowedModels([{ provider: 'p', model: 'm', note: '忽略说明' }]),
    [{ provider: 'p', model: 'm' }],
  )
})

test('renders an empty section without routes and lets custom text replace the block', () => {
  assert.equal(renderGuidance([], '   '), '')
  assert.equal(renderGuidance([], '自定义路由规则'), '自定义路由规则')
  assert.equal(renderGuidance([{ provider: 'p', model: 'm', note: '说明' }], '覆盖'), '覆盖')
})

test('renders each configured route with its note and the delegation reminder', () => {
  const text = renderGuidance([
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', note: '例行与并行任务' },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  ], '')
  assert.match(text, /deepseek-official\/deepseek-v4-flash` — 例行与并行任务/)
  assert.match(text, /^- `deepseek-official\/deepseek-v4-pro`$/m)
  assert.match(text, /list_subagent_models/)
  assert.match(text, /Omitting both keeps the default route\./)
})

test('detects a catalog that declares models[].description', () => {
  const supported = {
    uid: 0,
    refs: {
      0: { type: 'object', dict: { models: 1 } },
      1: { type: 'array', inner: 2 },
      2: { type: 'object', dict: { id: 3, description: 4 } },
      3: { type: 'string' },
      4: { type: 'string' },
    },
  }
  assert.equal(supportsModelDescription(supported), true)

  const withoutDescription = {
    uid: 0,
    refs: {
      0: { type: 'object', dict: { models: 1 } },
      1: { type: 'array', inner: 2 },
      2: { type: 'object', dict: { id: 3 } },
      3: { type: 'string' },
    },
  }
  assert.equal(supportsModelDescription(withoutDescription), false)
  assert.equal(supportsModelDescription({ uid: 0, refs: { 0: { type: 'object', dict: {} } } }), false)
  assert.equal(supportsModelDescription({ uid: 0, refs: { 0: { type: 'object', dict: { models: 9 } } } }), false)
  assert.equal(supportsModelDescription(undefined), false)
})

test('walks the provider settings path without inventing steps', () => {
  const value = { providers: { openrouter: { models: [{ id: 'm' }] } } }
  assert.deepEqual(valueAtPath(value, ['providers', 'openrouter', 'models']), [{ id: 'm' }])
  assert.equal(valueAtPath(value, []), value)
  assert.equal(valueAtPath(value, ['providers', 'missing', 'models']), undefined)
  assert.equal(valueAtPath(undefined, ['providers']), undefined)
})

test('applies only non-empty notes that actually change a model', () => {
  const models = [
    { id: 'a', description: 'Fast' },
    { id: 'b' },
    { id: 'c' },
  ]
  const applied = modelsWithNotes(models, new Map([['b', '疑难推理']]))
  assert.equal(applied.changed, true)
  assert.deepEqual(applied.models, [
    { id: 'a', description: 'Fast' },
    { id: 'b', description: '疑难推理' },
    { id: 'c' },
  ])
  assert.equal(modelsWithNotes(applied.models, new Map([['b', '疑难推理']])).changed, false)
  assert.equal(modelsWithNotes(models, new Map()).changed, false)
  assert.equal(modelsWithNotes(undefined, new Map([['b', 'x']])).changed, false)
})

test('groups notes per provider and skips routes without one', () => {
  const grouped = notesByProvider([
    { provider: 'p', model: 'a', note: '甲' },
    { provider: 'p', model: 'b' },
    { provider: 'q', model: 'c', note: '乙' },
  ])
  assert.deepEqual([...grouped.keys()], ['p', 'q'])
  assert.deepEqual([...grouped.get('p').entries()], [['a', '甲']])
  assert.deepEqual([...grouped.get('q').entries()], [['c', '乙']])
})
