// Mux-channel event synthesis for the desktop bridge.
//
// DSH exposes durable session events, transient Assistant stream frames,
// control state, and approval/question answerers separately. This module keeps
// the established desktop wire contract while forwarding those sources.

import { randomUUID } from 'node:crypto'

const APPROVAL_OUTCOME_VALUES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable'])

export class MuxEventSynthesizer {
  constructor(ctx, emit, signal) {
    this.ctx = ctx
    this.emit = emit
    this.signal = signal
    this.registry = this.createAnswerRegistry()
    this.pendingAnswers = new Map()
    this.assistantAttempts = new Map()
    this.nextAssistantStreamSeq = Number.MIN_SAFE_INTEGER
    this.disposers = []
  }

  createAnswerRegistry() {
    const owner = this
    return {
      async resolve(rpcId, answer) {
        const pending = owner.pendingAnswers.get(rpcId)
        if (pending === undefined) {
          throw Object.assign(new Error(`no pending desktop answer for ${JSON.stringify(rpcId)}`), {
            code: 'answer-unavailable',
          })
        }
        owner.pendingAnswers.delete(rpcId)
        pending.signal?.removeEventListener('abort', pending.onAbort)
        await pending.settle(answer)
      },
    }
  }

  /** Register the answer registry on ctx so routes.mjs respond() can settle it. */
  provide(ctx) {
    if (typeof ctx.provide === 'function') {
      try {
        ctx.provide('deeptopAnswerRegistry', this.registry)
      } catch {
        // A duplicate provide (bridge restarted in the same fiber) keeps the
        // earlier registry; pending requests answered by the earlier one.
      }
    }
  }

