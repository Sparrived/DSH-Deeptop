import assert from 'node:assert/strict'
import test from 'node:test'
import { MuxEventSynthesizer } from './events-mux.mjs'

/** Run one control frame through the synthesizer and capture its emits. */
function synthesize(frame) {
  const emitted = []
  const synthesizer = new MuxEventSynthesizer({}, item => emitted.push(item), new AbortController().signal)
  synthesizer.onControlFrame(frame)
  synthesizer.dispose()
  return emitted
}

function queuePayload(item) {
  return item?.payload?.type === 'session/queue' ? item.payload : undefined
}

function jobsPayload(item) {
  return item?.payload?.type === 'session/jobs' ? item.payload : undefined
}

test('emits live queue replacements that drained to empty so the desktop clears its pending dock', () => {
  const frames = synthesize({ type: 'queue', sessionId: 'session-1', items: [] })
  assert.equal(frames.length, 1)
  assert.deepEqual(queuePayload(frames[0]), { type: 'session/queue', sessionId: 'session-1', items: [] })
})

test('emits live queue replacements that still carry pending items', () => {
  const items = [{ id: 'm1', placement: 'queued', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] } }]
  const frames = synthesize({ type: 'queue', sessionId: 'session-1', items })
  assert.equal(frames.length, 1)
  assert.deepEqual(queuePayload(frames[0]), { type: 'session/queue', sessionId: 'session-1', items })
})

test('does not flood empty queue or jobs frames from a baseline', () => {
  const frames = synthesize({
    type: 'baseline',
    value: {
      queues: { 'session-1': [], 'session-2': [] },
      jobs: { 'session-1': [], 'session-2': [] },
      projections: {},
    },
  })
  assert.equal(frames.length, 0)
})

test('emits live jobs replacements that drained to empty so finished jobs leave the task panel', () => {
  const frames = synthesize({ type: 'jobs', sessionId: 'session-1', jobs: [] })
  assert.equal(frames.length, 1)
  assert.deepEqual(jobsPayload(frames[0]), { type: 'session/jobs', sessionId: 'session-1', jobs: [] })
})
