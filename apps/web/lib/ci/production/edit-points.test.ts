import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEditPoints, toTimecode, toEditSheet, toMarkerCsv,
  MAX_EDIT_POINTS, type VideoSignals, type SuccessEvidence,
} from './edit-points.ts'

function signals(over: Partial<VideoSignals> = {}): VideoSignals {
  return {
    durationSec: 60,
    sceneChanges: [],
    silences: [],
    loudPeaks: [],
    framesSampled: 0,
    audioAnalyzed: true,
    ...over,
  }
}

function evidence(over: Partial<SuccessEvidence> = {}): SuccessEvidence {
  return {
    medianDurationSec: null,
    topHookTypes: [],
    patternStatements: [],
    sampleSize: 0,
    topHookDevices: [],
    medianCutsPerMin: null,
    subtitleRatio: null,
    medianBeats: null,
    mediaSampleSize: 0,
    ...over,
  }
}

test('타임코드는 편집툴이 읽는 mm:ss.mmm', () => {
  assert.equal(toTimecode(0), '00:00.000')
  assert.equal(toTimecode(2.4), '00:02.400')
  assert.equal(toTimecode(75.25), '01:15.250')
  assert.equal(toTimecode(3661.5), '01:01:01.500')
  // 잘못된 값이 화면을 깨뜨리지 않는다
  assert.equal(toTimecode(Number.NaN), '00:00.000')
  assert.equal(toTimecode(-5), '00:00.000')
})

test('신호가 없으면 편집점도 없다 — 지어내지 않는다', () => {
  assert.deepEqual(buildEditPoints(signals(), evidence()), [])
})

test('길이가 0이면 빈 결과(분석 실패를 제안으로 위장하지 않는다)', () => {
  assert.deepEqual(buildEditPoints(signals({ durationSec: 0 }), evidence()), [])
})

test('도입부 무음은 잘라낼 구간으로 잡힌다', () => {
  const points = buildEditPoints(
    signals({ silences: [{ startSec: 0, endSec: 2.4 }] }),
    evidence(),
  )
  const trim = points.find((p) => p.kind === 'trim')
  assert.ok(trim, '도입부 트림이 없다')
  assert.equal(trim.startSec, 0)
  assert.equal(trim.endSec, 2.4)
  assert.ok(trim.action.includes('00:02.400'))
})

test('도입부 무음이 짧으면(0.8초 미만) 건드리지 않는다', () => {
  const points = buildEditPoints(
    signals({ silences: [{ startSec: 0, endSec: 0.5 }] }),
    evidence(),
  )
  assert.equal(points.filter((p) => p.kind === 'trim').length, 0)
})

test('도입 10초 안의 최대 음량 피크를 훅으로 제안한다', () => {
  const points = buildEditPoints(
    signals({ loudPeaks: [{ atSec: 3, level: 0.4 }, { atSec: 7, level: 0.9 }, { atSec: 30, level: 0.95 }] }),
    evidence({ topHookTypes: ['호기심공백', '반전'] }),
  )
  const hook = points.find((p) => p.kind === 'hook')
  assert.ok(hook)
  assert.equal(hook.startSec, 7, '도입부 안에서 가장 큰 피크를 골라야 한다')
  assert.ok(hook.reason.includes('호기심공백'), '수집한 후킹 유형을 근거로 밝혀야 한다')
})

test('수집한 근거가 없으면 후킹 유형을 지어내지 않는다', () => {
  const points = buildEditPoints(signals({ loudPeaks: [{ atSec: 2, level: 0.8 }] }), evidence())
  const hook = points.find((p) => p.kind === 'hook')
  assert.ok(hook)
  assert.ok(!hook.reason.includes('통한 후킹은'))
})

test('중간의 긴 무음은 줄이라고 말한다', () => {
  const points = buildEditPoints(
    signals({ silences: [{ startSec: 20, endSec: 22.5 }] }),
    evidence(),
  )
  const trim = points.find((p) => p.kind === 'trim' && p.startSec === 20)
  assert.ok(trim)
  assert.ok(trim.action.includes('무음'))
})

test('컷 없이 오래 가는 구간에 컷을 제안한다', () => {
  const points = buildEditPoints(
    signals({ durationSec: 30, framesSampled: 60, sceneChanges: [{ atSec: 10, score: 0.5 }] }),
    evidence(),
  )
  const cuts = points.filter((p) => p.kind === 'cut')
  // 0~10(10초), 10~30(20초) 두 구간 모두 4초를 넘는다
  assert.equal(cuts.length, 2)
  assert.ok(cuts.every((c) => c.startSec > 0 && c.startSec < 30))
})

