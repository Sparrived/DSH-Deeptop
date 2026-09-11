const MERGEABLE_DELTA_TYPES = new Set(['text-delta', 'reasoning-delta', 'tool-call-delta'])

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function coordinates(event) {
  const message = record(event?.data?.message)
  const turn = Number.isFinite(event?.data?.turn) ? event.data.turn : message?.turn
  const step = Number.isFinite(event?.data?.step) ? event.data.step : message?.step
  return Number.isFinite(turn) && Number.isFinite(step) ? { turn, step } : undefined
}

function coordinateKey(event) {
  const value = coordinates(event)
  return value ? `${value.turn}/${value.step}` : undefined
}

function appendOrigin(event) {
  return event?.surfaceOp === undefined || event.surfaceOp === 'append'
}

function chunkOf(entry) {
  return entry?.event?.type === 'assistant/chunk' ? record(entry.event.data?.chunk) : undefined
}

function deltaText(chunk) {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    return typeof chunk.text === 'string' ? chunk.text : undefined
  }
  if (chunk.type === 'tool-call-delta') {
    return typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
  }
  return undefined
}

/**
 * Whether one seq belongs to the transient Assistant stream band.
 *
 * In-progress output is not durable: the mux synthesizes its frames with
 * negative seqs (`events-mux.mjs`) so they stay ordered among themselves
 * without colliding with durable log seqs. Transient frames are display-only
 * and must never take part in durable sequence accounting (page cursors,
 * event counts, transcript position), so every consumer of a raw seq asks
 * this first.
 */
export function isTransientStreamSeq(seq) {
  return typeof seq === 'number' && Number.isFinite(seq) && seq < 0
}

/** Return raw event sequence ranges represented by one display entry. */
export function displayEntrySequenceRanges(entry) {
  return entry?.compactedEventSeqRanges
    ?? entry?.event?.compactedEventSeqRanges
    ?? [[entry.event.seq, entry.event.seq]]
}

/** Merge event sequence ranges into a sorted, non-overlapping union. */
export function mergeDisplaySequenceRanges(...groups) {
  const ordered = groups.flat().map(range => [range[0], range[1]]).sort((left, right) => left[0] - right[0])
  const result = []
  for (const range of ordered) {
    const previous = result.at(-1)
    if (!previous || range[0] > previous[1] + 1) result.push(range)
    else if (range[1] > previous[1]) previous[1] = range[1]
  }
  return result
}

function tokenDelta(entry) {
  const chunk = chunkOf(entry)
  if (!chunk) return false
  const text = deltaText(chunk)
  return (text !== undefined && text !== '') || (chunk.type === 'tool-call-delta' && chunk.name !== undefined)
}

function inlineDeltaLengths(entry) {
  const lengths = entry?.compactedDeltaLengths ?? entry?.event?.compactedDeltaLengths
  if (Array.isArray(lengths)) return lengths
  const chunk = chunkOf(entry)
  const text = chunk && deltaText(chunk)
  return text === undefined ? [] : [text.length]
}

function sequenceCount(entry) {
  return displayEntrySequenceRanges(entry).reduce((count, [start, end]) => count + end - start + 1, 0)
}

function deltaLengthTree(entry) {
  if (entry?.displayDeltaLengthTree) return entry.displayDeltaLengthTree
  const values = inlineDeltaLengths(entry)
  return values.length === sequenceCount(entry) ? { values, count: values.length } : undefined
}

function flattenDeltaLengthTree(tree) {
  if (!tree) return []
  const values = []
  const pending = [tree]
  while (pending.length > 0) {
    const node = pending.pop()
    if (Array.isArray(node.values)) values.push(...node.values)
    else {
      if (node.right) pending.push(node.right)
      if (node.left) pending.push(node.left)
    }
  }
  return values
}

function deltaLengths(entry) {
  return entry?.displayDeltaLengthTree
    ? flattenDeltaLengthTree(entry.displayDeltaLengthTree)
    : inlineDeltaLengths(entry)
}

