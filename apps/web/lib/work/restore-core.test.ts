import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickRestorableColumns, checkWorkflowLock, RESTORABLE_COLUMNS } from './restore-core.ts'

test('pickRestorableColumns: 화이트리스트 컬럼만 통과, 권한/시스템 키는 차단', () => {
  const before = {
    content: '원문', priority: 'high', entry_type: 'doing',
    // 아래는 절대 통과하면 안 되는 키(권한상승·소유권 이전 위험)
    user_id: 'attacker', assignee_user_id: 'x', deleted_at: null, ai_processed: true, embedding: [1, 2],
  }
  const patch = pickRestorableColumns('daily_logs', before)
  assert.deepEqual(patch, { content: '원문', priority: 'high', entry_type: 'doing' })
  for (const k of ['user_id', 'assignee_user_id', 'deleted_at', 'ai_processed', 'embedding']) {
    assert.ok(!(k in patch), `${k}는 patch에 없어야 함`)
  }
})

test('pickRestorableColumns: projects — user_id/embedding 차단, 콘텐츠만', () => {
  const patch = pickRestorableColumns('projects', { name: 'P', budget: 100, user_id: 'v', embedding: [0] })
  assert.deepEqual(patch, { name: 'P', budget: 100 })
})

test('pickRestorableColumns: 미지원 테이블/빈 before는 빈 객체', () => {
  assert.deepEqual(pickRestorableColumns('work_entity_links', { anything: 1 }), {})
  assert.deepEqual(pickRestorableColumns('daily_logs', null), {})
})

test('pickRestorableColumns: before에 없는 컬럼은 스킵(부분 복원)', () => {
  const patch = pickRestorableColumns('weekly_reports', { performance: 'p' })
  assert.deepEqual(patch, { performance: 'p' })
})

test('checkWorkflowLock: 확정된 weekly_reports는 잠금', () => {
  assert.equal(checkWorkflowLock('weekly_reports', { confirmed_at: '2026-07-10' }), '확정된 항목은 되살릴 수 없습니다')
  assert.equal(checkWorkflowLock('weekly_reports', { confirmed_at: null }), null)
  assert.equal(checkWorkflowLock('daily_logs', { confirmed_at: '2026-07-10' }), null)   // 다른 테이블은 무관
  assert.equal(checkWorkflowLock('projects', null), null)
})

test('RESTORABLE_COLUMNS: 위험 컬럼이 화이트리스트에 없음(회귀 가드)', () => {
  const banned = ['user_id', 'deleted_at', 'embedding', 'ai_processed', 'department_id', 'assignee_user_id']
  for (const [table, cols] of Object.entries(RESTORABLE_COLUMNS)) {
    for (const b of banned) {
      assert.ok(!cols.includes(b), `${table} 화이트리스트에 ${b}가 있으면 안 됨`)
    }
  }
})
