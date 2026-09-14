import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsGeneratedNotice, noticeIsMandatory, progressView, canAskAgain } from './notice.ts'
import { AI_CAPABILITIES } from '@ax/ai-core'

test('which capabilities must carry a notice comes from the capability table', () => {
  assert.equal(needsGeneratedNotice('generate'), true)
  assert.equal(needsGeneratedNotice('summarize'), true)
  assert.equal(needsGeneratedNotice('transcribe'), true)
  assert.equal(needsGeneratedNotice('judge'), false)
  for (const c of AI_CAPABILITIES) assert.equal(typeof needsGeneratedNotice(c), 'boolean')
})

test('there is no off switch for the notice', () => {
  assert.equal(noticeIsMandatory(), true)
})

test('unknown remaining work is shown as unknown, not as a stuck bar', () => {
  const v = progressView('streaming', null, null, 'running')
  assert.equal(v.running, true)
  assert.equal(v.ratio, null)
  assert.equal(v.text, 'running')
})

test('known progress reads as a ratio inside 0 and 1', () => {
  assert.equal(progressView('streaming', 3, 10, 'r').ratio, 0.3)
  assert.equal(progressView('streaming', 50, 10, 'r').ratio, 1)
  assert.equal(progressView('streaming', -1, 10, 'r').ratio, 0)
  assert.equal(progressView('streaming', 1, 0, 'r').ratio, null, 'a zero total is unknown, not infinite')
})

test('a finished value is not running', () => {
  for (const s of ['candidate', 'confirmed', 'corrected'] as const) {
    const v = progressView(s, null, null, 'r')
    assert.equal(v.running, false)
    assert.equal(v.text, '', 'a finished value says nothing about being in flight')
  }
})

test('asking again is not offered while the answer is still arriving', () => {
  assert.equal(canAskAgain('streaming', true), false)
})

test('asking the same model the same question again is only offered when something can change', () => {
  assert.equal(canAskAgain('confirmed', false), false)
  assert.equal(canAskAgain('confirmed', true), true, 'another model can give another answer')
  assert.equal(canAskAgain('candidate', false), true, 'an unsettled value can still be revisited')
})
