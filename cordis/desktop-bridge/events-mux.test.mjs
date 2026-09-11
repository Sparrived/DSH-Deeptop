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

test('normalizes alpha assistant stream deltas into desktop chunks', async () => {
  const handlers = new Map()
  const emitted = []
  const ctx = {
    on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) },
    get(name) {
      if (name === 'sessionController') return { control: async function * () {} }
      return undefined
    },
  }
  const synthesizer = new MuxEventSynthesizer(ctx, item => emitted.push(item), new AbortController().signal)
  await synthesizer.start()
  const stream = handlers.get('agent/assistant-stream')
  stream({ agent: { session: { id: 'session-1' } }, frame: { type: 'start', attemptId: 'attempt-1', revision: 2, turn: 3, step: 4 } })
  stream({ agent: { session: { id: 'session-1' } }, frame: { type: 'chunk', attemptId: 'attempt-1', revision: 3, index: 0, time: 123, chunk: { type: 'text-delta', index: 0, text: 'hi' } } })
  stream({ agent: { session: { id: 'session-1' } }, frame: { type: 'chunk', attemptId: 'attempt-1', revision: 4, index: 1, time: 124, chunk: { type: 'text-delta', index: 0, text: ' there' } } })
  assert.deepEqual(emitted.map(item => item.payload), [
    {
      type: 'session/event',
      sessionId: 'session-1',
      event: { type: 'assistant/chunk', seq: Number.MIN_SAFE_INTEGER, time: 123, data: { turn: 3, step: 4, chunk: { type: 'text-delta', index: 0, text: 'hi' } } },
    },
    {
      type: 'session/event',
      sessionId: 'session-1',
      event: { type: 'assistant/chunk', seq: Number.MIN_SAFE_INTEGER + 1, time: 124, data: { turn: 3, step: 4, chunk: { type: 'text-delta', index: 0, text: ' there' } } },
    },
  ])
  stream({ agent: { session: { id: 'session-1' } }, frame: { type: 'chunk', attemptId: 'attempt-1', revision: 5, index: 3, time: 125, chunk: { type: 'text-delta', index: 0, text: 'skip' } } })
  stream({ agent: { session: { id: 'session-1' } }, frame: { type: 'end', attemptId: 'attempt-1', revision: 6, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 9 } } })
  stream({ agent: { session: { id: 'session-1' } }, frame: { type: 'chunk', attemptId: 'attempt-1', revision: 7, index: 2, time: 126, chunk: { type: 'text-delta', index: 0, text: 'late' } } })
  assert.equal(emitted.length, 2)
  synthesizer.dispose()
})

test('settles question answers from the nested answer payload and cancels empty answers', async () => {
  const emitted = []
  const synthesizer = new MuxEventSynthesizer({}, item => emitted.push(item), new AbortController().signal)
  const question = { answers: [{ id: 'mode', selected: ['Fast'] }] }
  const answered = synthesizer.pend({
    rpcId: 'question-1',
    kind: 'question',
    sessionId: 'session-1',
    request: {},
    frame: { type: 'question/requested' },
    next: () => { throw new Error('answered questions must not delegate') },
  })

  await synthesizer.registry.resolve('question-1', { answer: question })
  assert.deepEqual(await answered, question)
  assert.equal(emitted.at(-1)?.payload?.outcome, 'answered')

  let delegated = false
  const cancelled = synthesizer.pend({
    rpcId: 'question-2',
    kind: 'question',
    sessionId: 'session-1',
    request: {},
    frame: { type: 'question/requested' },
    next: () => { delegated = true },
  })
  await synthesizer.registry.resolve('question-2', {})
  assert.equal(await cancelled, undefined)
  assert.equal(delegated, true)
  assert.equal(emitted.at(-1)?.payload?.outcome, 'cancelled')

  const approval = synthesizer.pend({
    rpcId: 'approval-1',
    kind: 'approval',
    sessionId: 'session-1',
    request: {},
    frame: { type: 'approval/requested' },
    next: () => undefined,
  })
  await synthesizer.registry.resolve('approval-1', { outcome: 'allowed-once' })
  assert.equal(await approval, 'allowed-once')
  assert.equal(emitted.at(-1)?.payload?.outcome, 'allowed-once')
  synthesizer.dispose()
})
