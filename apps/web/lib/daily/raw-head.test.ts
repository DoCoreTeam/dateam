import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DailyLog } from '@/types/database'
import { isRawHead, excludeRawHeads, EXCLUDE_RAW_HEAD_OR } from './raw-head.ts'

function log(partial: Partial<DailyLog>): DailyLog {
  return {
    id: 'id', user_id: 'u1', log_date: '2026-06-22', logged_at: '2026-06-22T00:00:00Z',
    content: 'x', entry_type: 'doing', is_resolved: false, priority: 'normal', scheduled_at: null,
    ai_processed: true, ai_confidence: null, original_input: null, linked_account_id: null,
    linked_contact_id: null, target_date: null, target_date_set_by: null, origin_group_id: null,
    parent_log_id: null, source_type: null, flow_reason: null, memo_status: null, memo_reviewed_at: null,
    task_kind: 'personal', assignee_user_id: null, department_id: null, progress: 0, checklist: [],
    promoted_from_log_id: null, meeting_note_id: null, created_at: '2026-06-22T00:00:00Z',
    updated_at: '2026-06-22T00:00:00Z', ...partial,
  } as DailyLog
}

test('isRawHead: ai_processed=false + manual + origin_group_id → true', () => {
  assert.equal(isRawHead(log({ ai_processed: false, source_type: 'manual', origin_group_id: 'g1' })), true)
})

test('isRawHead: 일반 수동 단건(origin_group_id=null)은 raw 헤드 아님', () => {
  assert.equal(isRawHead(log({ ai_processed: false, source_type: null, origin_group_id: null })), false)
})

test('isRawHead: AI 분해 자식(ai_processed=true)은 raw 헤드 아님', () => {
  assert.equal(isRawHead(log({ ai_processed: true, source_type: 'ai_split', origin_group_id: 'g1' })), false)
})

test('excludeRawHeads: raw 헤드만 떨어지고 일반/자식은 유지', () => {
  const rows = [
    log({ id: 'raw', ai_processed: false, source_type: 'manual', origin_group_id: 'g1' }),
    log({ id: 'child', ai_processed: true, source_type: 'ai_split', origin_group_id: 'g1' }),
    log({ id: 'manual', ai_processed: false, source_type: null, origin_group_id: null }),
  ]
  assert.deepEqual(excludeRawHeads(rows).map((r) => r.id), ['child', 'manual'])
})

test('EXCLUDE_RAW_HEAD_OR: raw 헤드 여집합(ai_processed=true OR origin_group_id IS NULL)과 동치', () => {
  // 쿼리 절이 isRawHead의 정확한 여집합인지 메모리상 동치 검증
  assert.equal(EXCLUDE_RAW_HEAD_OR, 'ai_processed.eq.true,origin_group_id.is.null')
  const rows = [
    log({ id: 'raw', ai_processed: false, source_type: 'manual', origin_group_id: 'g1' }),
    log({ id: 'child', ai_processed: true, origin_group_id: 'g1' }),
    log({ id: 'manual', ai_processed: false, origin_group_id: null }),
  ]
  // 절의 의미(ai_processed=true OR origin_group_id is null)로 필터한 결과 == excludeRawHeads
  const byClause = rows.filter((r) => r.ai_processed === true || r.origin_group_id == null)
  assert.deepEqual(byClause.map((r) => r.id), excludeRawHeads(rows).map((r) => r.id))
})
