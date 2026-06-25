import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRunRow, buildEventRow, deriveStatus, finalizeRunPatch } from './intake-telemetry-core.ts'

test('buildRunRow — 기본값·snake_case 컬럼 매핑', () => {
  const row = buildRunRow({ channel: 'xlsx', userId: 'u1', sourceFilename: 'q.xlsx' })
  assert.equal(row.channel, 'xlsx')
  assert.equal(row.user_id, 'u1')
  assert.equal(row.source_filename, 'q.xlsx')
  assert.equal(row.status, 'running')
  assert.deepEqual(row.counts, {})
  assert.equal(row.is_test, false)
  // 미지정 필드는 null/기본
  assert.equal(row.evidence_drive_file_id, null)
  assert.deepEqual(row.prompt_versions, {})
})

test('buildEventRow — runId 연결 + reason 코드 매핑', () => {
  const ev = buildEventRow('run1', { stage: 'resolve_product', status: 'held', rowRef: 'sheet1!C92', reasonCode: 'model_unresolved', reasonDetail: 'H200 → no catalog' })
  assert.equal(ev.run_id, 'run1')
  assert.equal(ev.stage, 'resolve_product')
  assert.equal(ev.status, 'held')
  assert.equal(ev.row_ref, 'sheet1!C92')
  assert.equal(ev.reason_code, 'model_unresolved')
  assert.equal(ev.output_snapshot, null)
})

test('deriveStatus — 손실 있으면 partial, error면 failed, 깨끗하면 succeeded', () => {
  assert.equal(deriveStatus({ extracted: 10, confirmed: 10 }), 'succeeded')
  assert.equal(deriveStatus({ extracted: 10, held: 2 }), 'partial')
  assert.equal(deriveStatus({ extracted: 10, blocked: 1 }), 'partial')
  assert.equal(deriveStatus({ extracted: 10, truncated: 5 }), 'partial')
  assert.equal(deriveStatus({ extracted: 0 }, 'parse_failed'), 'failed')
})

test('finalizeRunPatch — 주입된 시각으로 duration 결정적 계산(Date.now 비의존)', () => {
  const patch = finalizeRunPatch({ extracted: 8, held: 2 }, { startedAtMs: 1000, nowMs: 3500 })
  assert.equal(patch.status, 'partial')
  assert.equal(patch.duration_ms, 2500)
  assert.deepEqual(patch.counts, { extracted: 8, held: 2 })
  assert.equal(patch.error_code, null)
  // 음수 방지
  assert.equal(finalizeRunPatch({}, { startedAtMs: 5000, nowMs: 4000 }).duration_ms, 0)
})
