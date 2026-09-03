import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateManagedBlock, normalizeProfilePatchDocument, withProfilePatchLock } from './profile-patch.mjs'

test('normalizes profile patch arrays without deleting nested arrays or comments', () => {
  assert.equal(normalizeProfilePatchDocument('[]'), '[]\n')
  assert.equal(normalizeProfilePatchDocument('[]\n# keep this note\n'), '# keep this note\n[]\n')
  assert.equal(normalizeProfilePatchDocument('- config:\n  values: []\n'), '- config:\n  values: []\n')
  assert.throws(() => normalizeProfilePatchDocument('name: invalid\n'), /必须是 YAML 数组/)
  assert.throws(() => normalizeProfilePatchDocument('- item:\n\tbad: true\n'), /不允许使用 Tab/)
})

test('requires exactly one complete managed marker pair', () => {
  const start = '# BEGIN TEST'
  const end = '# END TEST'
  assert.equal(locateManagedBlock('before\n', start, end), null)
  assert.throws(() => locateManagedBlock(`${start}\n${start}\n${end}\n`, start, end), /恰好成对/)
  assert.throws(() => locateManagedBlock(`${end}\n${start}\n`, start, end), /顺序正确/)
  assert.equal(locateManagedBlock(`${start}\nvalue\n${end}\n`, start, end).startLine, 0)
  assert.throws(() => locateManagedBlock(` # BEGIN TEST\nvalue\n# END TEST\n`, start, end), /恰好成对/)
})

test('cancels a queued profile lock without blocking the next writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deeptop-profile-lock-'))
  const path = join(root, 'profiles', 'desktop', 'cordis.patch.yml')
  await mkdir(join(root, 'profiles', 'desktop'), { recursive: true })
  let releaseFirst
  let firstStarted
  const firstStartedPromise = new Promise(resolve => { firstStarted = resolve })
  const firstReleasePromise = new Promise(resolve => { releaseFirst = resolve })
  const first = withProfilePatchLock(path, async () => {
    firstStarted()
    await firstReleasePromise
    return 'first'
  })
  const firstResult = await firstStartedPromise.then(() => undefined)
  assert.equal(firstResult, undefined)
  const controller = new AbortController()
  const queued = withProfilePatchLock(path, async () => 'queued', controller.signal)
  controller.abort(new Error('test cancellation'))
  await assert.rejects(queued, error => error.code === 'cancelled')
  releaseFirst()
  assert.equal(await first, 'first')
  assert.equal(await withProfilePatchLock(path, async () => 'next'), 'next')
  await rm(root, { recursive: true, force: true })
})