  async start() {
    const ctx = this.ctx
    const push = this.emit

    this.disposers.push(ctx.on('session/event', (session, event) => {
      if (!session || !event) return
      const tails = ctx.get?.('deeptopSessionTails')
      if (typeof session.id === 'string' && Number.isSafeInteger(event.seq)) {
        tails?.remember?.(session.id, event.seq)
      }
      push({
        rpcId: randomUUID(),
        payload: {
          type: 'session/event',
          sessionId: session.id,
          event,
        },
      })
    }))

    // Alpha.1 moved in-progress output out of the durable log. Adapt its
    // process-local frames to the desktop's existing assistant/chunk surface.
    this.disposers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (!agent || !frame || typeof agent.session?.id !== 'string') return
      const attemptKey = `${agent.session.id}/${frame.attemptId}`
      if (frame.type === 'start') {
        if (!Number.isSafeInteger(frame.revision) || !Number.isSafeInteger(frame.turn) || !Number.isSafeInteger(frame.step)) return
        this.assistantAttempts.set(attemptKey, { turn: frame.turn, step: frame.step, nextIndex: 0 })
        return
      }
      if (frame.type === 'end') {
        this.assistantAttempts.delete(attemptKey)
        return
      }
      const attempt = this.assistantAttempts.get(attemptKey)
      if (attempt === undefined
        || !Number.isSafeInteger(frame.index)
        || frame.index < 0
        || frame.index !== attempt.nextIndex
        || !Number.isSafeInteger(frame.time)
        || !frame.chunk
        || typeof frame.chunk !== 'object') return
      attempt.nextIndex += 1
      const chunk = frame.chunk
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta' && chunk.type !== 'tool-call-delta') return
      push({
        rpcId: randomUUID(),
        payload: {
          type: 'session/event',
          sessionId: agent.session.id,
          event: {
            type: 'assistant/chunk',
            // Transient chunks have no durable seq. Keep them in a separate
            // negative range while preserving arrival order; Alpha revisions
            // grow for every frame and cannot determine chunk ordering.
            seq: this.nextAssistantStreamSeq++,
            time: frame.time,
            data: { turn: attempt.turn, step: attempt.step, chunk },
          },
        },
      })
    }))

    // ── approval / question answerers (waterfall) ─────────────────────────
    this.disposers.push(ctx.on('approval/request', (request, next) => {
      if (!request || typeof request !== 'object' || !request.agent || typeof request.toolName !== 'string') {
        return next()
      }
      const rpcId = randomUUID()
      const sessionId = request.agent.id
      const frame = {
        type: 'approval/requested',
        sessionId,
        approvalId: rpcId,
        toolName: request.toolName,
        ...(request.callId === undefined ? {} : { callId: request.callId }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      }
      return this.pend({ rpcId, kind: 'approval', sessionId, request, frame, next })
    }))

    this.disposers.push(ctx.on('user-questions/request', (request, next) => {
      if (!request || typeof request !== 'object' || !Array.isArray(request.questions)) {
        return next()
      }
      const rpcId = randomUUID()
      const sessionId = request.agent === undefined ? undefined : request.agent.id
      const frame = {
        type: 'question/requested',
        ...(sessionId === undefined ? {} : { sessionId }),
        questions: request.questions,
      }
      return this.pend({ rpcId, kind: 'question', sessionId, request, frame, next })
    }))

    // ── control state (queue / jobs / projections) ────────────────────────
    this.controlIteration = this.runControl()
  }

  /** One pending answerable request: settled by respond() or request abort. */
  pend(entry) {
    const signal = entry.request.signal
    const settle = async (value) => {
      if (entry.settled) return
      entry.settled = true
      this.pendingAnswers.delete(entry.rpcId)
      if (entry.kind === 'approval') {
        const outcome = typeof value?.outcome === 'string' && APPROVAL_OUTCOME_VALUES.has(value.outcome)
          ? value.outcome
          : 'cancelled'
        entry.resolve(outcome)
        this.emit({
          rpcId: randomUUID(),
          payload: {
            type: 'approval/resolved',
            sessionId: entry.sessionId,
            approvalId: entry.rpcId,
            outcome,
          },
        })
        return
      }
      const answer = value?.answer
      if (!answer || typeof answer !== 'object' || !Array.isArray(answer.answers)) {
        entry.resolve(undefined)
        entry.next()
        this.emit({
          rpcId: randomUUID(),
          payload: { type: 'question/resolved', sessionId: entry.sessionId, questionRpcId: entry.rpcId, outcome: 'cancelled' },
        })
        return
      }
      entry.resolve(answer)
      this.emit({
        rpcId: randomUUID(),
        payload: { type: 'question/resolved', sessionId: entry.sessionId, questionRpcId: entry.rpcId, outcome: 'answered' },
      })
    }
    entry.onAbort = () => {
      if (entry.settled) return
      entry.settled = true
      this.pendingAnswers.delete(entry.rpcId)
      entry.resolve(undefined)
      entry.next()
    }
    if (signal?.aborted) {
      entry.onAbort()
      return undefined
    }
    signal?.addEventListener('abort', entry.onAbort, { once: true })
    entry.settled = false
    entry.settle = settle
    this.pendingAnswers.set(entry.rpcId, entry)
    // The frame's rpcId IS the answerable id: the frontend answers via
    // respond() with event.frame.rpcId, which must match the pending key.
    this.emit({ rpcId: entry.rpcId, payload: entry.frame })
    return new Promise(resolve => {
      entry.resolve = resolve
    })
  }

  async runControl() {
    const ctx = this.ctx
    const controller = ctx.get?.('sessionController')
    if (!controller || typeof controller.control !== 'function') {
      throw new Error('session control synthesis requires @deepseek-ai/dsh-api-session-controller')
    }
    try {
      for await (const frame of controller.control(this.signal)) {
        this.onControlFrame(frame)
      }
    } catch {
      // Stream ended; a restart reopens it. The desktop marks this by stopping
      // the whole bridge only when the stream itself is fatal.
    }
  }

  onControlFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'baseline') {
      const value = frame.value
      if (!value || typeof value !== 'object') return
      this.emitQueues(Object.entries(value.queues ?? {}))
      this.emitJobs(Object.entries(value.jobs ?? {}))
      const projections = value.projections ?? {}
      for (const [sessionId, block] of Object.entries(projections)) {
        this.emitProjections(sessionId, block)
      }
      return
    }
    if (frame.type === 'queue') {
      // A drained queue (items: []) must reach the desktop so the pending
      // dock can clear; only the live replacement is forwarded.
      this.emitQueues([[frame.sessionId, frame.items]], { includeEmpty: true })
      return
    }
    if (frame.type === 'jobs') {
      this.emitJobs([[frame.sessionId, frame.jobs]], { includeEmpty: true })
      return
    }
    if (frame.type === 'projection') {
      this.emitProjections(frame.sessionId, { values: { [frame.key]: frame.value }, asOfSeq: frame.seq })
    }
  }

  // A live replacement to an empty list is the only fact that tells the
  // desktop a pending item was consumed (claimed, removed, or edited away).
  // Baseline entries may stay empty-skipped: the frontend already starts
  // cleared, and emitting every empty queue/jobs pair would flood the stream.
  emitQueues(entries, { includeEmpty = false } = {}) {
    for (const [sessionId, items] of entries) {
      if (!Array.isArray(items) || (items.length === 0 && !includeEmpty)) continue
      this.emit({
        rpcId: randomUUID(),
        payload: { type: 'session/queue', sessionId, items },
      })
    }
  }

  emitJobs(entries, { includeEmpty = false } = {}) {
    for (const [sessionId, jobs] of entries) {
      if (!Array.isArray(jobs) || (jobs.length === 0 && !includeEmpty)) continue
      this.emit({
        rpcId: randomUUID(),
        payload: { type: 'session/jobs', sessionId, jobs },
      })
    }
  }

  emitProjections(sessionId, block) {
    const values = block?.values
    if (!values || typeof values !== 'object') return
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue
      this.emit({
        rpcId: randomUUID(),
        payload: {
          type: 'session/projection',
          sessionId,
          key,
          value,
          seq: block.asOfSeq ?? 0,
        },
      })
    }
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose()
    for (const [, pending] of this.pendingAnswers) {
      pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.next()
    }
    this.pendingAnswers.clear()
  }
}
