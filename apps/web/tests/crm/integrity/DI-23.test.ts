/**
 * DI-23 세그먼트 — 전사 구간은 끝이 시작보다 뒤여야 한다
 * 근거: 구현명세서 2.3 "ALTER TABLE crm_transcript_segment ADD CONSTRAINT chk_seg_time CHECK (end_ms > start_ms)"
 *       crm_schema CrmTranscriptSegment.endMs "// CHECK (end_ms > start_ms) 는 raw SQL 마이그레이션(DI-23)"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, catchError } from './_helpers.ts'

async function withRecording(tx: any, id: string) {
  await tx.crmMeeting.create({ data: { id: `mt_${id}`, title: '회의', startedAt: new Date() } })
  await tx.crmMeetingRecording.create({ data: { id: `rc_${id}`, meetingId: `mt_${id}`, fileUrl: 'crm/x.m4a' } })
  return `rc_${id}`
}

test('DI-23 endMs 가 startMs 보다 작으면 저장되지 않는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    const rec = await withRecording(tx, 'di23a')
    const e = await catchError(() => tx.crmTranscriptSegment.create({
      data: { id: 'sg_di23a', recordingId: rec, idx: 1, speaker: '화자1', startMs: 5000, endMs: 4000, text: 'x' },
    }))
    assert.ok(e, '역전된 구간이 저장됐다')
    assert.match(String(e), /chk_seg_time/)
  })
})

test('DI-23 endMs 가 startMs 와 같아도 저장되지 않는다 (길이 0 구간 금지)', async () => {
  await inRollback(dbA, async (tx: any) => {
    const rec = await withRecording(tx, 'di23b')
    const e = await catchError(() => tx.crmTranscriptSegment.create({
      data: { id: 'sg_di23b', recordingId: rec, idx: 1, speaker: '화자1', startMs: 5000, endMs: 5000, text: 'x' },
    }))
    assert.ok(e)
    assert.match(String(e), /chk_seg_time/)
  })
})

test('DI-23 정상 구간은 저장되고, 같은 녹음에서 idx 는 중복될 수 없다', async () => {
  await inRollback(dbA, async (tx: any) => {
    const rec = await withRecording(tx, 'di23c')
    await tx.crmTranscriptSegment.create({
      data: { id: 'sg_di23c1', recordingId: rec, idx: 1, speaker: '화자1', startMs: 0, endMs: 1500, text: '안녕하세요' },
    })
    const e = await catchError(() => tx.crmTranscriptSegment.create({
      data: { id: 'sg_di23c2', recordingId: rec, idx: 1, speaker: '화자2', startMs: 1500, endMs: 3000, text: '네' },
    }))
    assert.ok(e, '같은 idx 가 두 번 들어갔다')
    assert.equal((e as any).code, 'P2002')
  })
})