function deltaSlotKey(entry) {
  const chunk = chunkOf(entry)
  const key = coordinateKey(entry?.event)
  if (!chunk || !key || typeof chunk.type !== 'string' || !MERGEABLE_DELTA_TYPES.has(chunk.type)) return undefined
  const index = Number.isFinite(chunk.index) ? chunk.index : '?'
  return `${key}/${chunk.type}/${index}`
}

function hasDeltaBoundaryMetadata(entry) {
  return entry?.displayDeltaLengthTree !== undefined
    || Array.isArray(entry?.compactedDeltaLengths)
    || Array.isArray(entry?.event?.compactedDeltaLengths)
}

function canMergeDeltaEntries(left, right) {
  if (!hasDeltaBoundaryMetadata(left) && !hasDeltaBoundaryMetadata(right)) return true
  return deltaLengthTree(left) !== undefined && deltaLengthTree(right) !== undefined
}

function withDeltaLengthLeaf(entry) {
  if (!deltaSlotKey(entry) || hasDeltaBoundaryMetadata(entry)) return entry
  const values = inlineDeltaLengths(entry)
  return values.length === sequenceCount(entry)
    ? { ...entry, displayDeltaLengthTree: { values, count: values.length } }
    : entry
}

function mergeDeltaEntries(left, right, trackLengths = false) {
  const leftChunk = chunkOf(left)
  const rightChunk = chunkOf(right)
  const leftLengths = deltaLengthTree(left)
  const rightLengths = deltaLengthTree(right)
  const keepLengths = trackLengths
    || left.displayDeltaLengthTree !== undefined
    || right.displayDeltaLengthTree !== undefined
    || Array.isArray(left.compactedDeltaLengths)
    || Array.isArray(left.event?.compactedDeltaLengths)
    || Array.isArray(right.compactedDeltaLengths)
    || Array.isArray(right.event?.compactedDeltaLengths)
  const chunk = leftChunk.type === 'tool-call-delta'
    ? {
        ...leftChunk,
        ...rightChunk,
        argumentsDelta: `${deltaText(leftChunk) ?? ''}${deltaText(rightChunk) ?? ''}`,
        ...(leftChunk.name === undefined ? {} : { name: leftChunk.name }),
        ...(leftChunk.id === undefined ? {} : { id: leftChunk.id }),
      }
    : { ...leftChunk, ...rightChunk, text: `${deltaText(leftChunk) ?? ''}${deltaText(rightChunk) ?? ''}` }
  return {
    ...left,
    event: {
      ...left.event,
      data: { ...left.event.data, chunk },
      compactedEventSeqRanges: undefined,
      compactedDeltaLengths: undefined,
    },
    compactedEventSeqRanges: mergeDisplaySequenceRanges(
      displayEntrySequenceRanges(left),
      displayEntrySequenceRanges(right),
    ),
    ...(trackLengths && leftLengths && rightLengths
      ? { compactedDeltaLengths: [...flattenDeltaLengthTree(leftLengths), ...flattenDeltaLengthTree(rightLengths)], displayDeltaLengthTree: undefined }
      : keepLengths && leftLengths && rightLengths
        ? {
            compactedDeltaLengths: undefined,
            displayDeltaLengthTree: { left: leftLengths, right: rightLengths, count: leftLengths.count + rightLengths.count },
          }
        : { compactedDeltaLengths: undefined, displayDeltaLengthTree: undefined }),
  }
}

function hasUsage(entry) {
  const event = entry.event
  const chunk = chunkOf(entry)
  return record(event.data?.usage) !== undefined
    || record(event.data?.tokenUsage) !== undefined
    || record(chunk?.usage) !== undefined
}

function pageStartSequence(entries) {
  let start
  for (const entry of entries) {
    const candidates = [entry.displayPageStartSeq, entry.event.seq]
    for (const seq of candidates) {
      // A live stream frame is not a durable event: paging before it would ask
      // the Host for a seq that never existed.
      if (Number.isFinite(seq) && !isTransientStreamSeq(seq) && (start === undefined || seq < start)) start = seq
    }
  }
  return start
}

