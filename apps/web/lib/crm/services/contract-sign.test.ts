/**
 * 계약서 보냄 체결 해지와 딜 금액 (P0132 I10)
 *
 * 세 약속
 *   1 체결과 해지는 관리자만 — 서버가 거절한다
 *   2 보냄과 체결은 그때의 버전 번호를 든다, 체결 뒤 버전 쓰기 거절, 변경 계약서는 원 계약을 가리킨다
 *   3 체결이 딜 계약 금액과 대표 견적을 채우고 금액 이력에 출처를 남긴다 — 한 트랜잭션
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assertActionRole, assertActionState, contractPatchFor, contractNetOf } from './contract-sign.ts'
import { planSave } from './contract.ts'
import { CONTRACT_ACTION_ROLE, canAmend, isContractAction } from '../domain/contract-status.ts'
import { CrmError } from '../domain/errors.ts'
import { CONTRACT_STATUS_LABEL } from '../../terms/contract-doc.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const SIGN = read('lib/crm/services/contract-sign.ts')
const CONTRACT = read('lib/crm/services/contract.ts')
const ROUTE = read('app/api/crm/contracts/[id]/status/route.ts')
const code = (c: string) => (e: unknown) => e instanceof CrmError && e.code === c
const NOW = new Date('2026-10-18T03:00:00Z')

/* ── 1 누가 ─────────────────────────────────────── */

test('★ 체결과 해지는 관리자만 — 구성원이 부르면 서버가 거절한다', () => {
  assert.throws(() => assertActionRole('MEMBER', 'conclude'), code('FORBIDDEN'))
  assert.throws(() => assertActionRole('MEMBER', 'terminate'), code('FORBIDDEN'))
  assert.throws(() => assertActionRole('READONLY', 'send'), code('FORBIDDEN'))
  for (const r of ['ADMIN', 'OWNER'] as const) {
    assertActionRole(r, 'conclude')
    assertActionRole(r, 'terminate')
  }
  assertActionRole('MEMBER', 'send')
  assertActionRole('MEMBER', 'cancel')
  assert.deepEqual(CONTRACT_ACTION_ROLE, { send: 'MEMBER', conclude: 'ADMIN', terminate: 'ADMIN', cancel: 'MEMBER' })
})

