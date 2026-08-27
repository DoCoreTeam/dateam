import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CALL_INTERVAL_MS, DEFAULT_MAX_SETS, FREE_TIER_DAILY_LIMIT,
} from './discovery.ts'

// 이 파일이 지키는 것: 몰아치면 아예 못 간다.
// 실측(2026-08-27) — 간격 없이 60건을 쏘자 429가 나고 재시도까지 겹쳐
// **123회 호출에 성공 0회**였다. 실패 원인은 코드 논리가 아니라 속도였다.

/**
 * 실측 앵커(E-6). Gemini 응답의 QuotaFailure 위반 본문에서 그대로 읽은 값이다:
 *   quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier
 *   metric:  generativelanguage.googleapis.com/generate_content_free_tier_requests
 *   value:   20            ← 분당이 아니라 **하루**다 (2026-08-27 실측)
 *
 * 처음엔 응답 문구의 "Please retry in 1.28s"만 보고 분당으로 읽었다가 정정했다.
 * 판정 근거는 문구가 아니라 quotaId 다.
 */
const MEASURED_FREE_TIER_PER_DAY = 20

/** 유료 구간에서 실제 벽이 되는 분당 한도(보수적 가정). 간격은 이 값을 넘지 않게 잡는다. */
const ASSUMED_PAID_RPM = 20

test('★ 실측 일일 한도를 코드가 같은 숫자로 알고 있다 — 화면이 다른 말을 하면 안 된다', () => {
  assert.equal(FREE_TIER_DAILY_LIMIT, MEASURED_FREE_TIER_PER_DAY)
})

test('호출 간격이 분당 한도 가정 안에 있다 — 몰아치면 빨리 가려다 아예 못 간다', () => {
  const callsPerMinute = 60_000 / MIN_CALL_INTERVAL_MS
  assert.ok(
    callsPerMinute < ASSUMED_PAID_RPM,
    `분당 ${callsPerMinute.toFixed(1)}회 — 가정 한도 ${ASSUMED_PAID_RPM}회를 넘는다`,
  )
})

test('여유가 지나치게 크지도 않다 — 느리면 한 주제를 도는 데 몇십 분이 걸린다', () => {
  const callsPerMinute = 60_000 / MIN_CALL_INTERVAL_MS
  assert.ok(
    callsPerMinute > ASSUMED_PAID_RPM * 0.7,
    `분당 ${callsPerMinute.toFixed(1)}회 — 한도(${ASSUMED_PAID_RPM})에 비해 너무 느리다`,
  )
})

test('한 주제의 한 번 처리가 사람이 기다릴 만한 길이다', () => {
  // 상한 건수 × 간격 + 묶기 1회. 20분을 넘으면 잡이 아니라 방치가 된다.
  const worstCaseMs = (DEFAULT_MAX_SETS + 1) * MIN_CALL_INTERVAL_MS
  assert.ok(
    worstCaseMs < 20 * 60_000,
    `한 주제에 ${Math.round(worstCaseMs / 60_000)}분 — 너무 길다`,
  )
})

test('상한이 0이 아니다 — 0이면 기능이 조용히 없는 것과 같다', () => {
  assert.ok(DEFAULT_MAX_SETS > 0)
})