function withPageStart(entries, start) {
  if (entries.length === 0 || start === undefined) return entries
  return [{ ...entries[0], displayPageStartSeq: start }, ...entries.slice(1)]
}

function rangesWithoutSequence(ranges, sequence) {
  const result = []
  for (const [start, end] of ranges) {
    if (sequence < start || sequence > end) result.push([start, end])
    else {
      if (start < sequence) result.push([start, sequence - 1])
      if (sequence < end) result.push([sequence + 1, end])
    }
  }
  return result
}

function stripRetryDisplayMetadata(entry) {
  const {
    compactedEventSeqRanges: _ranges,
    compactedDeltaLengths: _lengths,
    displayDeltaLengthTree: _lengthTree,
    displayFirstChunkSeq: _firstChunkSeq,
    displayFirstChunkTime: _firstChunkTime,
    displayFirstTokenTime: _firstTokenTime,
    ...rest
  } = entry
  return rest
}

function rememberActiveChunk(activeChunkSlots, key, slot) {
  const slots = activeChunkSlots.get(key) ?? []
  slots.push(slot)
  activeChunkSlots.set(key, slots)
}

function discardActiveChunks(result, deltaSlots, activeChunkSlots, discardedSlots, key) {
  const slots = activeChunkSlots.get(key) ?? []
  const entries = slots.map(slot => result[slot])
  const ranges = mergeDisplaySequenceRanges(...entries.map(displayEntrySequenceRanges))
  let firstChunk
  let firstTokenTime
  for (const entry of entries) {
    const seq = Number.isFinite(entry.displayFirstChunkSeq) ? entry.displayFirstChunkSeq : entry.event.seq
    const time = Number.isFinite(entry.displayFirstChunkTime) ? entry.displayFirstChunkTime : entry.event.time
    if (!firstChunk || seq < firstChunk.seq) firstChunk = { seq, time }
    const tokenTime = Number.isFinite(entry.displayFirstTokenTime)
      ? entry.displayFirstTokenTime
      : tokenDelta(entry) ? entry.event.time : undefined
    if (tokenTime !== undefined && (firstTokenTime === undefined || tokenTime < firstTokenTime)) firstTokenTime = tokenTime
  }
  for (const slot of slots) discardedSlots.add(slot)
  activeChunkSlots.delete(key)
  const prefix = `${key}/`
  for (const slotKey of deltaSlots.keys()) {
    if (slotKey.startsWith(prefix)) deltaSlots.delete(slotKey)
  }
  return { ranges, firstChunk, firstTokenTime }
}

