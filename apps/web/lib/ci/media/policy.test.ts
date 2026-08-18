// lib/ci/media/policy.test.ts — 영상 읽기 판단 가드
//
// 이 가드가 막는 것은 둘이다.
//  ① 굶는 것을 안 읽는 것 — 숏폼을 건너뛰면 이 기능이 존재할 이유가 없다
//  ② 안 굶는 것을 읽는 것 — 1시간 영상을 전부 읽으면 비용이 통제 밖으로 나간다

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldUnderstand, THIN_CAPTION_CHARS, LONG_FORM_MAX_SEC, HOT_INDEX, MEDIA_MAX_PER_PASS,
  MAX_ATTEMPTS, isServiceFailure,
} from './policy.ts'

const base = {
  format: 'short' as const, captionLength: 0, durationSec: 30,
  outlierIndex: null, analyzed: null,
}

test('숏폼은 설명문이 충실해도 읽는다 — 영상이 곧 내용이다', () => {
  const d = shouldUnderstand({ ...base, captionLength: 5000 })
  assert.equal(d.should, true)
  assert.match(d.reason, /숏폼/)
})

test('이미 읽었으면 다시 읽지 않는다 — 같은 영상에 두 번 돈을 쓰지 않는다', () => {
  const d = shouldUnderstand({ ...base, analyzed: { hasEvidence: true, attempts: 1 } })
  assert.equal(d.should, false)
  assert.match(d.reason, /이미 영상을 읽었습니다/)
})

test('★ 시도했지만 못 읽었으면 다시 시도한다 — 쿼터 초과 한 번에 영구 포기하지 않는다', () => {
  // 실측 2026-08-18: 행의 존재를 "읽었다"로 본 탓에 429로 실패한 32건이 재시도에서 통째로 빠졌다.
  const d = shouldUnderstand({ ...base, analyzed: { hasEvidence: false, attempts: 1 } })
  assert.equal(d.should, true)
  assert.match(d.reason, /다시 시도합니다/)
})

test('★ 재시도에도 상한이 있다 — 비공개 영상에 매번 돈을 태우지 않는다', () => {
  const d = shouldUnderstand({ ...base, analyzed: { hasEvidence: false, attempts: MAX_ATTEMPTS } })
  assert.equal(d.should, false)
  assert.match(d.reason, /읽지 못했습니다/)
})

test('성공 여부가 시도 횟수보다 우선이다 — 건졌으면 횟수와 무관하게 끝', () => {
  const d = shouldUnderstand({ ...base, analyzed: { hasEvidence: true, attempts: 99 } })
  assert.equal(d.should, false)
})

test('이미지·글에는 읽을 영상이 없다', () => {
  assert.equal(shouldUnderstand({ ...base, format: 'image' }).should, false)
  assert.equal(shouldUnderstand({ ...base, format: 'text' }).should, false)
})

test('롱폼은 설명문이 짧을 때 읽는다', () => {
  const thin = shouldUnderstand({
    ...base, format: 'long', captionLength: THIN_CAPTION_CHARS - 1, durationSec: 600,
  })
  assert.equal(thin.should, true)

  const thick = shouldUnderstand({
    ...base, format: 'long', captionLength: THIN_CAPTION_CHARS + 1, durationSec: 600,
  })
  assert.equal(thick.should, false)
  assert.match(thick.reason, /설명문으로 충분히/)
})

test('롱폼이라도 평소 대비 배수가 높으면 읽는다 — 왜 터졌는지는 영상 안에 있다', () => {
  const d = shouldUnderstand({
    ...base, format: 'long', captionLength: 5000, durationSec: 600, outlierIndex: HOT_INDEX,
  })
  assert.equal(d.should, true)
  assert.match(d.reason, /배라/)
})

test('20분을 넘는 영상은 읽지 않는다 — 한 건에 수십만 토큰이 나간다', () => {
  const d = shouldUnderstand({
    ...base, format: 'long', captionLength: 0, durationSec: LONG_FORM_MAX_SEC + 1,
  })
  assert.equal(d.should, false)
  assert.match(d.reason, /20분을 넘는/)
})

