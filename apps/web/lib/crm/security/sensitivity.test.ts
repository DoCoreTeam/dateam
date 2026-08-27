import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sensitivityOf, canView, capabilitiesOf, hasCapability,
  pickVisible, pickVisibleAll, stripForExport,
  FIELD_SENSITIVITY, VISIBILITY_POLICY, ROLE_CAPABILITIES, ALL_CAPABILITIES,
} from './sensitivity.ts'

const OWNER = { role: 'OWNER' }
const ADMIN = { role: 'ADMIN' }
const MEMBER = { role: 'MEMBER' }
const READONLY = { role: 'READONLY' }

test('등재되지 않은 필드는 restricted 로 본다 — 새 필드가 조용히 새지 않는다', () => {
  assert.equal(sensitivityOf('deal.무언가새로생긴칸'), 'restricted')
  assert.equal(canView(MEMBER, 'deal.무언가새로생긴칸'), false)
  assert.equal(canView(OWNER, 'deal.무언가새로생긴칸'), true)
})

test('현물 — 합계는 internal, 명세는 restricted', () => {
  // 합계 2.6억만으로는 인건비 단가를 역산할 수 없다
  assert.equal(sensitivityOf('deal.inKindTotalMinor'), 'internal')
  assert.equal(canView(MEMBER, 'deal.inKindTotalMinor'), true)
  // 명세는 «3명 × 50% × 24개월 = 1.8억» 이라 1인 연봉이 역산된다
  assert.equal(sensitivityOf('inKind.valueMinor'), 'restricted')
  assert.equal(canView(MEMBER, 'inKind.valueMinor'), false)
  assert.equal(canView(ADMIN, 'inKind.valueMinor'), true)
})

test('원가·마진 계열은 전부 restricted', () => {
  for (const f of [
    'quoteLine.costMinor', 'quote.marginPct', 'quoteNode.profitPct',
    'dealCost.amountMinor', 'costBaseline.hourlyCostMinor', 'laborGrade.costPerMmMinor',
    'partnerTier.discountPct', 'supplyQuote.unitPriceUsd', 'competitor.priceMinor',
  ]) {
    assert.equal(sensitivityOf(f), 'restricted', f)
    assert.equal(canView(MEMBER, f), false, f)
  }
})

test('견적서에 실리는 것은 public — 고객이 본다', () => {
  for (const f of ['quote.proposedNetMinor', 'quote.taxMinor', 'quote.grossMinor', 'quoteLine.unitPriceMinor']) {
    assert.equal(sensitivityOf(f), 'public', f)
    assert.equal(canView(READONLY, f), true, f)
  }
})

test('로그인하지 않았으면 아무것도 못 본다', () => {
  assert.equal(canView(null, 'quote.grossMinor'), false)
  assert.equal(canView(undefined, 'deal.bookedNetMinor'), false)
})

test('능력으로 개별 부여하면 역할과 무관하게 원가를 본다 — 나중에 푸는 길', () => {
  const 팀장 = { role: 'MEMBER', capabilities: ['cost.view'] as const }
  assert.equal(canView(MEMBER, 'quote.marginPct'), false)
  assert.equal(canView(팀장, 'quote.marginPct'), true)
})

test('역할 기본 능력 — 지금은 원가가 관리자에만 있다 (답 6)', () => {
  assert.equal(hasCapability(OWNER, 'cost.view'), true)
  assert.equal(hasCapability(ADMIN, 'cost.view'), true)
  assert.equal(hasCapability(MEMBER, 'cost.view'), false)
  assert.equal(hasCapability(READONLY, 'cost.view'), false)
  // 견적 발송은 멤버도 한다
  assert.equal(hasCapability(MEMBER, 'quote.send'), true)
  assert.equal(hasCapability(READONLY, 'quote.send'), false)
})

test('capabilitiesOf — 역할 기본값 + 개별 부여를 합치고 중복을 없앤다', () => {
  const c = capabilitiesOf({ role: 'MEMBER', capabilities: ['quote.send', 'margin.view'] })
  assert.deepEqual([...c].sort(), ['margin.view', 'quote.send'])
  assert.deepEqual(capabilitiesOf(null), [])
  assert.deepEqual(capabilitiesOf({ role: '없는역할' }), [])
})

test('pickVisible — 가리지 않고 제거한다 (전선을 타고 나가지 않게)', () => {
  const line = { name: '  H100', unitPriceMinor: 37_965n, costMinor: 31_131n, lineTotalMinor: 100n }
  const forMember = pickVisible(line, 'quoteLine', MEMBER)
  assert.ok(!('costMinor' in forMember), 'costMinor 가 응답에 남아 있으면 안 된다')
  assert.equal(forMember.unitPriceMinor, 37_965n)

  const forAdmin = pickVisible(line, 'quoteLine', ADMIN)
  assert.equal(forAdmin.costMinor, 31_131n)
})

test('pickVisibleAll — 배열도 같은 규칙', () => {
  const rows = [{ valueMinor: 1n, kind: 'x' }, { valueMinor: 2n, kind: 'y' }]
  const out = pickVisibleAll(rows, 'inKind', MEMBER)
  assert.equal(out.length, 2)
  assert.ok(out.every((r) => !('valueMinor' in r)))
})

test('stripForExport — 권한이 있어도 대외용 파일에는 원가가 없다', () => {
  const line = { name: 'H100', unitPriceMinor: 37_965n, costMinor: 31_131n }
  const exported = stripForExport(line, 'quoteLine')
  assert.ok(!('costMinor' in exported), '고객에게 가는 파일에 원가가 있으면 안 된다')
  assert.equal(exported.unitPriceMinor, 37_965n)
  // 관리자 권한과 무관하다 — 인자 자체를 받지 않는다
  assert.equal(Object.keys(exported).length, 2)
})

test('내부 전용 필드도 내보내기에서는 빠진다', () => {
  const deal = { bookedNetMinor: 1n, inKindTotalMinor: 2n }
  assert.deepEqual(stripForExport(deal, 'deal'), {})
})

// ── 표 자체의 건강 검사 ─────────────────────────────────────────────

test('정책 표가 세 등급을 모두 덮는다', () => {
  for (const level of ['public', 'internal', 'restricted'] as const) {
    assert.ok(VISIBILITY_POLICY[level].length > 0, level)
  }
  // restricted 는 지금 관리자뿐이어야 한다(답 6)
  assert.deepEqual([...VISIBILITY_POLICY.restricted].sort(), ['ADMIN', 'OWNER'])
})

test('모든 역할이 능력 표에 있다', () => {
  for (const role of new Set(Object.values(VISIBILITY_POLICY).flat())) {
    assert.ok(role in ROLE_CAPABILITIES, `${role} 이 ROLE_CAPABILITIES 에 없다`)
  }
})

test('능력 이름이 표와 목록에서 어긋나지 않는다', () => {
  for (const caps of Object.values(ROLE_CAPABILITIES)) {
    for (const c of caps) assert.ok(ALL_CAPABILITIES.includes(c), c)
  }
})

test('등급 값이 셋 중 하나가 아닌 필드가 없다', () => {
  for (const [k, v] of Object.entries(FIELD_SENSITIVITY)) {
    assert.ok(['public', 'internal', 'restricted'].includes(v), `${k}=${v}`)
    assert.match(k, /^[a-zA-Z]+\.[a-zA-Z]/, `${k} 는 «표.필드» 꼴이어야 한다`)
  }
})