test('장면이 자주 바뀌면 컷을 제안하지 않는다', () => {
  const points = buildEditPoints(
    signals({
      durationSec: 9,
      framesSampled: 18,
      sceneChanges: [{ atSec: 3, score: 0.5 }, { atSec: 6, score: 0.5 }],
    }),
    evidence(),
  )
  assert.equal(points.filter((p) => p.kind === 'cut').length, 0)
})

test('길이 제안은 수집한 근거가 있을 때만 나온다', () => {
  const long = signals({ durationSec: 300 })
  assert.equal(buildEditPoints(long, evidence()).filter((p) => p.kind === 'length').length, 0)

  const withEvidence = buildEditPoints(long, evidence({ medianDurationSec: 60, sampleSize: 12 }))
  const len = withEvidence.find((p) => p.kind === 'length')
  assert.ok(len)
  assert.ok(len.reason.includes('12건'), '표본 수를 밝혀야 한다')
})

test('잘된 길이보다 조금 길면(1.3배 이내) 트집 잡지 않는다', () => {
  const points = buildEditPoints(
    signals({ durationSec: 70 }),
    evidence({ medianDurationSec: 60, sampleSize: 10 }),
  )
  assert.equal(points.filter((p) => p.kind === 'length').length, 0)
})

test('편집점이 폭발하지 않도록 상한을 둔다', () => {
  const many = signals({
    durationSec: 600,
    loudPeaks: Array.from({ length: 100 }, (_, i) => ({ atSec: 11 + i, level: 0.9 })),
    silences: Array.from({ length: 100 }, (_, i) => ({ startSec: 10 + i * 5, endSec: 12 + i * 5 })),
  })
  assert.ok(buildEditPoints(many, evidence()).length <= MAX_EDIT_POINTS)
})

test('지시서는 시간순으로 정렬되고 근거를 함께 적는다', () => {
  const points = buildEditPoints(
    signals({
      silences: [{ startSec: 0, endSec: 2 }, { startSec: 30, endSec: 32 }],
      loudPeaks: [{ atSec: 5, level: 0.9 }],
    }),
    evidence(),
  )
  const sheet = toEditSheet(points, '내 영상')
  assert.ok(sheet.startsWith('내 영상'))
  assert.ok(sheet.includes('근거:'))
  const first = sheet.indexOf('00:00.000')
  const later = sheet.indexOf('00:30.000')
  assert.ok(first < later, '시간순이 아니다')
})

test('제안이 없으면 지시서가 그렇다고 말한다', () => {
  assert.ok(toEditSheet([], '내 영상').includes('찾지 못했습니다'))
})

test('마커 CSV는 헤더와 이스케이프를 지킨다', () => {
  const csv = toMarkerCsv([
    { kind: 'cut', startSec: 5, endSec: null, action: '컷, "여기"', reason: 'r', confidence: 0.5 },
  ])
  const [head, row] = csv.split('\n')
  assert.equal(head, 'timecode,end,kind,action')
  assert.ok(row.includes('00:05.000'))
  assert.ok(row.includes('""여기""'), '따옴표를 이스케이프해야 한다')
})

test('화면을 못 훑었으면 "화면이 그대로"라고 단정하지 않는다', () => {
  // 분석 실패(framesSampled=0)를 컷 제안으로 위장하면 사용자가 헛된 편집을 한다
  const blind = buildEditPoints(signals({ durationSec: 120, framesSampled: 0 }), evidence())
  assert.equal(blind.filter((p) => p.kind === 'cut').length, 0)

  const seen = buildEditPoints(signals({ durationSec: 120, framesSampled: 240 }), evidence())
  assert.ok(seen.some((p) => p.kind === 'cut'), '실제로 훑었으면 제안해야 한다')
})

/* ───────── 영상 실체 근거 (lib/ci/media) ─────────
 *
 * 왜 이 규칙들이 따로 있나: 위 근거(길이·후킹 유형)는 썸네일과 지표에서 나온 것이라
 * **연출을 말하지 못한다.** "후킹 유형 질문형"은 무엇을 하라는 말이 아니다.
 * 영상을 실제로 읽으면 몇 초에 한 번 자르는지·자막을 넣는지·몇 토막인지가 나오고,
 * 그건 그대로 제작 지시가 된다.
 */

/** 화면·소리를 다 본 60초 영상. 컷은 8번(분당 8회) — 느린 편이다. */
function slowVideo(): VideoSignals {
  return {
    durationSec: 60,
    sceneChanges: Array.from({ length: 8 }, (_, i) => ({ atSec: i * 7 + 3, score: 0.5 })),
    silences: [], loudPeaks: [], framesSampled: 120, audioAnalyzed: true,
  }
}

