/**
 * 작업 큐 가드 (설계서 3.5.2)
 *
 * 여기서 잠그는 것 넷
 * - 선점이 SQL 한 문장인가 (고르기와 잠그기가 나뉘면 그 틈에 남이 집어 간다)
 * - 상한을 넘긴 잡이 dead 가 되는가 (큐로 되돌리면 같은 실패를 영원히 반복한다)
 * - 단계가 멱등인가 (죽은 워커의 잡은 되살아나 다시 돈다)
 * - 실패 사유가 단계별로 남는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  claimJobs, finishJob, failJob, reapStaleJobs, enqueueJob, toJob, isRetriable, workerName,
  CLAIM_FN, FAIL_FN, ENQUEUE_FN, MAX_ERROR_CHARS, type RpcClient, type Job,
} from './queue.ts'
import {
  JOB_TYPES, JOB_RESULT_STAGE, JOB_RUNNING_STAGE, JOB_PRIORITY, DEFAULT_PIPELINE,
  nextJob, dedupeKey, canAdvance, MAX_STAGE_ATTEMPTS,
} from './stages.ts'
import { advance, markFailed, type CaseProgress } from '../domain/status.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIGRATION = readFileSync(
  path.join(HERE, '../../../../../supabase/migrations/249_rfp_job_claim.sql'), 'utf8')

/** rpc 호출을 기록하는 가짜 클라이언트 */
function 가짜DB(reply: (fn: string, args: Record<string, unknown>) => unknown) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const db: RpcClient = {
    async rpc(fn, args) {
      calls.push({ fn, args })
      const data = reply(fn, args)
      return data instanceof Error ? { data: null, error: { message: data.message } } : { data, error: null }
    },
  }
  return { db, calls }
}

const 행 = (over: Record<string, unknown> = {}) => ({
  id: 'j1', org_id: 'o1', case_id: 'c1', job_type: 'parse', payload: {},
  priority: 1, status: 'running', attempts: 1, locked_by: 'w1', error: null,
  dedupe_key: 'c1:parse:v1', ...over,
})

// 선점

test('선점은 SQL 한 문장이다', () => {
  // 고르기와 잠그기가 나뉘면 그 틈에 남이 집어 간다. 부하가 걸릴 때만 나는 사고다
  assert.match(MIGRATION, /for update skip locked/)
  assert.match(MIGRATION, /create or replace function rfp_claim_jobs/)
})

test('선점은 급한 것 먼저, 같으면 오래된 것 먼저다', () => {
  assert.match(MIGRATION, /order by c\.priority asc, c\.created_at asc/)
})

test('선점이 시도 횟수를 올리고 워커 이름을 남긴다', async () => {
  const { db, calls } = 가짜DB(() => [행()])
  const jobs = await claimJobs(db, { limit: 2, worker: 'w-test' })

  assert.equal(calls[0].fn, CLAIM_FN)
  assert.equal(calls[0].args.p_worker, 'w-test')
  assert.equal(calls[0].args.p_limit, 2)
  assert.equal(calls[0].args.p_max_attempts, MAX_STAGE_ATTEMPTS)
  assert.equal(jobs[0].attempts, 1)
  assert.equal(jobs[0].lockedBy, 'w1')
  // 어느 워커가 집어 갔는지 모르면 죽은 워커를 못 찾는다
  assert.match(MIGRATION, /locked_by = p_worker/)
  assert.match(MIGRATION, /attempts\s*=\s*j\.attempts \+ 1/)
})

test('할 일이 없으면 빈 배열이지 오류가 아니다', async () => {
  const { db } = 가짜DB(() => [])
  assert.deepEqual(await claimJobs(db), [])
})

test('종류를 좁혀 집을 수 있다', async () => {
  const { db, calls } = 가짜DB(() => [])
  await claimJobs(db, { jobTypes: ['parse', 'structure'] })
  assert.deepEqual(calls[0].args.p_job_types, ['parse', 'structure'])
})

test('선점이 실패하면 조용히 넘어가지 않는다', async () => {
  const { db } = 가짜DB(() => new Error('연결 끊김'))
  await assert.rejects(() => claimJobs(db), /잡을 집어 오지 못했다/)
})

// 재시도 상한

test('상한을 넘기면 dead 가 되고 큐로 안 돌아온다', () => {
  // 되돌리면 같은 실패를 영원히 반복하면서 다른 잡의 자리를 먹는다
  assert.match(MIGRATION, /case when attempts >= p_max_attempts then 'dead' else 'queued' end/)
})

test('상한은 DB 가 정한다', async () => {
  const { db, calls } = 가짜DB(() => 행({ status: 'dead', attempts: 3 }))
  const job = await failJob(db, 'j1', '파싱 실패')
  assert.equal(calls[0].fn, FAIL_FN)
  assert.equal(calls[0].args.p_max_attempts, MAX_STAGE_ATTEMPTS)
  // 애플리케이션이 정하면 되살아난 잡의 시도 횟수가 반영되지 않는다
  assert.equal(job?.status, 'dead')
})

test('오류 문구가 길면 잘라 둔다', async () => {
  const { db, calls } = 가짜DB(() => 행())
  await failJob(db, 'j1', 'ㄱ'.repeat(MAX_ERROR_CHARS + 500))
  assert.equal(String(calls[0].args.p_error).length, MAX_ERROR_CHARS)
})

