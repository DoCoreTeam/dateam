import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  STALE_LOCK_MS, CLAIM_BATCH, WEB_DRAIN_LIMIT, WEB_DRAIN_BUDGET_MS,
  DRIVER_MAX_ERRORS, DRIVER_IDLE_MS, DRIVER_BUSY_MS,
  isStaleLock, nextDriverDelayMs, shouldRunBackstop,
} from './drain-policy.ts'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..', '..', '..')

// ── 잠금 만료 판정 ────────────────────────────────────────────────────

test('잠금이 만료되지 않았으면 살아 있는 것으로 본다 — 남의 잡을 뺏지 않는다', () => {
  const now = Date.UTC(2026, 7, 16, 0, 10, 0)
  const lockedAt = new Date(now - 60_000).toISOString()   // 1분 전
  assert.equal(isStaleLock(lockedAt, now), false)
})

test('잠금이 만료되면 회수 대상이다', () => {
  const now = Date.UTC(2026, 7, 16, 0, 10, 0)
  const lockedAt = new Date(now - STALE_LOCK_MS - 1000).toISOString()
  assert.equal(isStaleLock(lockedAt, now), true)
})

test('running인데 잠금 시각이 없거나 깨졌으면 회수 대상 — 이미 비정상이다', () => {
  const now = Date.now()
  assert.equal(isStaleLock(null, now), true)
  assert.equal(isStaleLock(undefined, now), true)
  assert.equal(isStaleLock('말이 안 되는 값', now), true)
})

test('만료 기준은 서버리스 함수 상한보다 넉넉하다 — 살아 있는 잡을 뺏으면 중복 실행이다', () => {
  assert.ok(STALE_LOCK_MS >= 5 * 60 * 1000)
})

// ── 브라우저 구동 간격 ────────────────────────────────────────────────

test('남은 잡이 있으면 짧게 몰아치고, 없으면 느긋해진다', () => {
  assert.equal(nextDriverDelayMs({ remaining: 3, consecutiveErrors: 0 }), DRIVER_BUSY_MS)
  assert.equal(nextDriverDelayMs({ remaining: 0, consecutiveErrors: 0 }), DRIVER_IDLE_MS)
  assert.ok(DRIVER_BUSY_MS < DRIVER_IDLE_MS)
})

test('연속 실패하면 물러난다 — 서버가 아플 때 몰아치면 더 아프게 만든다', () => {
  const first = nextDriverDelayMs({ remaining: 5, consecutiveErrors: 1 })
  const second = nextDriverDelayMs({ remaining: 5, consecutiveErrors: 2 })
  const third = nextDriverDelayMs({ remaining: 5, consecutiveErrors: 3 })
  assert.ok(first !== null && second !== null && third !== null)
  assert.ok(second > first)
  assert.ok(third > second)
})

test('백오프 중에는 남은 잡이 많아도 짧은 간격으로 돌아가지 않는다', () => {
  const busy = nextDriverDelayMs({ remaining: 99, consecutiveErrors: 2 })
  assert.ok(busy !== null && busy > DRIVER_BUSY_MS)
})

test('백오프는 상한이 있다 — 무한정 벌어지지 않는다', () => {
  const long = nextDriverDelayMs({ remaining: 1, consecutiveErrors: DRIVER_MAX_ERRORS - 1 })
  assert.ok(long !== null && long <= 60_000)
})

test('연속 실패 한도를 넘으면 멈춘다(null) — 조용히 계속 때리지 않는다', () => {
  assert.equal(nextDriverDelayMs({ remaining: 10, consecutiveErrors: DRIVER_MAX_ERRORS }), null)
})

// ── 크론 백스톱 게이트 ────────────────────────────────────────────────

test('할 일이 하나도 없으면 백스톱은 돌지 않는다 — 사람이 볼 때는 브라우저가 한다', () => {
  assert.equal(shouldRunBackstop({ dueJobs: 0, dueSnapshots: 0, stalledJobs: 0 }), false)
})

test('셋 중 하나라도 있으면 돈다 — 좀비만 있어도 뚫어줘야 큐가 안 막힌다', () => {
  assert.equal(shouldRunBackstop({ dueJobs: 1, dueSnapshots: 0, stalledJobs: 0 }), true)
  assert.equal(shouldRunBackstop({ dueJobs: 0, dueSnapshots: 1, stalledJobs: 0 }), true)
  assert.equal(shouldRunBackstop({ dueJobs: 0, dueSnapshots: 0, stalledJobs: 1 }), true)
})

// ── 예산 ─────────────────────────────────────────────────────────────

test('브라우저 1회 예산은 사람이 기다릴 만한 길이다', () => {
  assert.ok(WEB_DRAIN_BUDGET_MS <= 10_000)
  assert.ok(WEB_DRAIN_LIMIT <= 10)
})

