import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMPTY_IC_LORA_OUTPUT, addOutputClip, followLiveRun, keepOutputClips, outputSelection, stepOutput,
} from './ic-lora-output-history.ts'

const a = { path: 'a.mp4' }
const b = { path: 'b.mp4' }
const c = { path: 'c.mp4' }

describe('IC-LoRA output history', () => {
  it('shows the first finished clip and keeps it while a queued run renders', () => {
    const one = addOutputClip(EMPTY_IC_LORA_OUTPUT, a)
    assert.equal(outputSelection(one, true).clip, a)
    assert.equal(outputSelection(one, true).total, 2)
  })

  it('does not move off the watched clip when another one finishes', () => {
    const two = addOutputClip(addOutputClip(EMPTY_IC_LORA_OUTPUT, a), b)
    assert.equal(outputSelection(two, false).clip, a)
  })

  it('shows the live run after pressing Generate, then its clip', () => {
    const live = followLiveRun(addOutputClip(EMPTY_IC_LORA_OUTPUT, a))
    assert.equal(outputSelection(live, true).clip, undefined)
    assert.equal(outputSelection(addOutputClip(live, b), false).clip, b)
  })

  it('shows the newest clip when the live run stops without a result', () => {
    const live = followLiveRun(addOutputClip(EMPTY_IC_LORA_OUTPUT, a))
    assert.equal(outputSelection(live, false).clip, a)
  })

  it('steps back to finished clips and forward to the live run, without overshooting', () => {
    let h = followLiveRun(addOutputClip(EMPTY_IC_LORA_OUTPUT, a))
    h = stepOutput(h, true, -1)
    assert.equal(outputSelection(h, true).clip, a)
    assert.equal(stepOutput(h, true, -1).view, 0)
    h = stepOutput(h, true, 1)
    assert.equal(h.view, null)
    assert.equal(stepOutput(h, true, 1).view, null)
  })

  it('stays on the watched clip when another is deleted', () => {
    const h = { clips: [a, b, c], view: 2 }
    assert.equal(outputSelection(keepOutputClips(h, new Set(['b.mp4', 'c.mp4'])), false).clip, c)
    assert.deepEqual(keepOutputClips(h, new Set()), { clips: [], view: null })
  })
})
