// 링크 경로(원본을 못 읽는 경우)의 편집점 — "없는 것을 지어내지 않는가"가 핵심이다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEditPoints, type SuccessEvidence, type VideoSignals } from './edit-points.ts'

const NO_EVIDENCE: SuccessEvidence = {
  medianDurationSec: null, topHookTypes: [], patternStatements: [], sampleSize: 0,
}

/** 플랫폼 링크에서 나오는 신호 모양 — 관측 축이 전부 비어 있다. */
function linkSignals(over: Partial<VideoSignals> = {}): VideoSignals {
  return {
    durationSec: 600,
    sceneChanges: [], silences: [], loudPeaks: [],
    framesSampled: 0, audioAnalyzed: false,
    ...over,
  }
}

test('신호가 없으면 컷·강조를 지어내지 않는다', () => {
  const points = buildEditPoints(linkSignals(), NO_EVIDENCE)
  assert.equal(points.filter((p) => p.kind === 'cut' || p.kind === 'emphasis').length, 0)
})

test('챕터가 없으면 구성 제안도 없다', () => {
  const points = buildEditPoints(linkSignals(), NO_EVIDENCE)
  assert.equal(points.filter((p) => p.kind === 'structure').length, 0)
})

test('인트로가 전체의 15%를 넘으면 줄이라고 말한다', () => {
  const points = buildEditPoints(linkSignals({
    durationSec: 600,
    chapters: [
      { atSec: 0, label: '인트로' },
      { atSec: 120, label: '본론' },     // 전체의 20%
      { atSec: 300, label: '정리' },
    ],
  }), NO_EVIDENCE)

  const intro = points.find((p) => p.kind === 'structure' && p.startSec === 0)
  assert.ok(intro, '인트로 제안이 나와야 한다')
  assert.match(intro!.reason, /20%/)
})

test('짧은 인트로는 비율이 커도 말하지 않는다 — 30초 영상의 5초 인트로는 정상이다', () => {
  const points = buildEditPoints(linkSignals({
    durationSec: 30,
    chapters: [{ atSec: 0, label: '인트로' }, { atSec: 5, label: '본론' }],
  }), NO_EVIDENCE)
  assert.equal(points.filter((p) => p.kind === 'structure').length, 0)
})

test('유난히 긴 구간을 짚는다 — 평균 대비로 판단한다', () => {
  const points = buildEditPoints(linkSignals({
    durationSec: 900,
    chapters: [
      { atSec: 0, label: '여는 말' },
      { atSec: 60, label: '아주 긴 본론' },  // 600초
      { atSec: 660, label: '사례' },
      { atSec: 720, label: '정리' },
    ],
  }), NO_EVIDENCE)

  const long = points.find((p) => p.kind === 'structure' && p.action.includes('아주 긴 본론'))
  assert.ok(long, '긴 구간 제안이 나와야 한다')
})

test('길이 제안은 근거가 있을 때만 나온다', () => {
  const withoutEvidence = buildEditPoints(linkSignals({ durationSec: 1800 }), NO_EVIDENCE)
  assert.equal(withoutEvidence.filter((p) => p.kind === 'length').length, 0)

  const withEvidence = buildEditPoints(linkSignals({ durationSec: 1800 }), {
    ...NO_EVIDENCE, medianDurationSec: 600, sampleSize: 12,
  })
  assert.equal(withEvidence.filter((p) => p.kind === 'length').length, 1)
})

test('길이가 0이면 아무것도 내지 않는다 — 정보를 못 얻은 상태다', () => {
  assert.deepEqual(buildEditPoints(linkSignals({ durationSec: 0 }), NO_EVIDENCE), [])
})
