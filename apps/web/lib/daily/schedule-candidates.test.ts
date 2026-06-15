import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveStartAt, selectScheduleCandidates } from './schedule-candidates.ts'
import type { DailyLog } from '@/types/database'

// 후보 선정이 참조하는 필드(id, content, scheduled_at, target_date)만 채운 최소 스텁.
function makeLog(partial: Partial<DailyLog> & { id: string }): DailyLog {
  return {
    content: '',
    scheduled_at: null,
    target_date: null,
    ...partial,
  } as DailyLog
}

// ── deriveStartAt ─────────────────────────────────────────────
test('deriveStartAt: scheduled_at 우선·그대로 사용(hasTime=true)', () => {
  const r = deriveStartAt({ scheduled_at: '2026-06-20T14:30:00.000Z', target_date: '2026-06-21' })
  assert.ok(r)
  assert.equal(r.startAt, '2026-06-20T14:30:00.000Z')
  assert.equal(r.dateLabel, '2026-06-20')
  assert.equal(r.hasTime, true)
})

test('deriveStartAt: target_date 만 있으면 09:00 보정(hasTime=false)', () => {
  const r = deriveStartAt({ scheduled_at: null, target_date: '2026-06-21' })
  assert.ok(r)
  assert.equal(r.dateLabel, '2026-06-21')
  assert.equal(r.hasTime, false)
  // 로컬 09:00 → ISO 변환됐는지(자정이 아님) 확인
  const d = new Date(r.startAt)
  assert.equal(d.getHours(), 9)
})

test('deriveStartAt: 둘 다 없으면 null', () => {
  assert.equal(deriveStartAt({ scheduled_at: null, target_date: null }), null)
})

test('deriveStartAt: 잘못된 target_date 형식은 null', () => {
  assert.equal(deriveStartAt({ scheduled_at: null, target_date: '06/21' }), null)
})

test('deriveStartAt: 존재하지 않는 날짜(2026-02-29)는 롤오버 막고 null', () => {
  assert.equal(deriveStartAt({ scheduled_at: null, target_date: '2026-02-29' }), null)
  // 유효한 윤년(2024-02-29)은 통과
  assert.ok(deriveStartAt({ scheduled_at: null, target_date: '2024-02-29' }))
})

// ── selectScheduleCandidates ──────────────────────────────────
test('selectScheduleCandidates: 일정성 항목만 선정·입력순서 유지', () => {
  const logs = [
    makeLog({ id: 'a', content: '제안서 발송', scheduled_at: '2026-06-20T10:00:00.000Z' }),
    makeLog({ id: 'b', content: '메모만', scheduled_at: null, target_date: null }),
    makeLog({ id: 'c', content: '미팅', target_date: '2026-06-22' }),
  ]
  const out = selectScheduleCandidates(logs)
  assert.deepEqual(out.map((c) => c.logId), ['a', 'c'])
  assert.equal(out[0].title, '제안서 발송')
})

test('selectScheduleCandidates: 이미 연결된 logId 제외', () => {
  const logs = [
    makeLog({ id: 'a', content: '발송', target_date: '2026-06-20' }),
    makeLog({ id: 'b', content: '미팅', target_date: '2026-06-21' }),
  ]
  const out = selectScheduleCandidates(logs, new Set(['a']))
  assert.deepEqual(out.map((c) => c.logId), ['b'])
})

test('selectScheduleCandidates: 제목 공백 항목 제외', () => {
  const logs = [makeLog({ id: 'a', content: '   ', target_date: '2026-06-20' })]
  assert.equal(selectScheduleCandidates(logs).length, 0)
})
