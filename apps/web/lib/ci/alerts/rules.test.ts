import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseHhmm, isQuietAt, qualifiesForAlert, alertTitle, alertBody,
  ALERT_LOOKBACK_DAYS, ALERT_MIN_THRESHOLD,
} from './rules.ts'

const NOW = new Date('2026-08-12T00:00:00.000Z')
const fresh = new Date(NOW.getTime() - 86_400_000).toISOString()          // 1일 전
const stale = new Date(NOW.getTime() - 86_400_000 * (ALERT_LOOKBACK_DAYS + 1)).toISOString()

test('parseHhmm — 형식이 틀리면 null', () => {
  assert.equal(parseHhmm('22:00'), 22 * 60)
  assert.equal(parseHhmm('08:30'), 8 * 60 + 30)
  assert.equal(parseHhmm('24:00'), null)
  assert.equal(parseHhmm('9:00'), null)
  assert.equal(parseHhmm(''), null)
})

test('방해 금지 — 꺼져 있으면 언제나 통과', () => {
  assert.equal(isQuietAt({ enabled: false, start: '22:00', end: '08:00' }, '23:00'), false)
  assert.equal(isQuietAt(null, '23:00'), false)
  assert.equal(isQuietAt(undefined, '03:00'), false)
})

test('방해 금지 — 자정을 넘는 구간(기본값 22:00~08:00)', () => {
  const q = { enabled: true, start: '22:00', end: '08:00' }
  assert.equal(isQuietAt(q, '23:00'), true)   // 자정 전
  assert.equal(isQuietAt(q, '03:00'), true)   // 자정 후
  assert.equal(isQuietAt(q, '22:00'), true)   // 경계 시작은 포함
  assert.equal(isQuietAt(q, '08:00'), false)  // 경계 끝은 제외
  assert.equal(isQuietAt(q, '13:00'), false)
})

test('방해 금지 — 같은 날 안에서 끝나는 구간', () => {
  const q = { enabled: true, start: '01:00', end: '06:00' }
  assert.equal(isQuietAt(q, '03:00'), true)
  assert.equal(isQuietAt(q, '23:00'), false)
  assert.equal(isQuietAt(q, '06:00'), false)
})

test('방해 금지 — 길이 0 구간은 방해 금지가 아니다', () => {
  assert.equal(isQuietAt({ enabled: true, start: '09:00', end: '09:00' }, '09:00'), false)
})

test('자격 — 배수·비교군·신선도를 모두 넘어야 한다', () => {
  const base = { outlierIndex: 5, baselineN: 10, collectedAt: fresh }
  assert.equal(qualifiesForAlert(base, 3, 8, NOW), true)
})

test('자격 — 근거 없는 배수(null)는 알리지 않는다', () => {
  assert.equal(
    qualifiesForAlert({ outlierIndex: null, baselineN: 10, collectedAt: fresh }, 3, 8, NOW),
    false,
  )
})

test('자격 — 비교군이 얇으면 알리지 않는다 (신생 채널 매번 울림 방지)', () => {
  assert.equal(
    qualifiesForAlert({ outlierIndex: 9, baselineN: 3, collectedAt: fresh }, 3, 8, NOW),
    false,
  )
})

test('자격 — 기준 배수 미달', () => {
  assert.equal(
    qualifiesForAlert({ outlierIndex: 2.4, baselineN: 10, collectedAt: fresh }, 3, 8, NOW),
    false,
  )
})

test('자격 — 설정이 하한보다 낮아도 하한이 이긴다', () => {
  assert.equal(
    qualifiesForAlert({ outlierIndex: 1.2, baselineN: 10, collectedAt: fresh }, 1, 8, NOW),
    false,
  )
  assert.equal(
    qualifiesForAlert({ outlierIndex: ALERT_MIN_THRESHOLD, baselineN: 10, collectedAt: fresh }, 1, 8, NOW),
    true,
  )
})

test('자격 — 오래 전에 담아둔 것은 "지금 떡상"이 아니다', () => {
  assert.equal(
    qualifiesForAlert({ outlierIndex: 9, baselineN: 10, collectedAt: stale }, 3, 8, NOW),
    false,
  )
})

test('자격 — 수집 시각이 깨져 있으면 알리지 않는다', () => {
  assert.equal(
    qualifiesForAlert({ outlierIndex: 9, baselineN: 10, collectedAt: 'not-a-date' }, 3, 8, NOW),
    false,
  )
})

test('문구 — 배수를 반드시 밝힌다', () => {
  assert.equal(alertTitle('우리 채널', 3.14), '우리 채널 — 평소 대비 3.1배')
  assert.equal(alertTitle(null, 12.4), '평소 대비 12배')
  assert.match(alertBody('첫 영상', 10), /첫 영상/)
  assert.match(alertBody(null, 10), /제목 없음/)
  assert.match(alertBody('제목', 10), /10건/)
})
