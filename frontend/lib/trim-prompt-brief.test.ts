import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrimPromptBrief, looksMultiShot } from './trim-prompt-brief.ts'

describe('looksMultiShot', () => {
  it('spots numbered shots', () => {
    assert.equal(looksMultiShot('Shot 1: a man by a fire. Shot 2: a woman in a tunnel.'), true)
    assert.equal(looksMultiShot('Scene one: the desert. Scene two: the tunnel.'), true)
  })

  it('spots cut-to and one-per-line lists', () => {
    assert.equal(looksMultiShot('A man sits by a fire. Cut to a woman walking.'), true)
    assert.equal(looksMultiShot('1. Wide of the camp\n2. Close on his face'), true)
    assert.equal(looksMultiShot('**Shot 1** wide\n**Shot 2** close'), true)
  })

  it('leaves a single shot alone', () => {
    assert.equal(looksMultiShot('A man sits by a campfire at night, slow push in, embers rising.'), false)
    assert.equal(looksMultiShot('Shot 1: a man by a fire.'), false)
    assert.equal(looksMultiShot(''), false)
  })
})

describe('buildTrimPromptBrief', () => {
  const brief = buildTrimPromptBrief({ videoPath: 'D:\\p\\clip.mp4', start: 8.25, end: 10.5, prompt: '  Shot 1: a. Shot 2: b.  ' })

  it('names the clip file and the window it uses', () => {
    assert.match(brief, /D:\\p\\clip\.mp4/)
    assert.match(brief, /from 8\.3s to 10\.5s/)
  })

  it('carries the prompt and asks for set_generation_prompt', () => {
    assert.match(brief, /Shot 1: a\. Shot 2: b\./)
    assert.match(brief, /set_generation_prompt/)
    assert.match(brief, /Do not generate anything/)
  })
})