/** Compact one Host history page for the Deeptop display without changing durable storage. */
export function compactHistoryEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return Array.isArray(entries) ? entries : []
  const ordered = [...entries].sort((left, right) => left.event.seq - right.event.seq)
  const finalized = new Set(ordered
    .filter(entry => entry.event.type === 'assistant/message' && appendOrigin(entry.event))
    .map(entry => coordinateKey(entry.event))
    .filter(Boolean))
  const finalizedRanges = new Map()
  const finalizedFirstChunks = new Map()
  const finalizedFirstTokenTimes = new Map()
  const finalMessageSlots = new Map()
  const deltaSlots = new Map()
  const activeChunkSlots = new Map()
  let previousDeltaSlotKey
  let previousDeltaSlot
  const discardedSlots = new Set()
  const result = []

  for (const entry of ordered) {
    const event = entry.event
    const key = coordinateKey(event)
    if (event.type !== 'assistant/chunk') {
      previousDeltaSlotKey = undefined
      previousDeltaSlot = undefined
      const normalized = event.sourceEventSeqs === undefined
        ? entry
        : { ...entry, event: { ...event, sourceEventSeqs: undefined } }
      const discarded = event.type === 'llm/retry-started' && key
        ? discardActiveChunks(result, deltaSlots, activeChunkSlots, discardedSlots, key)
        : undefined
      if (event.type === 'assistant/message' && appendOrigin(event) && key) {
        finalMessageSlots.set(key, result.length)
      }
      const next = discarded === undefined || discarded.ranges.length === 0
        ? normalized
        : {
            ...normalized,
            compactedEventSeqRanges: mergeDisplaySequenceRanges(displayEntrySequenceRanges(normalized), discarded.ranges),
            ...(discarded.firstChunk === undefined ? {} : {
              displayFirstChunkSeq: discarded.firstChunk.seq,
              displayFirstChunkTime: discarded.firstChunk.time,
            }),
            ...(discarded.firstTokenTime === undefined ? {} : { displayFirstTokenTime: discarded.firstTokenTime }),
          }
      result.push(next)
      if (key && Number.isFinite(next.displayFirstChunkSeq)) {
        const previous = finalizedFirstChunks.get(key)
        if (!previous || next.displayFirstChunkSeq < previous.seq) {
          finalizedFirstChunks.set(key, { seq: next.displayFirstChunkSeq, time: next.displayFirstChunkTime })
        }
      }
      if (key && Number.isFinite(next.displayFirstTokenTime)) {
        const previous = finalizedFirstTokenTimes.get(key)
        if (previous === undefined || next.displayFirstTokenTime < previous) {
          finalizedFirstTokenTimes.set(key, next.displayFirstTokenTime)
        }
      }
      if (event.type === 'llm/retry-started' && key && finalized.has(key)) {
        finalizedRanges.set(key, mergeDisplaySequenceRanges(
          finalizedRanges.get(key) ?? [],
          rangesWithoutSequence(displayEntrySequenceRanges(next), event.seq),
        ))
        result[result.length - 1] = stripRetryDisplayMetadata(next)
      }
      continue
    }

    if (key && finalized.has(key)) {
      previousDeltaSlotKey = undefined
      previousDeltaSlot = undefined
      finalizedRanges.set(key, mergeDisplaySequenceRanges(
        finalizedRanges.get(key) ?? [],
        displayEntrySequenceRanges(entry),
      ))
      if (hasUsage(entry)) result.push(entry)
      if (!finalizedFirstChunks.has(key)) finalizedFirstChunks.set(key, { seq: event.seq, time: event.time })
      if (tokenDelta(entry) && !finalizedFirstTokenTimes.has(key)) {
        finalizedFirstTokenTimes.set(key, event.time)
      }
      continue
    }

    const slotKey = deltaSlotKey(entry)
    if (!slotKey) {
      previousDeltaSlotKey = undefined
      previousDeltaSlot = undefined
      const slot = result.length
      result.push(entry)
      if (key) rememberActiveChunk(activeChunkSlots, key, slot)
      continue
    }
    if (previousDeltaSlotKey === slotKey && previousDeltaSlot !== undefined
      && canMergeDeltaEntries(result[previousDeltaSlot], entry)) {
      result[previousDeltaSlot] = mergeDeltaEntries(result[previousDeltaSlot], entry)
    } else {
      const nextSlot = result.length
      deltaSlots.set(`${slotKey}/${event.seq}`, nextSlot)
      result.push(entry)
      if (key) rememberActiveChunk(activeChunkSlots, key, nextSlot)
      previousDeltaSlotKey = slotKey
      previousDeltaSlot = nextSlot
    }
  }

  for (const [key, ranges] of finalizedRanges) {
    const slot = finalMessageSlots.get(key)
    if (slot === undefined) continue
    const message = result[slot]
    const candidateFirstChunk = finalizedFirstChunks.get(key)
    const existingFirstChunkSeq = Number.isFinite(message.displayFirstChunkSeq) ? message.displayFirstChunkSeq : undefined
    const firstChunk = existingFirstChunkSeq !== undefined
      && (candidateFirstChunk === undefined || existingFirstChunkSeq <= candidateFirstChunk.seq)
      ? { seq: existingFirstChunkSeq, time: message.displayFirstChunkTime }
      : candidateFirstChunk
    const candidateFirstTokenTime = finalizedFirstTokenTimes.get(key)
    const existingFirstTokenTime = Number.isFinite(message.displayFirstTokenTime) ? message.displayFirstTokenTime : undefined
    const firstTokenTime = existingFirstTokenTime === undefined
      ? candidateFirstTokenTime
      : candidateFirstTokenTime === undefined ? existingFirstTokenTime : Math.min(existingFirstTokenTime, candidateFirstTokenTime)
    result[slot] = {
      ...message,
      compactedEventSeqRanges: mergeDisplaySequenceRanges(
        displayEntrySequenceRanges(message),
        ranges,
      ),
      ...(firstChunk === undefined ? {} : { displayFirstChunkSeq: firstChunk.seq, displayFirstChunkTime: firstChunk.time }),
      ...(firstTokenTime === undefined ? {} : { displayFirstTokenTime: firstTokenTime }),
    }
  }
  const compacted = discardedSlots.size === 0 ? result : result.filter((_, index) => !discardedSlots.has(index))
  return withPageStart(compacted, pageStartSequence(entries))
}

