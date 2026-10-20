import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { moveQueuedLaunch, removeQueuedLaunch, type QueuedLaunch } from './genspace-queue.ts'

const job = (id: string): QueuedLaunch => ({ id, label: id, run: () => {} })
const ids = (q: QueuedLaunch[]) => q.map(j => j.id).join(',')

describe('genspace queue list', () => {
  it('removes a waiting job and leaves the rest in order', () => {
    const q = [job('a'), job('b'), job('c')]
    assert.equal(ids(removeQueuedLaunch(q, 'b')), 'a,c')
  })

  it('returns the same list for an unknown id', () => {
    const q = [job('a')]
    assert.equal(removeQueuedLaunch(q, 'x'), q)
    assert.equal(moveQueuedLaunch(q, 'x', 'up'), q)
  })

  it('moves a job up, down and to the top, and stops at the ends', () => {
    const q = [job('a'), job('b'), job('c')]
    assert.equal(ids(moveQueuedLaunch(q, 'c', 'up')), 'a,c,b')
    assert.equal(ids(moveQueuedLaunch(q, 'a', 'down')), 'b,a,c')
    assert.equal(ids(moveQueuedLaunch(q, 'c', 'top')), 'c,a,b')
    assert.equal(moveQueuedLaunch(q, 'a', 'up'), q)
    assert.equal(moveQueuedLaunch(q, 'c', 'down'), q)
  })

  it('does not mutate the list it was given', () => {
    const q = [job('a'), job('b')]
    moveQueuedLaunch(q, 'b', 'up')
    assert.equal(ids(q), 'a,b')
  })
})
