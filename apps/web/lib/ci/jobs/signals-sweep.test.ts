// lib/ci/jobs/signals-sweep.test.ts — 이슈 자동 수집이 «실제로 도는가» 가드
//
// 만들어 놓고 안 부르면 없는 기능이다. 이 저장소는 그 사고를 여러 번 겪었다
// (v0.7.438 /ci: 테이블·설정만 만들고 소비 코드가 0이었다).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isSignalSweepDue, normalizeSignalIntervalHours,
  SIGNAL_SWEEP_MAX_PER_TICK, DEFAULT_SIGNAL_INTERVAL_HOURS,
} from './signals-sweep-policy.ts'

const here = dirname(fileURLToPath(import.meta.url))
// here = apps/web/lib/ci/jobs → 다섯 단계 올라가야 저장소 루트다
const read = (rel: string) => readFileSync(join(here, '..', '..', '..', '..', '..', rel), 'utf8')

const HOUR = 3600_000
const NOW = Date.parse('2026-08-31T00:00:00Z')

test('한 번도 안 훑었으면 즉시 대상 — 켜 놓고 아무 일도 안 일어나면 안 된다', () => {
  assert.equal(isSignalSweepDue(null, 12, NOW), true)
})

test('주기가 안 지났으면 훑지 않는다 — 웹 검색 한도를 다른 기능과 나눠 쓴다', () => {
  assert.equal(isSignalSweepDue(new Date(NOW - 3 * HOUR).toISOString(), 12, NOW), false)
})

test('경계: 정확히 주기만큼 지났으면 대상이다 — 영원히 1분씩 밀리지 않게', () => {
  assert.equal(isSignalSweepDue(new Date(NOW - 12 * HOUR).toISOString(), 12, NOW), true)
})

test('시각이 깨져 있으면 훑는다 — 판정 불가를 「안 훑음」으로 두면 영영 멈춘다', () => {
  assert.equal(isSignalSweepDue('말이 안 되는 값', 12, NOW), true)
})

test('★ 0·음수·상한 밖은 기본값으로 — 0이면 매 틱마다 훑어 AI 한도를 태운다', () => {
  for (const bad of [0, -1, 999, Number.NaN, '열두시간', null, undefined]) {
    assert.equal(normalizeSignalIntervalHours(bad), DEFAULT_SIGNAL_INTERVAL_HOURS)
  }
  assert.equal(normalizeSignalIntervalHours(6), 6, '범위 안의 값은 그대로 지킨다')
})

test('기본 주기가 설정 레지스트리와 같은 값이다 — 두 곳이 갈리면 화면과 동작이 어긋난다', () => {
  const registry = read('apps/web/lib/ci/settings/registry.ts')
  const m = registry.match(/key: 'signals\.interval_hours'[\s\S]*?defaultValue: (\d+)/)
  assert.ok(m, '설정 레지스트리에 signals.interval_hours 가 없다')
  assert.equal(Number(m![1]), DEFAULT_SIGNAL_INTERVAL_HOURS)
})

test('한 틱에 거는 훑기에 상한이 있다 — 웹 검색은 5~40초라 크론 예산을 먹는다', () => {
  assert.ok(SIGNAL_SWEEP_MAX_PER_TICK >= 1 && SIGNAL_SWEEP_MAX_PER_TICK <= 3)
})