test('다시 집을 수 있는지 판정한다', () => {
  const base: Job = toJob(행())
  assert.equal(isRetriable({ ...base, status: 'queued', attempts: 0 }), true)
  assert.equal(isRetriable({ ...base, status: 'queued', attempts: MAX_STAGE_ATTEMPTS }), false)
  assert.equal(isRetriable({ ...base, status: 'done', attempts: 0 }), false)
})

test('죽은 워커의 잡은 되살아나되 상한을 넘긴 것은 아니다', async () => {
  const { db, calls } = 가짜DB(() => 2)
  assert.equal(await reapStaleJobs(db, '5 minutes'), 2)
  assert.equal(calls[0].args.p_older_than, '5 minutes')
  assert.match(MIGRATION, /rfp_reap_stale_jobs/)
  // 되살리기에도 상한이 걸려야 죽은 잡이 큐를 영원히 돌지 않는다
  assert.match(MIGRATION, /update rfp_analysis_jobs[\s\S]*?attempts >= p_max_attempts then 'dead'[\s\S]*?where status = 'running'/)
})

// 멱등

test('같은 단계를 두 번 걸면 있던 잡을 돌려준다', () => {
  // 워커는 죽고, 죽은 워커의 잡은 되살아나 다시 돈다
  assert.match(MIGRATION, /where dedupe_key = p_dedupe_key and status in \('queued','running'\)/)
  assert.match(MIGRATION, /if found then return r; end if/)
  assert.match(MIGRATION, /create unique index if not exists uq_rfp_jobs_dedupe/)
})

test('재처리는 판을 올려 새 키를 만든다', () => {
  assert.equal(dedupeKey('c1', 'parse'), 'c1:parse:v1')
  assert.notEqual(dedupeKey('c1', 'parse', 2), dedupeKey('c1', 'parse', 1))
  // 같은 키로 다시 넣으면 「다시 돌리기」가 조용히 무시된다
  assert.equal(dedupeKey('c1', 'parse', 1), dedupeKey('c1', 'parse', 1))
})

test('넣기는 키가 같으면 같은 잡이다', async () => {
  const 기존 = 행({ status: 'queued' })
  const { db, calls } = 가짜DB(() => 기존)
  const a = await enqueueJob(db, { orgId: 'o1', caseId: 'c1', jobType: 'parse', dedupeKey: 'c1:parse:v1' })
  const b = await enqueueJob(db, { orgId: 'o1', caseId: 'c1', jobType: 'parse', dedupeKey: 'c1:parse:v1' })
  assert.equal(calls[0].fn, ENQUEUE_FN)
  assert.equal(a.id, b.id)
})

test('끝내기를 두 번 해도 같은 결과다', async () => {
  const { db } = 가짜DB(() => 행({ status: 'done' }))
  const a = await finishJob(db, 'j1', { blocks: 12 })
  const b = await finishJob(db, 'j1', { blocks: 12 })
  assert.deepEqual(a, b)
  assert.equal(a?.status, 'done')
})

// 단계

test('잡 종류마다 도는 단계와 끝난 단계가 다르다', () => {
  for (const t of JOB_TYPES) {
    assert.ok(JOB_RUNNING_STAGE[t], `${t} 에 도는 단계가 없다`)
    assert.ok(JOB_RESULT_STAGE[t], `${t} 에 끝난 단계가 없다`)
    assert.notEqual(JOB_RUNNING_STAGE[t], JOB_RESULT_STAGE[t])
    assert.ok(JOB_PRIORITY[t] > 0)
  }
})

test('기본 파이프라인에 교차검증과 비교가 없다', () => {
  // 자동으로 돌리면 공개 문서 한 건에 모델 세 개를 태우고 비용이 세 배가 된다
  assert.deepEqual(DEFAULT_PIPELINE, ['parse', 'structure', 'index', 'analyze'])
  assert.equal(DEFAULT_PIPELINE.includes('cross_verify' as never), false)
})

test('파이프라인이 순서대로 이어지고 끝에서 멈춘다', () => {
  assert.equal(nextJob('parse'), 'structure')
  assert.equal(nextJob('structure'), 'index')
  assert.equal(nextJob('index'), 'analyze')
  assert.equal(nextJob('analyze'), null)
  assert.equal(nextJob('compare'), null)
})

test('상태기계가 허용하지 않는 이동은 막는다', () => {
  assert.equal(canAdvance('uploaded', 'classified'), true)
  assert.equal(canAdvance('uploaded', 'reported'), false)
  assert.throws(() => advance({ stage: 'uploaded', failedAt: null, failedReason: null, attempts: 0 }, 'reported'))
})

test('실패를 적어도 단계는 그대로 남는다', () => {
  const p: CaseProgress = { stage: 'parsing', failedAt: null, failedReason: null, attempts: 1 }
  const failed = markFailed(p, '배포용 문서')
  // 단계를 되돌리면 「어디까지 갔다가 실패했나」를 잃는다
  assert.equal(failed.stage, 'parsing')
  assert.equal(failed.failedAt, 'parsing')
  assert.equal(failed.failedReason, '배포용 문서')
})

test('워커 이름에 프로세스 번호가 들어간다', () => {
  assert.match(workerName('rfp'), /^rfp-\d+$/)
})
