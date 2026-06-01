import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DailyLog } from '@/types/database'
import { groupDailyLogs, truncateLabel } from './grouping.ts'

/** 테스트용 최소 DailyLog 팩토리 */
function log(partial: Partial<DailyLog>): DailyLog {
  return {
    id: 'id',
    user_id: 'u1',
    log_date: '2026-06-01',
    logged_at: '2026-06-01T15:21:00Z',
    content: '업무',
    entry_type: 'planned',
    is_resolved: false,
    priority: 'normal',
    scheduled_at: null,
    ai_processed: false,
    ai_confidence: null,
    original_input: null,
    linked_account_id: null,
    linked_contact_id: null,
    target_date: null,
    target_date_set_by: null,
    origin_group_id: null,
    parent_log_id: null,
    source_type: null,
    flow_reason: null,
    memo_status: null,
    memo_reviewed_at: null,
    created_at: '2026-06-01T15:21:00Z',
    updated_at: '2026-06-01T15:21:00Z',
    ...partial,
  } as DailyLog
}

test('같은 origin_group_id는 한 묶음으로 그룹핑된다', () => {
  const logs = [
    log({ id: 'a', origin_group_id: 'g1', content: '메인 업무', logged_at: '2026-06-01T15:21:00Z' }),
    log({ id: 'b', origin_group_id: 'g1', content: '서브 1', logged_at: '2026-06-01T15:21:05Z' }),
    log({ id: 'c', origin_group_id: 'g1', content: '서브 2', logged_at: '2026-06-01T15:21:10Z' }),
  ]
  const groups = groupDailyLogs(logs)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].key, 'g1')
  assert.equal(groups[0].isBatch, true)
  assert.equal(groups[0].count, 3)
  assert.equal(groups[0].label, '메인 업무')
  assert.equal(groups[0].loggedAt, '2026-06-01T15:21:00Z')
})

test('origin_group_id가 없으면 단건 그룹(single:<id>)이 된다', () => {
  const logs = [log({ id: 'm1', origin_group_id: null, content: '수동 메모' })]
  const groups = groupDailyLogs(logs)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].key, 'single:m1')
  assert.equal(groups[0].isBatch, false)
  assert.equal(groups[0].count, 1)
})

test('서로 다른 배치 + 단건이 섞여도 입력 순서를 보존한다', () => {
  const logs = [
    log({ id: 'a', origin_group_id: 'g1', logged_at: '2026-06-01T09:00:00Z' }),
    log({ id: 'b', origin_group_id: 'g1', logged_at: '2026-06-01T09:00:01Z' }),
    log({ id: 'c', origin_group_id: null, logged_at: '2026-06-01T10:00:00Z' }),
    log({ id: 'd', origin_group_id: 'g2', logged_at: '2026-06-01T11:00:00Z' }),
    log({ id: 'e', origin_group_id: 'g2', logged_at: '2026-06-01T11:00:01Z' }),
  ]
  const groups = groupDailyLogs(logs)
  assert.deepEqual(groups.map((g) => g.key), ['g1', 'single:c', 'g2'])
  assert.deepEqual(groups.map((g) => g.count), [2, 1, 2])
})

test('화면에 배치 중 1건만 로드되면 count=1, isBatch=false (화면 로드분 기준)', () => {
  const logs = [log({ id: 'a', origin_group_id: 'g1' })]
  const groups = groupDailyLogs(logs)
  assert.equal(groups[0].count, 1)
  assert.equal(groups[0].isBatch, false)
})

test('doneCount는 entry_type=done 개수를 센다', () => {
  const logs = [
    log({ id: 'a', origin_group_id: 'g1', entry_type: 'done' }),
    log({ id: 'b', origin_group_id: 'g1', entry_type: 'planned' }),
    log({ id: 'c', origin_group_id: 'g1', entry_type: 'done' }),
  ]
  const groups = groupDailyLogs(logs)
  assert.equal(groups[0].doneCount, 2)
  assert.equal(groups[0].count, 3)
})

test('빈 배열은 빈 그룹을 반환한다', () => {
  assert.deepEqual(groupDailyLogs([]), [])
})

test('truncateLabel: 긴 텍스트는 말줄임, 줄바꿈은 한 줄로 정리', () => {
  assert.equal(truncateLabel('짧은 제목'), '짧은 제목')
  assert.equal(truncateLabel('여러\n줄\n입력'), '여러 줄 입력')
  const long = '가'.repeat(40)
  const out = truncateLabel(long)
  assert.equal(out.length, 31) // 30 + …
  assert.ok(out.endsWith('…'))
})