test('임대 배치는 상한보다 작다 — 예산을 넘겨도 잡 하나 길이만큼만 넘는다', () => {
  assert.ok(CLAIM_BATCH >= 1)
  assert.ok(CLAIM_BATCH < WEB_DRAIN_LIMIT)
})

// ── 배선 가드: 고쳐놓고 안 부르면 아무 일도 안 일어난다 ──────────────

test('가드: 좀비 회수가 드레인 경로에 실제로 배선돼 있다', () => {
  const drain = readFileSync(join(webRoot, 'lib/ci/jobs/drain.ts'), 'utf8')
  assert.match(drain, /recoverStalledJobs\(/, '드레인이 좀비 회수를 부르지 않는다')
  assert.match(drain, /runDueSnapshots\(/, '드레인이 스냅샷 예약을 훑지 않는다')
})

test('가드: 잡 임대와 대기 집계가 워크스페이스 경계를 받는다', () => {
  const queue = readFileSync(join(webRoot, 'lib/ci/jobs/queue.ts'), 'utf8')
  assert.match(
    queue,
    /export async function claimJobs\([\s\S]{0,200}workspaceId\?: string \| null/,
    'claimJobs가 워크스페이스 인자를 받지 않는다 — 세션 드레인이 남의 잡을 집는다',
  )
  assert.match(
    queue,
    /export async function countPendingJobs\(workspaceId\?: string \| null\)/,
    'countPendingJobs가 워크스페이스 인자를 받지 않는다',
  )
})

test('가드: 브라우저 드레인 입구는 세션으로 인증하고 자기 워크스페이스만 돌린다', () => {
  const route = readFileSync(join(webRoot, 'app/api/ci/queue/drain/route.ts'), 'utf8')
  assert.match(route, /requireCiMemberApi/, '세션 인증을 하지 않는다')
  assert.match(route, /workspaceId: session\.workspaceId/, '자기 워크스페이스로 가두지 않는다')
  assert.doesNotMatch(route, /CI_WORKER_TOKEN/, '서비스 토큰이 브라우저 경로에 새어 나왔다')
})

test('가드: 크론 백스톱이 게이트를 거친다 — 할 일 없으면 즉시 반환', () => {
  const cron = readFileSync(join(webRoot, 'app/api/cron/analyze-drain/route.ts'), 'utf8')
  assert.match(cron, /shouldRunBackstop\(/, '백스톱이 게이트 없이 매번 돈다')
  assert.match(cron, /drainQueue\(/, '백스톱이 CI 큐를 돌리지 않는다')
})

test('가드: 큐를 돌리는 세 경로가 모두 같은 구현(drainQueue)을 쓴다', () => {
  const files = [
    'app/api/ci/queue/drain/route.ts',
    'app/api/ci/internal/worker/tick/route.ts',
    'app/api/cron/analyze-drain/route.ts',
  ]
  for (const f of files) {
    const src = readFileSync(join(webRoot, f), 'utf8')
    assert.match(src, /from '@\/lib\/ci\/jobs\/drain'/, `${f}가 드레인 SSOT를 쓰지 않는다`)
    assert.doesNotMatch(src, /\bclaimJobs\(/, `${f}가 큐 처리 루프를 자작한다`)
  }
})

test('가드: 구동기가 셸에 실제로 마운트돼 있다 — 만들어놓고 안 붙이면 안 돈다', () => {
  const layout = readFileSync(join(webRoot, 'app/(ci)/layout.tsx'), 'utf8')
  // import만 보면 안 된다. 실제로 렌더 트리(Dock 슬롯)에 들어갔는지를 본다 —
  // import는 남아 있는데 마운트만 지워도 통과하면 가드가 아니다(실제로 처음 이렇게 썼다가 놓쳤다).
  assert.match(
    layout,
    /node:\s*<QueueDriver\b/,
    'CI 셸의 Dock에 큐 구동기가 등록돼 있지 않다 — import만 있고 안 그려진다',
  )
})

test('가드: 구동기는 보이지 않는 탭에서 때리지 않고, 앞 요청이 끝나기 전에 겹쳐 보내지 않는다', () => {
  const driver = readFileSync(join(webRoot, 'components/ci/QueueDriver.tsx'), 'utf8')
  assert.match(driver, /visibilityState/, '배경 탭에서도 요청을 보낸다 — 조용히 쿼터를 태운다')
  assert.match(driver, /inFlight/, '앞 요청이 끝나기 전에 다음 요청을 보낸다')
  assert.match(driver, /nextDriverDelayMs/, '간격 정책 SSOT를 쓰지 않는다')
})
