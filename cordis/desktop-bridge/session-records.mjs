// rc.1 session history/follow wire records → desktop display entries.
//
// session-controller `page`/`follow` return records from packChunkRuns:
//   { type: 'event',  event: SessionWireEvent }          (raw event)
//   { type: 'chunks', event: chunkrow/* packed delta run } (>=3 consecutive
//     same-block assistant/chunk deltas collapsed by the official codec)
// The desktop frontend consumes unfolded `assistant/chunk` events (display
// history compacts them itself), so each packed run is expanded back into its
// exact original events before display compaction.

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

/** Whether one wire record is a packed chunk run. */
export function isChunkRecord(value) {
  const event = record(value)?.event
  const type = event?.type
  return type === 'chunkrow/text-chunks'
    || type === 'chunkrow/reasoning-chunks'
    || type === 'chunkrow/tool-call-chunks'
}

function safeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/**
 * Expand one chunkrow/* wire record into its original assistant/chunk events.
 * Mirrors the official decoder (chunk-rows.ts expandRow): members are
 * consecutive deltas with seq = seq0 + k and time = time0 + cumulative gaps.
 * @param entry - a `{ type: 'chunks', event }` record from a history page.
 * @returns the original assistant/chunk session events, in log order.
 */
export function expandChunkRecord(entry) {
  const event = record(entry)?.event
  if (!event) return []
  const kind = event.type
  const data = record(event.data)
  if (!data) return []
  const members = kind === 'chunkrow/tool-call-chunks' ? data.args : data.texts
  if (!Array.isArray(members)) return []
  const dt = Array.isArray(data.dt) ? data.dt : []
  if (!safeInteger(event.seq) || !safeInteger(event.time)) return []
  const chunks = []
  let time = event.time
  for (let index = 0; index < members.length; index += 1) {
    if (index > 0) {
      const gap = dt[index - 1]
      if (!safeInteger(gap)) return []
      time += gap
    }
    let chunk
    switch (kind) {
      case 'chunkrow/text-chunks':
        chunk = { type: 'text-delta', index: data.index, text: members[index] }
        break
      case 'chunkrow/reasoning-chunks':
        chunk = { type: 'reasoning-delta', index: data.index, text: members[index] }
        break
      case 'chunkrow/tool-call-chunks':
        chunk = {
          type: 'tool-call-delta',
          index: data.index,
          id: data.id,
          ...(data.name === undefined ? {} : { name: data.name }),
          argumentsDelta: members[index],
        }
        break
      default:
        return []
    }
    chunks.push({
      type: 'assistant/chunk',
      seq: event.seq + index,
      time,
      data: { turn: data.turn, step: data.step, chunk },
    })
  }
  return chunks
}

/**
 * Normalize one rc.1 history record to the desktop wire form consumed by
 * display-history: raw events pass through; packed chunk rows expand.
 * @returns the unfolded session events.
 */
export function unfoldRecord(entry) {
  if (isChunkRecord(entry)) return expandChunkRecord(entry)
  const event = record(entry)?.event
  return event === undefined ? [] : [event]
}

/** Unfold one page of records to flat events in log order. */
export function unfoldRecords(records) {
  if (!Array.isArray(records)) return []
  return records.flatMap(unfoldRecord)
}
