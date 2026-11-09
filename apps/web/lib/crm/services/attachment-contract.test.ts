/**
 * 계약 첨부의 보기 판정 (P0184 I12c)
 *
 *   1 계약 대상 첨부는 계약을 볼 수 있을 때만 목록에 나온다, 못 보면 「찾을 수 없음」(있는지 안 알림)
 *   2 내려받기 지우기는 첨부 줄의 대상을 다시 본다
 *   3 계약 말고 다른 대상은 이 판정을 안 탄다
 *   4 창구 넷(목록 올리기 내려받기 지우기)이 판정을 부른다, 영구 삭제는 계약 첨부 행을 트리거로 지운다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assertAttachmentVisible, assertTarget, listAttachments } from './attachment.ts'
import { CrmError } from '../domain/errors.ts'

const WEB = join(import.meta.dirname, '..', '..', '..')
const ROOT = join(WEB, '..', '..')
const notFound = (e: unknown) => e instanceof CrmError && e.code === 'NOT_FOUND'

/** 등급 거름망을 흉내 낸 연결 — visible 에 든 계약만 보인다 (getCrmDb 가 하는 일) */
function fakeDb(visible: string[]) {
  const attachments = [
    { id: 'a1', targetType: 'CONTRACT', targetId: 'ct-corp', fileName: '서명본.pdf' },
    { id: 'a2', targetType: 'DEAL', targetId: 'd1', fileName: '견적.pdf' },
  ]
  return {
    crmContract: { findFirst: async ({ where }: { where: { id: string } }) => (visible.includes(where.id) ? { id: where.id } : null) },
    crmAttachment: {
      findFirst: async ({ where }: { where: { id: string } }) => attachments.find((a) => a.id === where.id) ?? null,
      findMany: async ({ where }: { where: { targetType: string; targetId: string } }) =>
        attachments.filter((a) => a.targetType === where.targetType && a.targetId === where.targetId),
    },
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (d: unknown) => d as any

test('1 계약을 볼 수 없으면 그 계약의 첨부 목록은 「찾을 수 없음」', async () => {
  await assert.rejects(listAttachments(asDb(fakeDb([])), 'CONTRACT', 'ct-corp'), notFound)
  const rows = await listAttachments(asDb(fakeDb(['ct-corp'])), 'CONTRACT', 'ct-corp')
  assert.deepEqual(rows.map((r) => r.id), ['a1'])
})

test('2 내려받기 지우기는 첨부 줄의 대상 계약을 다시 본다', async () => {
  await assert.rejects(assertAttachmentVisible(asDb(fakeDb([])), 'a1'), notFound)
  await assertAttachmentVisible(asDb(fakeDb(['ct-corp'])), 'a1')
  await assert.rejects(assertAttachmentVisible(asDb(fakeDb(['ct-corp'])), 'nope'), notFound)
})

test('3 계약 말고 다른 대상은 계약 판정을 안 탄다, 계약은 첨부 대상으로 받는다', async () => {
  await assertAttachmentVisible(asDb(fakeDb([])), 'a2')
  assert.equal(assertTarget('CONTRACT'), 'CONTRACT')
})

test('4 창구 넷이 판정을 부르고, 영구 삭제는 계약 첨부를 트리거로 지운다', () => {
  const list = readFileSync(join(WEB, 'app/api/crm/attachments/route.ts'), 'utf8')
  assert.match(list, /await assertTargetVisible\(getCrmDb\(session\.workspaceId\), target, targetId\)/, '올리기가 판정 없이 버킷에 올린다')
  assert.match(readFileSync(join(WEB, 'app/api/crm/attachments/[id]/url/route.ts'), 'utf8'), /await assertAttachmentVisible\(db, id\)/)
  assert.match(readFileSync(join(WEB, 'app/api/crm/attachments/[id]/route.ts'), 'utf8'), /await assertAttachmentVisible\(getCrmDb\(session\.workspaceId\), id\)/)
  const sql = readFileSync(join(ROOT, 'supabase/migrations/329_contract_attachment_target.sql'), 'utf8')
  assert.match(sql, /AFTER DELETE ON crm_contract/)
  assert.match(sql, /DELETE FROM crm_attachment WHERE "targetType"::text = 'CONTRACT' AND "targetId" = OLD\.id/)
  assert.match(sql, /SET search_path = public, pg_temp/)
})