function rangeCovered(range, known) {
  return known.some(candidate => candidate[0] <= range[0] && candidate[1] >= range[1])
}

function rangeOverlaps(range, known) {
  return known.some(candidate => candidate[0] <= range[1] && candidate[1] >= range[0])
}

function trimKnownDeltaPrefix(entry, known) {
  if (!deltaSlotKey(entry)) return entry
  const ranges = displayEntrySequenceRanges(entry)
  if (!ranges.some(range => rangeOverlaps(range, known))) return entry
  const lengths = deltaLengths(entry)
  const sequences = ranges
    .flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, index) => start + index))
  if (lengths.length !== sequences.length) return undefined
  let prefix = 0
  while (prefix < sequences.length && rangeCovered([sequences[prefix], sequences[prefix]], known)) prefix++
  if (prefix === 0) return entry
  if (prefix === sequences.length) return undefined
  if (sequences.slice(prefix).some(seq => rangeCovered([seq, seq], known))) return undefined
  const chunk = chunkOf(entry)
  const text = deltaText(chunk)
  if (text === undefined) return undefined
  const offset = lengths.slice(0, prefix).reduce((sum, length) => sum + length, 0)
  const remainingText = text.slice(offset)
  const trimmedChunk = chunk.type === 'tool-call-delta'
    ? { ...chunk, argumentsDelta: remainingText }
    : { ...chunk, text: remainingText }
  const remainingRanges = mergeDisplaySequenceRanges(...sequences.slice(prefix).map(seq => [[seq, seq]]))
  return {
    ...entry,
    event: { ...entry.event, seq: sequences[prefix], data: { ...entry.event.data, chunk: trimmedChunk } },
    compactedEventSeqRanges: remainingRanges,
    compactedDeltaLengths: lengths.slice(prefix),
    displayDeltaLengthTree: undefined,
  }
}

function mergeLiveDeltaAdditions(current, additions) {
  if (!additions.every(deltaSlotKey)) return undefined
  const currentEnd = current.reduce((maximum, entry) => Math.max(maximum, ...displayEntrySequenceRanges(entry).map(range => range[1])), -1)
  const additionStart = additions.reduce((minimum, entry) => Math.min(minimum, ...displayEntrySequenceRanges(entry).map(range => range[0])), Number.POSITIVE_INFINITY)
  if (additionStart <= currentEnd) return undefined
  const finalized = new Set(current
    .filter(entry => entry.event.type === 'assistant/message' && appendOrigin(entry.event))
    .map(entry => coordinateKey(entry.event))
    .filter(Boolean))
  if (additions.some(entry => finalized.has(coordinateKey(entry.event)))) return undefined
  const next = [...current]
  for (const addition of additions) {
    const entry = withDeltaLengthLeaf(addition)
    const previous = next.at(-1)
    if (previous && deltaSlotKey(previous) === deltaSlotKey(entry) && canMergeDeltaEntries(previous, entry)) {
      next[next.length - 1] = mergeDeltaEntries(previous, entry)
    } else {
      next.push(entry)
    }
  }
  return withPageStart(next, pageStartSequence(current.length > 0 ? current : additions))
}