test('★ 역할은 세션에서 온다 — 요청 본문의 값을 안 믿는다', () => {
  assert.ok(ROUTE.includes('role: session.role'))
  assert.equal(/role:\s*body/.test(ROUTE), false)
  assert.equal((ROUTE.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length, 1)
  assert.ok(ROUTE.includes("withCrmApi('MEMBER'"))
  assert.ok(SIGN.indexOf('assertActionRole(actor.role, action)') < SIGN.indexOf('return withCrmTx'), '트랜잭션을 열기 전에 막는다')
})

/* ── 2 상태와 버전 번호 ─────────────────────────── */

test('상태마다 받는 동작', () => {
  assertActionState('DRAFT', 'send')
  assertActionState('DRAFT', 'conclude')
  assertActionState('DRAFT', 'cancel')
  assertActionState('CONCLUDED', 'terminate')
  assert.throws(() => assertActionState('CONCLUDED', 'send'), code('INVALID_TRANSITION'))
  assert.throws(() => assertActionState('CONCLUDED', 'conclude'), code('INVALID_TRANSITION'))
  assert.throws(() => assertActionState('DRAFT', 'terminate'), code('INVALID_TRANSITION'))
  assert.throws(() => assertActionState('CANCELLED', 'conclude'), code('INVALID_TRANSITION'))
  assert.throws(() => assertActionState('TERMINATED', 'cancel'), code('INVALID_TRANSITION'))
  for (const s of ['DRAFT', 'CONCLUDED', 'TERMINATED', 'CANCELLED']) assert.ok(CONTRACT_STATUS_LABEL[s])
  assert.equal(isContractAction('amend'), false, '변경 계약서는 상태 바꾸기가 아니다')
  assert.equal(isContractAction('conclude'), true)
})

test('★ 보냄과 체결은 그때의 버전 번호를 든다', () => {
  assert.deepEqual(contractPatchFor('send', { currentVersionNo: 4 }, NOW, null), { sentAt: NOW, sentVersionNo: 4 })
  assert.deepEqual(contractPatchFor('conclude', { currentVersionNo: 5 }, NOW, 'att_1'), {
    status: 'CONCLUDED', concludedAt: NOW, concludedVersionNo: 5, signedAttachmentId: 'att_1',
  })
  assert.deepEqual(contractPatchFor('conclude', { currentVersionNo: 5 }, NOW, null), { status: 'CONCLUDED', concludedAt: NOW, concludedVersionNo: 5 })
})

test('★ 체결한 계약서는 버전을 더 쓰지 않는다', () => {
  const cur = { body: [], fieldValues: {}, quoteSnapshot: null, contentHash: 'x' }
  assert.throws(
    () => planSave({ status: 'CONCLUDED', version: 1, title: 't', contractNo: 'CT-1' }, cur, 1, { body: null, patch: {} }),
    code('INVALID_TRANSITION'),
  )
})

test('★ 변경 계약서는 체결한 계약에서만, 원 계약을 가리키고 새 번호를 받는다', () => {
  assert.equal(canAmend('CONCLUDED'), true)
  for (const s of ['DRAFT', 'TERMINATED', 'CANCELLED']) assert.equal(canAmend(s), false)
  const fn = CONTRACT.slice(CONTRACT.indexOf('export async function createAmendment'))
  assert.ok(fn.includes('parentContractId: parent.id'))
  assert.ok(fn.includes('nextContractNo(tx, pattern'), '번호는 새로 받는다')
  assert.ok(fn.includes('autoValuesFrom(cur.quoteSnapshot, contractNo)'), '자동 칸이 새 번호로 다시 만들어진다')
  assert.ok(fn.includes("kind: 'AMENDED'"))
  assert.equal(/c\(tx\)\.update|updateMany/.test(fn), false, '원 계약은 건드리지 않는다')
})

/* ── 3 딜 금액 ─────────────────────────────────── */

test('계약 금액은 공급가(netTotalMinor)다 — 부가세 포함 총액이 아니다', () => {
  assert.equal(contractNetOf({ totals: { netTotalMinor: '17500000', totalMinor: '19250000' } } as never), BigInt(17500000))
  assert.equal(contractNetOf(null), null)
})

test('★ 체결이 딜 계약 금액과 대표 견적을 채우고 금액 이력에 출처를 남긴다', () => {
  const book = SIGN.slice(SIGN.indexOf('async function bookDealAmount'), SIGN.indexOf('/** 보냄 체결 해지 취소'))
  assert.ok(book.includes('contractNetMinor: net'))
  assert.ok(book.includes('primaryQuoteId: contract.quoteId'))
  assert.ok(book.includes("field: 'contract'"))
  assert.ok(book.includes('sourceQuoteId: contract.quoteId'))
  assert.ok(book.includes('fromMinor: deal.contractNetMinor'), '바뀌기 전 값을 남긴다')
  assert.ok(book.includes('recalcLedger(tx'), '장부의 확정 금액도 같은 트랜잭션에서 다시 센다')
})

test('★ 계약서, 딜, 금액 이력, 감사 기록이 한 트랜잭션이다', () => {
  const fn = SIGN.slice(SIGN.indexOf('export async function changeContractStatus'))
  const tx = fn.slice(fn.indexOf('return withCrmTx'))
  for (const s of ['crmContract.updateMany', 'bookDealAmount(tx', 'writeAudit(tx']) assert.ok(tx.includes(s), `${s} 가 트랜잭션 밖에 있다`)
  assert.ok(fn.includes("action === 'conclude' ? await bookDealAmount"), '딜 금액은 체결 때만 움직인다')
})

test('서명본은 이 딜에 계약서 종류로 올린 지우지 않은 첨부만', () => {
  const fn = SIGN.slice(SIGN.indexOf('async function checkSignedAttachment'), SIGN.indexOf('/** 체결이 딜 금액을 정한다'))
  assert.ok(fn.includes("targetType: 'DEAL', targetId: dealId, kind: 'CONTRACT', deletedAt: null"))
  assert.ok(read('lib/crm/services/attachment.ts').includes("const BUCKET = 'crm-attachment'"))
})
