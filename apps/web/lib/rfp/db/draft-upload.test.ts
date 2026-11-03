import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  draftUploadPath, isDraftPathOf, planDraftUploads, readDraftRefs, readDraftFailure, MAX_DRAFT_FILES,
} from './draft-upload.ts'
import { MAX_FILE_BYTES } from './limits.ts'

const ORG = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-2222-3333-4444-555555555555'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const newId = () => ID

test('초안 자리는 조직/profile-draft/uuid.bin 이다', () => {
  assert.equal(draftUploadPath(ORG, ID), `${ORG}/profile-draft/${ID}.bin`)
  assert.equal(isDraftPathOf(ORG, draftUploadPath(ORG, ID)), true)
})

test('남의 조직·케이스 원문·경로 넘기기는 초안 자리가 아니다', () => {
  assert.equal(isDraftPathOf(ORG, draftUploadPath(OTHER, ID)), false)
  assert.equal(isDraftPathOf(ORG, `${ORG}/${ID}/abc.bin`), false)
  assert.equal(isDraftPathOf(ORG, `${ORG}/profile-draft/../${ID}.bin`), false)
  assert.equal(isDraftPathOf(ORG, `${ORG}/profile-draft/${ID}.bin/x`), false)
  assert.equal(isDraftPathOf('.*', `${ORG}/profile-draft/${ID}.bin`), false)
})

test('4.5MB 를 넘는 회사소개서도 자리를 받는다', () => {
  const plan = planDraftUploads(ORG, [{ name: '회사소개서.pdf', size: 12 * 1024 * 1024 }], newId)
  assert.deepEqual(plan, { ok: true, targets: [{ name: '회사소개서.pdf', path: draftUploadPath(ORG, ID) }] })
})

test('상한을 넘거나 비었거나 너무 많으면 주소를 안 준다', () => {
  assert.equal(planDraftUploads(ORG, [], newId).ok, false)
  const big = planDraftUploads(ORG, [{ name: 'a.pdf', size: MAX_FILE_BYTES + 1 }], newId)
  assert.deepEqual(big, { ok: false, error: 'file_too_large', name: 'a.pdf', limit: MAX_FILE_BYTES })
  const empty = planDraftUploads(ORG, [{ name: 'a.pdf', size: 0 }], newId)
  assert.equal(empty.ok === false && empty.error, 'empty_file')
  const many = Array.from({ length: MAX_DRAFT_FILES + 1 }, (_, i) => ({ name: `${i}.pdf`, size: 1 }))
  assert.deepEqual(planDraftUploads(ORG, many, newId), { ok: false, error: 'too_many_files', limit: MAX_DRAFT_FILES })
})

test('초안 창구는 자기 조직 초안 자리만 받는다', () => {
  const mine = [{ name: 'a.pdf', path: draftUploadPath(ORG, ID) }]
  assert.deepEqual(readDraftRefs(ORG, mine), mine)
  assert.equal(readDraftRefs(ORG, [{ name: 'a.pdf', path: draftUploadPath(OTHER, ID) }]), null)
  assert.equal(readDraftRefs(ORG, [{ name: '', path: draftUploadPath(ORG, ID) }]), null)
  assert.equal(readDraftRefs(ORG, 'x'), null)
  assert.equal(readDraftRefs(ORG, []), null)
})

test('실패 본문이 JSON 이 아니어도 갈래가 선다', () => {
  assert.equal(readDraftFailure(413, null).kind, 'too_large')
  assert.deepEqual(readDraftFailure(400, { error: 'file_too_large', name: 'a.pdf', limit: MAX_FILE_BYTES }),
    { kind: 'too_large', name: 'a.pdf', limitMb: 200 })
  assert.deepEqual(readDraftFailure(400, { error: 'too_many_files', limit: 5 }), { kind: 'too_many', limit: 5 })
  assert.equal(readDraftFailure(422, { error: 'no_readable_file' }).kind, 'unreadable')
  assert.equal(readDraftFailure(502, { error: 'upload_url_failed' }).kind, 'upload_failed')
  assert.equal(readDraftFailure(500, 'Internal').kind, 'generic')
})
