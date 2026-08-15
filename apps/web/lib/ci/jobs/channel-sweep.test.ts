import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  isSweepDue, normalizeIntervalHours,
  DEFAULT_REFRESH_INTERVAL_HOURS, SWEEP_DUE_MAX_PER_TICK,
} from './channel-sweep-policy.ts'

const here = dirname(fileURLToPath(import.meta.url))
const HOUR = 3600_000

// ── 주기 판정 ────────────────────────────────────────────────────────

test('한 번도 안 훑은 채널은 즉시 대상 — 등록만 되고 비어 있는 채널이 생기지 않게', () => {
  assert.equal(isSweepDue(null, 24), true)
  assert.equal(isSweepDue(undefined, 24), true)
})

test('주기가 안 지났으면 훑지 않는다 — 매 틱마다 훑으면 외부 쿼터가 녹는다', () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0)
  assert.equal(isSweepDue(new Date(now - 5 * HOUR).toISOString(), 24, now), false)
})

test('주기가 지나면 대상이 된다', () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0)
  assert.equal(isSweepDue(new Date(now - 25 * HOUR).toISOString(), 24, now), true)
})

test('경계: 정확히 주기만큼 지났으면 대상 (영원히 1분씩 밀리지 않게)', () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0)
  assert.equal(isSweepDue(new Date(now - 24 * HOUR).toISOString(), 24, now), true)
})

test('시각이 깨져 있으면 훑는다 — 판정 불가를 "안 훑음"으로 두면 영영 멈춘다', () => {
  assert.equal(isSweepDue('말이 안 되는 값', 24), true)
})

test('짧은 주기 설정도 그대로 지킨다 (1시간)', () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0)
  assert.equal(isSweepDue(new Date(now - 30 * 60_000).toISOString(), 1, now), false)
  assert.equal(isSweepDue(new Date(now - 90 * 60_000).toISOString(), 1, now), true)
})

// ── 설정값 위생 ──────────────────────────────────────────────────────

test('설정 범위 안의 값은 그대로 쓴다', () => {
  assert.equal(normalizeIntervalHours(1), 1)
  assert.equal(normalizeIntervalHours(24), 24)
  assert.equal(normalizeIntervalHours(168), 168)
})

test('★ 0·음수는 기본값으로 — 0이면 매 틱마다 전 채널을 훑는다', () => {
  assert.equal(normalizeIntervalHours(0), DEFAULT_REFRESH_INTERVAL_HOURS)
  assert.equal(normalizeIntervalHours(-3), DEFAULT_REFRESH_INTERVAL_HOURS)
})

test('상한 밖·쓰레기 값도 기본값으로 (예외 없이)', () => {
  assert.equal(normalizeIntervalHours(10_000), DEFAULT_REFRESH_INTERVAL_HOURS)
  assert.equal(normalizeIntervalHours('스물넷'), DEFAULT_REFRESH_INTERVAL_HOURS)
  assert.equal(normalizeIntervalHours(null), DEFAULT_REFRESH_INTERVAL_HOURS)
  assert.equal(normalizeIntervalHours(undefined), DEFAULT_REFRESH_INTERVAL_HOURS)
  assert.equal(normalizeIntervalHours(NaN), DEFAULT_REFRESH_INTERVAL_HOURS)
})

test('기본 주기는 설정 레지스트리의 기본값과 같다 — 두 곳이 갈리면 화면과 동작이 어긋난다', () => {
  const reg = readFileSync(join(here, '..', 'settings', 'registry.ts'), 'utf8')
  const m = /ingest\.refresh_interval_hours[\s\S]{0,400}?defaultValue:\s*(\d+)/.exec(reg)
  assert.ok(m, '레지스트리에서 기본값을 못 찾았다')
  assert.equal(Number(m![1]), DEFAULT_REFRESH_INTERVAL_HOURS)
})

test('한 틱에 거는 재훑기에 상한이 있다 — 채널 500곳이 한 번에 터지지 않게', () => {
  assert.ok(SWEEP_DUE_MAX_PER_TICK > 0 && SWEEP_DUE_MAX_PER_TICK <= 20)
})

// ── 배선 가드 ────────────────────────────────────────────────────────

test('가드: 설정을 실제로 읽는다 — 화면에만 있고 안 읽으면 바꿔도 아무 일이 없다', () => {
  const src = readFileSync(join(here, 'channel-sweep.ts'), 'utf8')
  assert.match(src, /ingest\.refresh_interval_hours/, '주기 설정을 읽지 않는다')
  assert.match(src, /resolveSettings\(/, '설정 해석 SSOT를 우회한다(우선순위가 틀어진다)')
})

test('가드: 잡을 걸기 전에 last_sweep_at을 찍는다 — 같은 계정을 여러 번 훑지 않게', () => {
  const src = readFileSync(join(here, 'channel-sweep.ts'), 'utf8')
  const stampAt = src.indexOf('last_sweep_at: nowIso')
  const enqueueAt = src.indexOf('await enqueueJob(', stampAt)
  assert.ok(stampAt > 0, '훑기 시각을 찍지 않는다')
  assert.ok(enqueueAt > stampAt, '잡을 먼저 걸고 나중에 찍으면 중복 훑기가 난다')
})

test('가드: 재훑기가 드레인 SSOT에 배선돼 있다 — 만들어놓고 안 부르면 안 돈다', () => {
  const src = readFileSync(join(here, 'drain.ts'), 'utf8')
  assert.match(src, /runDueChannelSweeps\(/, '드레인이 재훑기를 부르지 않는다')
  assert.match(src, /sweepsEnqueued/, '결과에 재훑기 수가 안 실린다')
})

test('가드: 크론 백스톱이 재훑기도 게이트에 넣는다 — 사람 없는 동안 모니터링이 멈추지 않게', () => {
  const src = readFileSync(join(here, '..', '..', '..', 'app/api/cron/analyze-drain/route.ts'), 'utf8')
  assert.match(src, /countDueChannelSweeps\(/, '백스톱이 재훑기 대상을 세지 않는다')
  assert.match(src, /dueSweeps/, '게이트에 재훑기가 반영되지 않는다')
})

test('가드: 채널 잡은 콘텐츠 체인을 타지 않는다 — 타면 매 주기마다 죽은 잡이 쌓인다', () => {
  const src = readFileSync(join(here, 'policy.ts'), 'utf8')
  assert.match(src, /if \(targetType === 'channel'\) return null/)
})
