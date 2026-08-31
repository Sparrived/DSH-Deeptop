import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const MAX_NOTE_BYTES = 8192
const EMPTY_ITEMS = Object.freeze([])

const annotationItemSchema = z.object({
  messageId: z.string().min(1),
  note: z.string().refine(value => value.trim().length > 0),
  version: z.uuid(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).refine(item => item.updatedAt >= item.createdAt)

const annotationIdentitySchema = z.object({
  createdAt: z.number().int().nonnegative(),
  cwd: z.string().optional(),
})

const annotationRowSchema = z.object({
  session: annotationIdentitySchema,
  items: z.array(annotationItemSchema),
}).superRefine((row, context) => {
  const messageIds = new Set()
  const versions = new Set()
  row.items.forEach((item, index) => {
    if (messageIds.has(item.messageId)) context.addIssue({ code: 'custom', path: ['items', index, 'messageId'], message: 'duplicate message annotation id' })
    if (versions.has(item.version)) context.addIssue({ code: 'custom', path: ['items', index, 'version'], message: 'duplicate message annotation version' })
    messageIds.add(item.messageId)
    versions.add(item.version)
  })
})

const annotationDomainSpec = defineDomain({
  name: 'message_annotations',
  version: 0,
  tables: { sessions: domainTable(annotationRowSchema) },
})

function success(value) {
  return { ok: true, value }
}

function rejected(error) {
  return { ok: false, error }
}

function snapshotItem(item) {
  return {
    messageId: item.messageId,
    note: item.note,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function identityOf(header) {
  return {
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}

function sameIdentity(row, header) {
  return row.session.createdAt === header.createdAt && row.session.cwd === header.cwd
}

function rowSnapshot(header, items) {
  return {
    session: identityOf(header),
    items: items.map(snapshotItem),
  }
}

function sameHeaderIdentity(left, right) {
  return left.id === right.id && left.createdAt === right.createdAt && left.cwd === right.cwd
}

function noteResult(note) {
  if (typeof note !== 'string' || note.trim().length === 0) return rejected({ code: 'note-blank' })
  const actualBytes = Buffer.byteLength(note, 'utf8')
  if (actualBytes > MAX_NOTE_BYTES) return rejected({ code: 'note-too-large', maxBytes: MAX_NOTE_BYTES, actualBytes })
  return success(note)
}

function requestText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`message-annotations: ${field} must be a non-empty string`)
  return value
}

function targetIn(events, messageId) {
  return events.some(event => {
    if ((event.type !== 'user/message' && event.type !== 'assistant/message') || !isAppendSurfaceEvent(event)) return false
    const message = deriveEventMessage(event)
    return (message?.role === 'user' || message?.role === 'assistant') && message.id === messageId
  })
}

export class MessageAnnotationsService extends Service {
  static inject = ['storageDomain', 'sessionPersistence', 'sessions']

  table
  operationTails = new Map()
  mutationAdmissionOpen = true

  constructor(ctx) {
    super(ctx, 'messageAnnotations')
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(annotationDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await Promise.all(this.operationTails.values())
      await domain.close()
    }, 'message-annotations.domainClose')
    this.table = domain.table('sessions')
  }

  async list(request) {
    const sessionId = requestText(request?.sessionId, 'sessionId')
    const known = await this.inspectSession(sessionId)
    if (!known.ok) return known
    const row = this.requireTable().get(sessionId)
    const items = row !== undefined && sameIdentity(row, known.value.meta) ? row.items : EMPTY_ITEMS
    return success({ items: items.map(snapshotItem) })
  }

  put(request) {
    const sessionId = requestText(request?.sessionId, 'sessionId')
    const messageId = requestText(request?.messageId, 'messageId')
    if (request?.ifVersion !== null && typeof request?.ifVersion !== 'string') throw new TypeError('message-annotations: ifVersion must be a string or null')
    const note = noteResult(request?.note)
    if (!note.ok) return Promise.resolve(note)
    return this.enqueue(sessionId, async () => {
      const known = await this.inspectSession(sessionId)
      if (!known.ok) return known
      if (!targetIn(known.value.events, messageId)) return rejected({ code: 'target-not-found', sessionId, messageId })
      const durable = await this.ensureTargetDurable(known.value)
      if (!sameHeaderIdentity(durable.meta, known.value.meta) || !targetIn(durable.events, messageId)) return rejected({ code: 'target-not-found', sessionId, messageId })
      const table = this.requireTable()
      const stored = table.get(sessionId)
      const items = stored !== undefined && sameIdentity(stored, durable.meta) ? stored.items : EMPTY_ITEMS
      const index = items.findIndex(item => item.messageId === messageId)
      const existing = items[index]
      if (request.ifVersion !== (existing?.version ?? null)) return rejected({ code: 'version-conflict', current: existing ? snapshotItem(existing) : null })
      if (existing?.note === note.value) return success(snapshotItem(existing))
      const now = Date.now()
      const item = snapshotItem({
        messageId,
        note: note.value,
        version: randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing === undefined ? now : Math.max(now, existing.updatedAt),
      })
      const nextItems = [...items]
      if (index === -1) nextItems.push(item)
      else nextItems[index] = item
      await table.put(sessionId, rowSnapshot(durable.meta, nextItems))
      return success(item)
    })
  }

  delete(request) {
    const sessionId = requestText(request?.sessionId, 'sessionId')
    const messageId = requestText(request?.messageId, 'messageId')
    if (request?.ifVersion !== null && typeof request?.ifVersion !== 'string') throw new TypeError('message-annotations: ifVersion must be a string or null')
    return this.enqueue(sessionId, async () => {
      const known = await this.inspectSession(sessionId)
      if (!known.ok) return known
      const table = this.requireTable()
      const stored = table.get(sessionId)
      const items = stored !== undefined && sameIdentity(stored, known.value.meta) ? stored.items : EMPTY_ITEMS
      const existing = items.find(item => item.messageId === messageId)
      if (existing === undefined) return success({ absent: true })
      if (request.ifVersion !== existing.version) return rejected({ code: 'version-conflict', current: snapshotItem(existing) })
      await table.put(sessionId, rowSnapshot(known.value.meta, items.filter(item => item !== existing)))
      return success({ absent: true })
    })
  }

  async inspectSession(sessionId) {
    if (this.ctx.sessions.get(sessionId) === undefined) {
      const snapshots = await this.ctx.sessionPersistence.listSnapshots()
      if (!snapshots.some(snapshot => snapshot.header.id === sessionId) && this.ctx.sessions.get(sessionId) === undefined) return rejected({ code: 'session-not-found', sessionId })
    }
    return success(await this.ctx.sessionPersistence.inspect(sessionId))
  }

  async ensureTargetDurable(inspection) {
    const live = this.ctx.sessions.get(inspection.meta.id)
    if (live !== undefined && sameHeaderIdentity(live.header, inspection.meta)) {
      if (!await this.ctx.sessions.flush(live)) throw new Error(`message-annotations: no durability listener participated for live session '${inspection.meta.id}'`)
    }
    return this.ctx.sessionPersistence.readFrom(inspection.meta.id, 0)
  }

  enqueue(sessionId, operation) {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('message-annotations: service is disposing'))
    const result = (this.operationTails.get(sessionId) ?? Promise.resolve()).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.operationTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId)
    })
  }

  requireTable() {
    if (this.table === undefined) throw new Error('message-annotations: durable domain is not initialized')
    return this.table
  }
}

export default MessageAnnotationsService
