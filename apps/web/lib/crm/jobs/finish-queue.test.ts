// lib/crm/jobs/finish-queue.test.ts — 끝내기 잡의 판정 (마이그 254)
//
// 실측 2026-09-14: 끝내기 한 번이 300초 상한에 걸려 295초에 정리만 저장하고 죽었다.
// 5축은 `crm_ai_run` 에 행 하나 없이 사라졌고, 화면을 나가면 진행도 결과도 없어졌다.
// 여기서 보는 것은 그 셋을 막는 규칙이다 — 이어받기(임대)·한 번만 돌기·결과 남기기.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isOpen, nextStage, isClaimable, mergeSteps, finishJobView, toFinishJob,
  FINISH_STAGES, LEASE_MS, MAX_ATTEMPTS,
  type FinishJob,
} from './finish-queue.ts'

const T0 = Date.parse('2026-09-14T07:55:43.000Z')

function job(over: Partial<FinishJob> = {}): FinishJob {
  return {
    id: 'j1', meetingId: 'm1', workspaceId: 'ws', actorId: null, hostUserId: null,
    status: 'QUEUED', stage: 'DIGEST', steps: [], error: null, retryCount: 0,
    claimedAt: null, createdAt: new Date(T0).toISOString(), finishedAt: null,
    ...over,
  }
}

test('단계 순서가 계약이다 — 정리가 5축보다 먼저다', () => {
  assert.deepEqual([...FINISH_STAGES], ['DIGEST', 'NOTE', 'EXTRACT', 'DONE'])
  assert.equal(nextStage('DIGEST'), 'NOTE')
  assert.equal(nextStage('NOTE'), 'EXTRACT')
  assert.equal(nextStage('EXTRACT'), 'DONE')
  assert.equal(nextStage('DONE'), 'DONE', '끝 다음은 없다')
})

test('진행 중 판정 — 화면이 제 나름으로 따지지 않게 한 곳에 둔다', () => {
  assert.equal(isOpen(job({ status: 'QUEUED' })), true)
  assert.equal(isOpen(job({ status: 'RUNNING' })), true)
  assert.equal(isOpen(job({ status: 'DONE' })), false)
  assert.equal(isOpen(job({ status: 'FAILED' })), false)
})

test('아무도 안 집은 잡은 집는다', () => {
  assert.equal(isClaimable(job({ status: 'QUEUED' }), T0), true)
})

test('★ 임대 안에 있는 잡은 남이 못 집는다 — 두 워커가 같은 일을 두 번 하지 않는다', () => {
  const claimed = job({ status: 'RUNNING', claimedAt: new Date(T0).toISOString() })
  assert.equal(isClaimable(claimed, T0 + 1_000), false)
  assert.equal(isClaimable(claimed, T0 + LEASE_MS - 1), false)
})

test('★ 임대가 끊긴 잡은 다시 집힌다 — 워커가 죽으면 영원히 「정리 중」에 갇힌다', () => {
  const zombie = job({ status: 'RUNNING', claimedAt: new Date(T0).toISOString() })
  assert.equal(isClaimable(zombie, T0 + LEASE_MS), true)
  assert.equal(isClaimable(zombie, T0 + LEASE_MS + 60_000), true)
})

test('★ 시도 상한을 넘으면 더 집지 않는다 — 안 그러면 실패가 무한히 돈다', () => {
  const spent = job({ status: 'QUEUED', retryCount: MAX_ATTEMPTS })
  assert.equal(isClaimable(spent, T0 + LEASE_MS * 10), false)
  assert.equal(isClaimable(job({ retryCount: MAX_ATTEMPTS - 1 }), T0), true)
})

test('claimedAt 이 없는 RUNNING 은 집지 않는다 — 언제부터인지 모르면 좀비인지도 모른다', () => {
  assert.equal(isClaimable(job({ status: 'RUNNING', claimedAt: null }), T0 + LEASE_MS * 10), false)
})

test('★ 같은 단계를 다시 돌아도 결과가 두 줄로 뜨지 않는다', () => {
  const first = [{ key: 'digest' as const, status: 'failed' as const, detail: '정리하지 못했어요.' }]
  const retry = [{ key: 'digest' as const, status: 'done' as const, detail: '안건 3건으로 정리했어요.' }]

  const merged = mergeSteps(first, retry)
  assert.equal(merged.length, 1, '같은 key 가 두 번 들어가면 사용자는 두 번 정리된 줄 안다')
  assert.equal(merged[0].status, 'done', '나중 결과가 이긴다')
})

test('다른 단계의 결과는 쌓인다 — 무엇이 됐고 무엇이 안 됐는지가 이 줄들이다', () => {
  const merged = mergeSteps(
    [{ key: 'end' as const, status: 'done' as const, detail: '끝난 시각을 남겼어요.' }],
    [{ key: 'digest' as const, status: 'done' as const, detail: '안건 3건으로 정리했어요.' }],
  )
  assert.deepEqual(merged.map((s) => s.key), ['end', 'digest'])
})