test('길이 상한은 배수보다 먼저 본다 — 터진 1시간 영상에 토큰을 쏟지 않는다', () => {
  const d = shouldUnderstand({
    ...base, format: 'long', captionLength: 0, durationSec: 3600, outlierIndex: 9.0,
  })
  assert.equal(d.should, false)
})

test('숏폼은 길이 상한에 걸리지 않는다 — 숏폼 판정이 먼저다', () => {
  assert.equal(shouldUnderstand({ ...base, durationSec: 99999 }).should, true)
})

test('한 번에 읽는 상한이 있다 — 없으면 일괄 수집 직후 비용이 한꺼번에 터진다', () => {
  assert.ok(MEDIA_MAX_PER_PASS > 0 && MEDIA_MAX_PER_PASS <= 20)
})

test('모든 판단에 이유가 붙는다 — 이유 없는 스킵은 고장과 구분되지 않는다', () => {
  const cases = [
    { ...base },
    { ...base, analyzed: { hasEvidence: true, attempts: 1 } },
    { ...base, analyzed: { hasEvidence: false, attempts: 1 } },
    { ...base, analyzed: { hasEvidence: false, attempts: MAX_ATTEMPTS } },
    { ...base, format: 'image' as const },
    { ...base, format: 'long' as const, captionLength: 9999, durationSec: 600 },
    { ...base, format: 'long' as const, captionLength: 0, durationSec: 99999 },
  ]
  for (const c of cases) {
    assert.ok(shouldUnderstand(c).reason.trim().length > 0)
  }
})

/* ───────── 서비스 실패 vs 콘텐츠 실패 ───────── */

test('★ 쿼터 초과는 그 영상의 잘못이 아니다 — 시도로 세면 정상 영상 32건이 영구 포기된다', () => {
  assert.equal(isServiceFailure('AI 응답 실패 (429) You exceeded your current quota'), true)
  assert.equal(isServiceFailure('AI 응답이 시간 안에 오지 않았습니다'), true)
  assert.equal(isServiceFailure('AI를 호출하지 못했습니다'), true)
  assert.equal(isServiceFailure('AI 키가 없어 영상을 분석하지 못했습니다'), true)
  assert.equal(isServiceFailure('AI 응답 실패 (503) upstream'), true)
})

test('영상 자체의 문제는 시도로 센다 — 그래야 비공개 영상을 영원히 두드리지 않는다', () => {
  assert.equal(isServiceFailure('AI 응답 형식이 올바르지 않았습니다'), false)
  assert.equal(isServiceFailure('분석할 영상도 이미지도 확보하지 못했습니다'), false)
  assert.equal(isServiceFailure('AI 응답 실패 (404) not found'), false)
  assert.equal(isServiceFailure(null), false)
  assert.equal(isServiceFailure(undefined), false)
})

/* ───────── 순서 ───────── */

test('★ 재시도가 길이 상한을 우회하지 않는다 — 41분 영상에 매번 토큰을 쏟지 않게', () => {
  // 실측으로 잡은 순서 버그: 재시도 판정을 앞에 두면 "지난번에 못 읽었으니 다시"가
  // 길이 상한보다 먼저 걸려 20분 초과 영상을 계속 읽으려 든다.
  const d = shouldUnderstand({
    ...base, format: 'long', captionLength: 0, durationSec: 41 * 60,
    analyzed: { hasEvidence: false, attempts: 1 },
  })
  assert.equal(d.should, false)
  assert.match(d.reason, /20분을 넘는/)
})

test('★ 재시도가 "설명문으로 충분" 판정도 우회하지 않는다', () => {
  const d = shouldUnderstand({
    ...base, format: 'long', captionLength: 5000, durationSec: 300,
    analyzed: { hasEvidence: false, attempts: 1 },
  })
  assert.equal(d.should, false)
  assert.match(d.reason, /설명문으로 충분히/)
})

test('가치가 있으면 재시도가 살아난다 — 순서를 바꿨다고 재시도가 죽으면 안 된다', () => {
  const d = shouldUnderstand({
    ...base, format: 'long', captionLength: 0, durationSec: 300,
    analyzed: { hasEvidence: false, attempts: 1 },
  })
  assert.equal(d.should, true)
  assert.match(d.reason, /다시 시도합니다/)
})
