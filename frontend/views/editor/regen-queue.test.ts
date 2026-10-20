import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { enqueueRegen, isRegenQueued, makeRegenJob, moveRegen, removeRegen } from './regen-queue.ts'

const params = (prompt: string) => ({
  mode: 'text-to-video' as const, prompt, model: 'fast', duration: 5, resolution: '540p',
  fps: 24, audio: false, cameraMotion: 'none',
})
const job = (assetId: string, prompt = 'p', clipId?: string) =>
  makeRegenJob({ assetId, clipId, label: assetId, params: params(prompt) })
const order = (q: { assetId: string }[]) => q.map(j => j.assetId).join(',')

describe('regen queue', () => {
  it('appends jobs in order', () => {
    let q = enqueueRegen([], job('a'))
    q = enqueueRegen(q, job('b'))
    assert.equal(order(q), 'a,b')
  })

  it('replaces a waiting job for the same shot instead of duplicating it', () => {
    let q = enqueueRegen([], job('a', 'first', 'c1'))
    q = enqueueRegen(q, job('b'))
    q = enqueueRegen(q, job('a', 'second', 'c1'))
    assert.equal(order(q), 'a,b')
    assert.equal(q[0].params.prompt, 'second')
  })

  it('treats the same asset on a different clip as a different shot', () => {
    let q = enqueueRegen([], job('a', 'x', 'c1'))
    q = enqueueRegen(q, job('a', 'y', 'c2'))
    assert.equal(q.length, 2)
  })

  it('removes by id and ignores unknown ids', () => {
    const a = job('a')
    const b = job('b')
    const q = [a, b]
    assert.equal(order(removeRegen(q, a.id)), 'b')
    assert.equal(removeRegen(q, 'nope'), q)
  })

  it('moves jobs and stops at the ends', () => {
    const [a, b, c] = [job('a'), job('b'), job('c')]
    const q = [a, b, c]
    assert.equal(order(moveRegen(q, c.id, 'up')), 'a,c,b')
    assert.equal(order(moveRegen(q, c.id, 'top')), 'c,a,b')
    assert.equal(order(moveRegen(q, a.id, 'down')), 'b,a,c')
    assert.equal(moveRegen(q, a.id, 'up'), q)
    assert.equal(moveRegen(q, c.id, 'down'), q)
    assert.equal(moveRegen(q, 'nope', 'up'), q)
  })

  it('reports whether a shot is waiting', () => {
    const q = [job('a', 'p', 'c1')]
    assert.equal(isRegenQueued(q, 'a', 'c1'), true)
    assert.equal(isRegenQueued(q, 'a', 'c2'), false)
  })
})