test('★ 컷 리듬을 숫자로 말한다 — "컷을 더 넣어라"는 지시가 아니다', () => {
  const pts = buildEditPoints(slowVideo(), evidence({ medianCutsPerMin: 24, mediaSampleSize: 12 }))
  const p = pts.find((x) => x.action.includes('분당'))
  assert.ok(p, '컷 리듬 제안이 없다')
  assert.match(p.action, /컷을 \d+번쯤 더 넣으세요/)
  assert.match(p.action, /분당 8회 → 분당 24회/)
  assert.match(p.reason, /12건/)
})

test('표본이 적으면 리듬을 말하지 않는다 — 서너 건으로 공식을 팔지 않는다', () => {
  const pts = buildEditPoints(slowVideo(), evidence({ medianCutsPerMin: 24, mediaSampleSize: 4 }))
  assert.equal(pts.filter((x) => x.action.includes('분당')).length, 0)
})

test('화면을 못 봤으면 내 컷 수를 모른다 — 모르는 것을 비교하지 않는다', () => {
  const blind = { ...slowVideo(), framesSampled: 0 }
  const pts = buildEditPoints(blind, evidence({ medianCutsPerMin: 24, mediaSampleSize: 12 }))
  assert.equal(pts.filter((x) => x.action.includes('분당')).length, 0)
})

test('이미 충분히 빠르면 말하지 않는다', () => {
  const fast = { ...slowVideo(), sceneChanges: Array.from({ length: 30 }, (_, i) => ({ atSec: i * 2, score: 0.5 })) }
  const pts = buildEditPoints(fast, evidence({ medianCutsPerMin: 24, mediaSampleSize: 12 }))
  assert.equal(pts.filter((x) => x.action.includes('분당')).length, 0)
})

test('★ 자막은 "넣으세요"가 아니라 비율로 말한다 — 내 영상의 자막 유무를 우리는 모른다', () => {
  const pts = buildEditPoints(slowVideo(), evidence({ subtitleRatio: 0.85, mediaSampleSize: 12 }))
  const p = pts.find((x) => x.action.includes('자막'))
  assert.ok(p)
  assert.match(p.reason, /85%가 자막을 넣습니다/)
})

test('대부분이 자막을 안 넣으면 말하지 않는다', () => {
  const pts = buildEditPoints(slowVideo(), evidence({ subtitleRatio: 0.4, mediaSampleSize: 12 }))
  assert.equal(pts.filter((x) => x.action.includes('자막이 없다면')).length, 0)
})

test('★ 첫 3초를 여는 "장치"가 유형보다 먼저다 — 유형은 실행할 수 없다', () => {
  const v: VideoSignals = {
    durationSec: 60, sceneChanges: [], silences: [],
    loudPeaks: [{ atSec: 4, level: 0.9 }], framesSampled: 60, audioAnalyzed: true,
  }
  const pts = buildEditPoints(v, evidence({
    topHookTypes: ['질문형'], topHookDevices: ['자막 선언', '결과 먼저'], mediaSampleSize: 9,
  }))
  const hook = pts.find((x) => x.kind === 'hook')
  assert.ok(hook)
  assert.match(hook.reason, /자막 선언·결과 먼저/)
  assert.ok(!hook.reason.includes('질문형'), '장치가 있는데 유형을 말했다')
})

test('장치가 없으면 예전대로 유형으로 말한다 — 회귀 방지', () => {
  const v: VideoSignals = {
    durationSec: 60, sceneChanges: [], silences: [],
    loudPeaks: [{ atSec: 4, level: 0.9 }], framesSampled: 60, audioAnalyzed: true,
  }
  const pts = buildEditPoints(v, evidence({ topHookTypes: ['질문형'] }))
  assert.match(pts.find((x) => x.kind === 'hook')?.reason ?? '', /질문형/)
})

test('작성자가 이미 챕터를 찍었으면 토막 수를 참견하지 않는다', () => {
  const withCh = { ...slowVideo(), chapters: [{ atSec: 0, label: '인트로' }, { atSec: 30, label: '본론' }] }
  const pts = buildEditPoints(withCh, evidence({ medianBeats: 5, mediaSampleSize: 12 }))
  assert.equal(pts.filter((x) => x.action.includes('토막')).length, 0)
})

test('영상 근거가 하나도 없으면 새 제안이 하나도 안 나온다 — 회귀 방지', () => {
  const before = buildEditPoints(slowVideo(), evidence())
  assert.equal(before.filter((x) => /분당|자막이 없다면|토막/.test(x.action)).length, 0)
})