test('★ 훑기가 드레인 SSOT 에 배선돼 있다 — 만들어놓고 안 부르면 안 돈다', () => {
  const drain = read('apps/web/lib/ci/jobs/drain.ts')
  assert.match(drain, /runDueSignalSweeps\(/)
})

test('★ 크론 백스톱도 이슈 훑기를 「할 일」로 센다 — 뉴스는 밤에도 난다', () => {
  const cron = read('apps/web/app/api/cron/analyze-drain/route.ts')
  assert.match(cron, /countDueSignalSweeps\(\)/)
  assert.match(cron, /dueSignalSweeps/)
  const policy = read('apps/web/lib/ci/jobs/drain-policy.ts')
  assert.match(policy, /dueSignalSweeps/)
})

test('★ 잡을 걸기 전에 시각을 먼저 찍는다 — 다음 틱이 같은 곳을 또 훑으면 한도가 두 배로 든다', () => {
  const src = read('apps/web/lib/ci/jobs/signals-sweep.ts')
  const stampAt = src.indexOf('last_signal_sweep_at: nowIso')
  const enqueueAt = src.indexOf('enqueueJob({')
  assert.ok(stampAt > 0 && enqueueAt > 0)
  assert.ok(stampAt < enqueueAt, '찍기가 걸기보다 먼저여야 한다')
})

test('★ 잡 단계에 실제 실행기가 붙어 있다 — 단계만 늘리면 잡이 죽는다', () => {
  const handlers = read('apps/web/lib/ci/jobs/handlers.ts')
  assert.match(handlers, /signals: handleSignals/)
  assert.match(handlers, /runSignalSweep\(/)
})

test('★ 자동으로 확정하지 않는다 — 후보로만 담고 사람이 확인한다(§5-3)', () => {
  const server = read('apps/web/lib/ci/ai/signals-server.ts')
  assert.match(server, /status: 'candidate'/)
  assert.ok(!/status: 'confirmed'/.test(server),
    '수집기가 확정본을 만들면 근거 없는 줄이 사실처럼 읽힌다')
})

test('★ 웹 검색을 켜고 부른다 — 끄면 모델이 기억으로 답하고 출처가 빈다', () => {
  const server = read('apps/web/lib/ci/ai/signals-server.ts')
  assert.match(server, /webSearch: true/)
  assert.match(server, /hostAdapter\(/, 'HTTP 호출을 다시 짜지 않고 호스트 어댑터를 쓴다')
})

test('★ 실패를 조용히 0건으로 끝내지 않는다 — 로그에 남긴다', () => {
  const server = read('apps/web/lib/ci/ai/signals-server.ts')
  assert.match(server, /recordSystemEventAsync\(/)
})

test('★ 확정된 이슈와 확인 대기를 섞지 않는다 — 섞이면 미확인 줄이 사실로 읽힌다', () => {
  const q = read('apps/web/lib/ci/queries/trends.ts')
  assert.match(q, /\.eq\('status', 'confirmed'\)/)
  assert.match(q, /\.eq\('status', 'candidate'\)/)
})

test('★ 화면이 후보를 실제로 그리고, 고른 것만 등록한다', () => {
  const view = read('apps/web/app/(ci)/ci/trends/TrendsView.tsx')
  assert.match(view, /signalCandidates/)
  assert.match(view, /decideSignals\('confirm'/)
  assert.match(view, /method: 'PATCH'/)
  const page = read('apps/web/app/(ci)/ci/trends/page.tsx')
  assert.match(page, /getSignalCandidates\(/, '페이지가 안 실어 내리면 화면은 영원히 비어 있다')
})

test('★ 이슈가 기획으로 흐른다 — 등록만 되고 아무 데도 안 쓰이면 목록만 길어진다', () => {
  const page = read('apps/web/app/(ci)/ci/recommend/page.tsx')
  assert.match(page, /getSignals\(/, '「오늘 뭘 만들까」가 이슈를 읽지 않으면 이슈는 쓰이는 곳이 없다')
  assert.match(page, /SignalSpark/)
  const spark = read('apps/web/components/ci/SignalSpark.tsx')
  assert.match(spark, /\/api\/ci\/ideas/, '기획으로 넘기는 실제 호출이 있어야 한다')
  assert.match(spark, /setError/, '눌렀는데 아무 일도 안 나면 두 번째부터 아무도 안 누른다')
})

test('★ 옛 모델 폴백이 되살아나지 않는다 — 하드코딩한 gemini-1.5-flash 는 실측 404 다', () => {
  for (const f of ['apps/web/app/api/reports/preview/route.ts', 'apps/web/app/api/reports/export/route.ts']) {
    const src = read(f)
    assert.ok(!src.includes("'gemini-1.5-flash'"), `${f} 에 죽은 모델이 남아 있다`)
    assert.match(src, /DEFAULT_GEMINI_MODEL/, `${f} 가 공용 기본값을 안 쓴다`)
  }
})
