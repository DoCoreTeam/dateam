// 단계 진입 조건 (dacrm)
//
// **왜 이 가드가 있는가**: `entryCriteriaJson` 은 스키마에 있는데 읽는 코드가
// 한 줄도 없었다 — 컬럼만 있고 아무 일도 안 일어나는 상태였다.
// 그래서 이 파일은 두 가지를 잠근다.
//   ① 판정이 맞는가 (막을 것을 막고, 알릴 것만 알리는가)
//   ② **딜 이동이 실제로 이 판정을 부르는가** — 안 부르면 설정 화면일 뿐이다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseCriteria, normalizeCriteria, evaluateCriteria, blockingMessage,
  ALL_CRITERIA, CRITERION_LABEL, type DealFacts,
} from './entry-criteria.ts'

function facts(over: Partial<DealFacts> = {}): DealFacts {
  return {
    amountMinor: null, closeDate: null, ownerId: null, companyId: null,
    contactCount: 0, openTaskCount: 0,
    ...over,
  }
}

test('조건이 없으면 아무것도 막지 않는다 — 대부분의 단계가 그렇다', () => {
  const v = evaluateCriteria([], facts())
  assert.equal(v.ok, true)
  assert.deepEqual(v.blocking, [])
  assert.deepEqual(v.warnings, [])
})

test('★ block 은 막고 warn 은 통과시킨다 — 전부 막으면 사람이 CRM 을 안 쓴다', () => {
  const v = evaluateCriteria(
    [{ key: 'amount', level: 'block' }, { key: 'closeDate', level: 'warn' }],
    facts(),
  )
  assert.equal(v.ok, false)
  assert.equal(v.blocking.length, 1)
  assert.equal(v.blocking[0].key, 'amount')
  assert.equal(v.warnings.length, 1)
  assert.equal(v.warnings[0].key, 'closeDate')
})

test('채워져 있으면 조건이 걸려 있어도 통과한다', () => {
  const v = evaluateCriteria(
    [{ key: 'amount', level: 'block' }, { key: 'company', level: 'block' }],
    facts({ amountMinor: '50000000', companyId: 'c1' }),
  )
  assert.equal(v.ok, true)
})

test('★ 금액 0 은 "안 정했다"로 본다 — 0원 계약보다 미입력이 압도적으로 흔하다', () => {
  const rule = [{ key: 'amount' as const, level: 'block' as const }]
  assert.equal(evaluateCriteria(rule, facts({ amountMinor: '0' })).ok, false)
  assert.equal(evaluateCriteria(rule, facts({ amountMinor: BigInt(0) })).ok, false)
  assert.equal(evaluateCriteria(rule, facts({ amountMinor: '1' })).ok, true)
})

test('사람·할 일은 개수로 본다 — 0건이면 비어 있는 것이다', () => {
  const rule = [{ key: 'contact' as const, level: 'block' as const }, { key: 'nextTask' as const, level: 'warn' as const }]
  const empty = evaluateCriteria(rule, facts())
  assert.equal(empty.ok, false)
  assert.equal(empty.warnings.length, 1)

  const filled = evaluateCriteria(rule, facts({ contactCount: 2, openTaskCount: 1 }))
  assert.equal(filled.ok, true)
  assert.equal(filled.warnings.length, 0)
})

test('막힌 이유는 무엇을 하라는 말로 나온다 — "amount 없음"은 개발자 말이다', () => {
  const v = evaluateCriteria(
    [{ key: 'amount', level: 'block' }, { key: 'owner', level: 'block' }],
    facts(),
  )
  const msg = blockingMessage(v)
  assert.ok(msg)
  assert.ok(msg.includes('금액'))
  assert.ok(msg.includes('담당자'))
  assert.equal(blockingMessage({ ok: true, blocking: [], warnings: [] }), null)
})

test('★ 손상된 정의 때문에 딜 이동이 통째로 막히지 않는다 — 모르는 것은 조용히 버린다', () => {
  assert.deepEqual(parseCriteria(null), [])
  assert.deepEqual(parseCriteria('rubbish'), [])
  assert.deepEqual(parseCriteria([{ key: '없는조건', level: 'block' }]), [])
  assert.deepEqual(parseCriteria([{ nope: 1 }, null, 3]), [])
})

test('같은 조건이 두 번 오면 앞의 것만 남는다 — 중복이 서로를 반박하면 안 된다', () => {
  const out = parseCriteria([
    { key: 'amount', level: 'block' },
    { key: 'amount', level: 'warn' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].level, 'block')
})

test('모르는 수준은 warn 으로 떨어진다 — 실수로 block 이 되면 사람이 갇힌다', () => {
  assert.equal(normalizeCriteria([{ key: 'amount', level: 'DESTROY' }])[0].level, 'warn')
})

test('모든 조건에 사람이 읽을 이름이 있다 — 없으면 화면에 키가 그대로 나온다', () => {
  for (const k of ALL_CRITERIA) {
    assert.ok(CRITERION_LABEL[k], `${k} 라벨 없음`)
  }
})

test('★ 딜 이동이 실제로 진입 조건을 부른다 — 안 부르면 설정 화면일 뿐이다', () => {
  const src = readFileSync(new URL('../services/deal.ts', import.meta.url), 'utf8')
  // 정의가 아니라 **호출**을 본다 — 정의만 남기고 호출을 지워도 통과하면 가드가 아니다
  assert.ok(src.includes('await checkEntryCriteria('), '이동 경로가 조건을 실제로 부르지 않는다')
  assert.ok(src.includes('blockingMessage(verdict)'), '막을 조건을 판정하지 않는다')
  assert.ok(src.includes("throw new CrmError('VALIDATION_FAILED', blocked"), '막아야 할 때 막지 않는다')
  // 이동이 끝난 뒤 경고를 실어 보내야 화면이 말할 수 있다
  assert.ok(src.includes('entryWarnings'), '경고를 응답에 싣지 않는다')
})

test('★ 보드가 그 경고를 실제로 보여 준다 — 응답에만 있으면 없는 것과 같다', () => {
  const src = readFileSync(new URL('../../../app/(crm)/crm/deals/DealBoard.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes('body.entryWarnings'), '보드가 응답의 경고를 읽지 않는다')
  assert.ok(src.includes('{moveNotice &&'), '보드가 경고를 렌더하지 않는다')
})

test('★ 조건 변경은 관리자만 — 화면에서만 숨기면 API 로 새어 나간다', () => {
  const src = readFileSync(new URL('../../../app/api/crm/stages/[id]/route.ts', import.meta.url), 'utf8')
  assert.ok(src.includes("withCrmApi('ADMIN'"), '단계 수정이 ADMIN 게이트를 안 거친다')
})
