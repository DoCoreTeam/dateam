import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffDailyLog } from './feedback-signals.ts'

// ── 변경 없음 ───────────────────────────────────────────────────
test('diffDailyLog: 동일 스냅샷은 빈 배열', () => {
  const snap = { content: '견적서 발송', entry_type: 'planned' as const, target_date: '2026-06-20', scheduled_at: null }
  assert.deepEqual(diffDailyLog(snap, snap), [])
})

test('diffDailyLog: after 에 없는 필드(undefined)는 변경으로 보지 않음', () => {
  const before = { content: 'A', entry_type: 'planned' as const, target_date: '2026-06-20' }
  const after = { content: 'A' } // entry_type/target_date 미전달
  assert.deepEqual(diffDailyLog(before, after), [])
})

// ── correct_content ─────────────────────────────────────────────
test('diffDailyLog: content 변경 → correct_content', () => {
  const out = diffDailyLog({ content: '견적서 발송' }, { content: 'A사 견적서 발송' })
  assert.deepEqual(out, [
    { signal_type: 'correct_content', field: 'content', before: '견적서 발송', after: 'A사 견적서 발송' },
  ])
})

test('diffDailyLog: 공백만 다른 content 는 변경 아님', () => {
  assert.deepEqual(diffDailyLog({ content: ' 발송 ' }, { content: '발송' }), [])
})

// ── correct_type ────────────────────────────────────────────────
test('diffDailyLog: entry_type 변경 → correct_type', () => {
  const out = diffDailyLog({ entry_type: 'planned' }, { entry_type: 'done' })
  assert.deepEqual(out, [
    { signal_type: 'correct_type', field: 'entry_type', before: 'planned', after: 'done' },
  ])
})

// ── correct_date ────────────────────────────────────────────────
test('diffDailyLog: target_date 변경 → correct_date(target_date)', () => {
  const out = diffDailyLog({ target_date: '2026-06-20' }, { target_date: '2026-06-25' })
  assert.deepEqual(out, [
    { signal_type: 'correct_date', field: 'target_date', before: '2026-06-20', after: '2026-06-25' },
  ])
})

test('diffDailyLog: target_date null→값 도 correct_date', () => {
  const out = diffDailyLog({ target_date: null }, { target_date: '2026-06-25' })
  assert.deepEqual(out, [
    { signal_type: 'correct_date', field: 'target_date', before: null, after: '2026-06-25' },
  ])
})

test('diffDailyLog: target_date 변경 시 scheduled_at 은 무시(1건만)', () => {
  const out = diffDailyLog(
    { target_date: '2026-06-20', scheduled_at: '2026-06-20T09:00:00+09:00' },
    { target_date: '2026-06-25', scheduled_at: '2026-06-25T09:00:00+09:00' },
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].field, 'target_date')
})

test('diffDailyLog: target_date 동일이면 scheduled_at 변경으로 correct_date', () => {
  const out = diffDailyLog(
    { target_date: '2026-06-20', scheduled_at: '2026-06-20T09:00:00+09:00' },
    { target_date: '2026-06-20', scheduled_at: '2026-06-20T14:00:00+09:00' },
  )
  assert.deepEqual(out, [
    { signal_type: 'correct_date', field: 'scheduled_at', before: '2026-06-20T09:00:00+09:00', after: '2026-06-20T14:00:00+09:00' },
  ])
})

// ── 복합 ────────────────────────────────────────────────────────
test('diffDailyLog: content+type+date 동시 변경 → 3건', () => {
  const out = diffDailyLog(
    { content: 'A', entry_type: 'planned', target_date: '2026-06-20' },
    { content: 'B', entry_type: 'done', target_date: '2026-06-25' },
  )
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((d) => d.signal_type).sort(), ['correct_content', 'correct_date', 'correct_type'])
})