/** Merge raw or compacted history additions without replaying duplicate deltas. */
export function mergeHistoryEntries(current, additions) {
  let known = mergeDisplaySequenceRanges(...current.map(displayEntrySequenceRanges))
  const unique = []
  for (const addition of additions) {
    const entry = trimKnownDeltaPrefix(addition, known)
    if (!entry) continue
    const ownRange = [entry.event.seq, entry.event.seq]
    if (rangeCovered(ownRange, known)) continue
    const ranges = displayEntrySequenceRanges(entry)
    if (deltaSlotKey(entry) && ranges.some(range => rangeOverlaps(range, known))) continue
    unique.push(entry)
    known = mergeDisplaySequenceRanges(known, ranges)
  }
  if (unique.length === 0) return current
  return mergeLiveDeltaAdditions(current, unique) ?? compactHistoryEntries([...current, ...unique])
}

/** Return the earliest raw event represented by a display page. */
export function displayHistoryStartSequence(entries) {
  return pageStartSequence(entries)
}

/** Count unique raw events represented by compacted display entries. */
export function displayHistoryEventCount(entries) {
  const durableRanges = entries
    .map(displayEntrySequenceRanges)
    .map(ranges => ranges.filter(([start]) => !isTransientStreamSeq(start)))
  return mergeDisplaySequenceRanges(...durableRanges)
    .reduce((count, [start, end]) => count + end - start + 1, 0)
}

function liveDeltaFrameKey(frame) {
  const payload = frame?.payload
  if (payload?.type !== 'session/event') return undefined
  const slot = deltaSlotKey({ event: payload.event })
  return slot ? `${payload.sessionId}/${slot}` : undefined
}

function liveProjectionKey(frame) {
  const payload = frame?.payload
  return payload?.type === 'session/projection' && typeof payload.sessionId === 'string' && typeof payload.key === 'string'
    ? `${payload.sessionId}/${payload.key}`
    : undefined
}

/** Fold adjacent live deltas and superseded snapshot projections in frame order. */
export function compactLiveEventFrames(frames) {
  const latestProjectionSlots = new Map()
  const projectionCompacted = []
  for (const frame of frames) {
    const key = liveProjectionKey(frame)
    if (key === undefined) projectionCompacted.push(frame)
    else {
      const previousSlot = latestProjectionSlots.get(key)
      if (previousSlot !== undefined) projectionCompacted[previousSlot] = undefined
      latestProjectionSlots.set(key, projectionCompacted.length)
      projectionCompacted.push(frame)
    }
  }
  const result = []
  for (const frame of projectionCompacted) {
    if (frame === undefined) continue
    const key = liveDeltaFrameKey(frame)
    const previous = result.at(-1)
    if (key === undefined || previous?.key !== key) {
      result.push({ key, frame })
      continue
    }
    const merged = mergeDeltaEntries(
      { event: previous.frame.payload.event },
      { event: frame.payload.event },
      true,
    )
    previous.frame = {
      ...previous.frame,
      payload: {
        ...previous.frame.payload,
        event: {
          ...merged.event,
          compactedEventSeqRanges: merged.compactedEventSeqRanges,
          compactedDeltaLengths: merged.compactedDeltaLengths,
        },
      },
    }
  }
  return result.map(item => item.frame)
}

/** Compact successful session/subagent history RPC envelopes without mutating Host results. */
export function compactHistoryResponse(response) {
  const value = response?.result?.ok === true ? response.result.value : undefined
  if (!value || !Array.isArray(value.events)) return response
  return {
    ...response,
    result: {
      ...response.result,
      value: { ...value, events: compactHistoryEntries(value.events) },
    },
  }
}
