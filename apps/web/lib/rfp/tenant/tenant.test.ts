/**
 * 멀티테넌트 가드 (설계서 F12)
 *
 * 여기서 잠그는 것 셋
 * - 역할 3종이 할 수 있는 일이 다른가
 * - 초대가 만료되고 재사용이 막히는가
 * - 요금제 상한을 넘으면 막고 이유를 말하는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { can, capsOf, validateOrg, canDemote, ORG_ROLES, MAX_ORG_NAME } from './org.ts'
import {
  validateInvite, acceptInvite, makeToken, expiryFrom, INVITE_TTL_DAYS, TOKEN_BYTES, type Invite,
} from './invite.ts'
import {
  checkQuota, summarize, currentPeriod, toPlan, usageDelta, USAGE_KINDS,
  type Plan, type UsageRow,
} from './usage.ts'

const 지금 = Date.parse('2026-09-09T00:00:00Z')

const 요금제 = (over: Partial<Plan> = {}): Plan => ({
  id: 'team', name: '팀', monthlyCaseLimit: 50, monthlyAiKrw: 300_000,
  maxMembers: 10, crossVerify: true, assistant: true, ...over,
})

// 역할

test('역할이 셋이다', () => {
  assert.deepEqual([...ORG_ROLES], ['admin', 'member', 'viewer'])
})

test('viewer 는 읽기만 한다', () => {
  // 분석 한 번이 돈이라 아무나 걸면 안 되는데 리포트는 여러 사람이 본다
  assert.equal(can('viewer', 'read'), true)
  assert.equal(can('viewer', 'run_analysis'), false)
  assert.equal(can('viewer', 'create_case'), false)
})

test('member 는 분석까지, admin 은 설정까지', () => {
  assert.equal(can('member', 'run_analysis'), true)
  assert.equal(can('member', 'manage_settings'), false)
  assert.equal(can('admin', 'manage_settings'), true)
  assert.equal(can('admin', 'manage_billing'), true)
})

test('역할이 없으면 아무것도 못 한다', () => {
  assert.equal(can(null, 'read'), false)
})

test('권한 목록이 겹치지 않게 늘어난다', () => {
  assert.ok(capsOf('member').length > capsOf('viewer').length)
  assert.ok(capsOf('admin').length > capsOf('member').length)
})

test('마지막 관리자를 못 내린다', () => {
  const one = [{ userId: 'a', role: 'admin' as const }, { userId: 'b', role: 'member' as const }]
  // 내리면 아무도 설정을 못 만진다
  assert.equal(canDemote(one, 'a'), false)
  assert.equal(canDemote(one, 'b'), true)

  const two = [{ userId: 'a', role: 'admin' as const }, { userId: 'b', role: 'admin' as const }]
  assert.equal(canDemote(two, 'a'), true)
})

// 조직

test('모르는 요금제를 받지 않는다', () => {
  const { problems } = validateOrg({ name: '새 조직', planId: '무제한' }, ['team', 'starter'])
  // 받으면 상한이 없는 조직이 생기고 그 조직의 비용이 아무 데도 안 걸린다
  assert.ok(problems.includes('unknown_plan'))
})

test('이름 없는 조직을 막고 긴 이름을 자른다', () => {
  assert.ok(validateOrg({ name: '  ' }, ['starter']).problems.includes('no_name'))
  const long = validateOrg({ name: '가'.repeat(MAX_ORG_NAME + 10), planId: 'starter' }, ['starter'])
  assert.ok(long.problems.includes('name_too_long'))
  assert.equal(long.org.name?.length, MAX_ORG_NAME)
})

// 초대

const 초대 = (over: Partial<Invite> = {}): Invite => ({
  orgId: 'o1', email: 'a@b.com', role: 'member', token: 't',
  expiresAt: new Date(지금 + 86_400_000).toISOString(), acceptedAt: null, ...over,
})

test('초대에 기한이 붙는다', () => {
  const exp = expiryFrom(지금)
  // 기한이 없는 링크는 1년 뒤에도 남의 조직에 들어가는 문이다
  assert.equal(Date.parse(exp) - 지금, INVITE_TTL_DAYS * 86_400_000)
})

test('만료된 초대를 막는다', () => {
  const r = acceptInvite(초대({ expiresAt: new Date(지금 - 1000).toISOString() }), 지금)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'expired')
})

test('쓴 초대를 다시 못 쓴다', () => {
  const r = acceptInvite(초대({ acceptedAt: '2026-09-01' }), 지금)
  // 한 번 쓴 초대장으로 두 번 들어오면 나간 사람이 다시 들어온다
  assert.equal(r.ok === false && r.reason, 'already_accepted')
})

test('없는 초대는 없다고 한다', () => {
  assert.equal(acceptInvite(null, 지금).ok, false)
})

test('멀쩡한 초대는 받는다', () => {
  const r = acceptInvite(초대(), 지금)
  assert.equal(r.ok, true)
  assert.equal(r.ok === true && r.role, 'member')
})

test('이미 들어온 사람을 다시 초대하지 않는다', () => {
  const { problems } = validateInvite({ email: 'A@B.com', role: 'member' }, {
    members: [{ email: 'a@b.com' }], pending: [],
  })
  assert.ok(problems.includes('already_member'))
})

test('초대장이 둘이 되지 않는다', () => {
  const { problems } = validateInvite({ email: 'a@b.com' }, {
    members: [], pending: [{ email: 'a@b.com', acceptedAt: null }],
  })
  // 초대장이 둘이면 어느 쪽을 눌렀는지에 따라 역할이 달라진다
  assert.ok(problems.includes('already_invited'))
})

test('받은 초대는 다시 보낼 수 있다', () => {
  const { problems } = validateInvite({ email: 'a@b.com' }, {
    members: [], pending: [{ email: 'a@b.com', acceptedAt: '2026-09-01' }],
  })
  assert.equal(problems.includes('already_invited'), false)
})

test('메일 모양과 역할을 검사한다', () => {
  assert.ok(validateInvite({ email: '그냥글자' }, { members: [], pending: [] }).problems.includes('bad_email'))
  assert.ok(validateInvite({ email: 'a@b.com', role: '사장' }, { members: [], pending: [] }).problems.includes('bad_role'))
})

test('토큰이 추측하기 어렵다', async () => {
  const a = await makeToken()
  const b = await makeToken()
  assert.notEqual(a, b)
  assert.ok(a.length >= TOKEN_BYTES)
})

// 사용량과 상한

const 원장 = (over: Partial<UsageRow> = {}): UsageRow => ({
  orgId: 'o1', period: currentPeriod(지금), kind: 'llm', units: 100, costKrw: 50_000, ...over,
})

test('이번 달만 접는다', () => {
  const s = summarize([
    원장({ costKrw: 100_000 }),
    원장({ period: '2026-08', costKrw: 900_000 }),
    원장({ kind: 'image_text', units: 20, costKrw: 240 }),
  ], currentPeriod(지금))
  assert.equal(s.costKrw, 100_240)
  assert.equal(s.byKind.llm.costKrw, 100_000)
  assert.equal(s.byKind.image_text.units, 20)
})

test('사용량 종류가 셋이다', () => {
  assert.deepEqual([...USAGE_KINDS], ['llm', 'image_text', 'commercial_parser'])
  assert.equal(usageDelta('o1', 'llm', 10, 500, 지금).period, currentPeriod(지금))
})

test('달은 KST 기준이다', () => {
  // 서버가 UTC 라도 사용자의 달을 쓴다
  assert.equal(currentPeriod(Date.parse('2026-08-31T20:00:00Z')), '2026-09')
  assert.equal(currentPeriod(Date.parse('2026-09-01T00:00:00Z')), '2026-09')
})

test('AI 비용 한도를 넘으면 막고 이유를 말한다', () => {
  const r = checkQuota({
    plan: 요금제(), usage: summarize([원장({ costKrw: 290_000 })], currentPeriod(지금)),
    caseCount: 1, memberCount: 1, action: 'run_analysis', addKrw: 20_000,
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, 'ai_budget_exceeded')
  // 「분석 실패」로만 두면 사용자는 시스템이 고장 난 줄 안다
  assert.match(r.message, /요금제 상향을 요청/)
  assert.equal(r.limit, 300_000)
})

test('케이스 수 한도를 넘으면 막는다', () => {
  const r = checkQuota({
    plan: 요금제({ monthlyCaseLimit: 10 }), usage: summarize([], currentPeriod(지금)),
    caseCount: 10, memberCount: 1, action: 'create_case',
  })
  assert.equal(r.ok === false && r.reason, 'case_limit_exceeded')
})

test('요금제에 없는 기능을 막는다', () => {
  const r = checkQuota({
    plan: 요금제({ crossVerify: false }), usage: summarize([], currentPeriod(지금)),
    caseCount: 0, memberCount: 1, action: 'run_cross',
  })
  assert.equal(r.ok === false && r.reason, 'feature_not_in_plan')
})

test('구성원 수 한도를 넘으면 막는다', () => {
  const r = checkQuota({
    plan: 요금제({ maxMembers: 3 }), usage: summarize([], currentPeriod(지금)),
    caseCount: 0, memberCount: 3, action: 'add_member',
  })
  assert.equal(r.ok === false && r.reason, 'member_limit_exceeded')
})

test('null 은 무제한이고 0 과 다르다', () => {
  const 무제한 = 요금제({ monthlyAiKrw: null, monthlyCaseLimit: null, maxMembers: null })
  assert.equal(checkQuota({
    plan: 무제한, usage: summarize([원장({ costKrw: 99_000_000 })], currentPeriod(지금)),
    caseCount: 9999, memberCount: 9999, action: 'run_analysis',
  }).ok, true)

  const 영 = 요금제({ monthlyCaseLimit: 0 })
  assert.equal(checkQuota({
    plan: 영, usage: summarize([], currentPeriod(지금)),
    caseCount: 0, memberCount: 1, action: 'create_case',
  }).ok, false)
})

test('한도 안이면 통과한다', () => {
  assert.equal(checkQuota({
    plan: 요금제(), usage: summarize([원장({ costKrw: 10_000 })], currentPeriod(지금)),
    caseCount: 1, memberCount: 1, action: 'run_analysis', addKrw: 500,
  }).ok, true)
})

test('DB 행을 요금제로 옮긴다', () => {
  const p = toPlan({
    id: 'starter', name: '스타터', monthly_case_limit: 10, monthly_ai_krw: 50_000,
    max_members: 3, cross_verify: false, assistant: false,
  })
  assert.equal(p.monthlyCaseLimit, 10)
  assert.equal(p.crossVerify, false)
  assert.equal(toPlan({ id: 'internal', monthly_ai_krw: null }).monthlyAiKrw, null)
})