test('★ 화면이 읽는 모양 — 잡이 없으면 조용하고, 실패는 사유가 있다', () => {
  assert.deepEqual(finishJobView(null),
    { running: false, stage: null, steps: [], error: null, failedSteps: [] })

  const running = finishJobView(job({ status: 'RUNNING', stage: 'EXTRACT' }))
  assert.equal(running.running, true)
  assert.equal(running.stage, 'EXTRACT')

  const failed = finishJobView(job({ status: 'FAILED', error: null }))
  assert.equal(failed.running, false)
  assert.ok(failed.error, '실패인데 할 말이 없으면 오늘처럼 아무 기록 없이 사라진 것과 같다')

  assert.equal(finishJobView(job({ status: 'DONE' })).error, null)
})

test('★ 끝났는데 안 된 단계가 있으면 따로 꺼내 둔다 — 성공과 같은 모양으로 그리면 조용히 사라진다', () => {
  // 실측 2026-09-16 드레인: 한도 소진으로 정리·5축이 둘 다 실패했는데 잡은 DONE 이었다
  const v = finishJobView(job({
    status: 'DONE',
    stage: 'DONE',
    steps: [
      { key: 'end', status: 'skipped', detail: '이미 끝난 미팅이에요.' },
      { key: 'digest', status: 'failed', detail: 'AI 한도 초과' },
      { key: 'note', status: 'skipped', detail: '회의노트는 이미 확정이에요.' },
      { key: 'extract', status: 'failed', detail: 'AI 한도 초과' },
    ],
  }))

  assert.equal(v.running, false)
  assert.equal(v.error, null, '잡 자체가 엎어진 것은 아니다')
  assert.deepEqual(v.failedSteps.map((s) => s.key), ['digest', 'extract'],
    '안 된 단계를 못 꺼내면 화면이 성공처럼 그린다 — 그게 9/14 의 조용한 실패다')
})

test('건너뛴 것은 실패가 아니다 — 원본이 없거나 이미 되어 있는 것은 정상이다', () => {
  const v = finishJobView(job({
    status: 'DONE',
    steps: [{ key: 'note', status: 'skipped', detail: '회의노트는 이미 확정이에요.' }],
  }))
  assert.deepEqual(v.failedSteps, [])
})

test('DB 행을 잡으로 옮긴다 — steps 가 배열이 아니면 빈 배열', () => {
  const j = toFinishJob({
    id: 'j', meeting_id: 'm', workspace_id: 'ws', status: 'RUNNING', stage: 'NOTE',
    steps: null, retry_count: '2', created_at: '2026-09-14T07:55:43.000Z',
  })
  assert.deepEqual(j.steps, [])
  assert.equal(j.retryCount, 2)
  assert.equal(j.meetingId, 'm')
})

/*
  ── 마이그레이션이 같은 말을 하는가 ──────────────────────────────────────────

  판정을 코드에만 두면 두 워커(브라우저·크론)가 동시에 들어올 때 못 막는다.
  진짜 방어선은 DB 다 — 미완 잡 하나 계약과 «고르고 잠그기가 한 문장» 이 둘.
*/
test('★ 마이그 254 가 미완 잡 하나를 DB 에서 지킨다 (두 번 눌러도 두 번 안 돈다)', () => {
  const sql = readFileSync('../../supabase/migrations/254_meeting_finish_job.sql', 'utf-8')

  /*
    **문장 안에서만 본다.** 처음엔 `[\s\S]*?` 로 이었는데, 그러면 유니크 인덱스에서
    술어를 지워도 바로 아래 `idx_finish_job_pending` 의 같은 구절에 붙어 통과했다
    (가드를 깨뜨려 보고 알았다). 세미콜론까지가 한 문장이다.
  */
  const oneOpen = /create unique index[^;]*idx_finish_job_one_open[^;]*;/.exec(sql)?.[0]
  assert.ok(oneOpen, '미완 잡 유니크 인덱스를 못 찾았다 — 가드가 헛돈다')
  assert.match(oneOpen, /where status in \('QUEUED', 'RUNNING'\)/,
    '미완 잡 유니크가 부분 인덱스가 아니면 끝난 잡까지 막혀 다시 정리할 수 없다')
  assert.match(sql, /for update skip locked/,
    '고르는 것과 잠그는 것이 한 문장이 아니면 그 틈으로 남이 집어 간다')
  assert.match(sql, /crm_claim_finish_jobs/, '선점 함수가 없다')
  assert.match(sql, /crm_expire_finish_jobs/, '상한을 넘긴 잡을 실패로 못 박는 곳이 없다')
})

test('임대·시도 상한이 코드와 SQL 에서 같은 뜻이다', () => {
  const sql = readFileSync('../../supabase/migrations/254_meeting_finish_job.sql', 'utf-8')
  const leaseSec = Number(/p_lease_sec\s+int default (\d+)/.exec(sql)?.[1])
  const maxAttempts = Number(/p_max_attempts int default (\d+)/.exec(sql)?.[1])

  assert.equal(leaseSec * 1000, LEASE_MS, `SQL 임대 ${leaseSec}초 와 코드 ${LEASE_MS}ms 가 다르다`)
  assert.equal(maxAttempts, MAX_ATTEMPTS, 'SQL 과 코드의 시도 상한이 다르면 한쪽만 막는다')
})
