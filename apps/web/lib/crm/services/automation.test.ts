// 자동화 (dacrm FR-08)
//
// **왜 이 가드가 있는가**: 자동화는 사람이 안 보는 사이에 데이터를 만든다.
// 그래서 두 가지가 동시에 참이어야 한다 —
// ① 걸려야 할 때 확실히 걸리고 ② **걸리지 말아야 할 때 절대 안 걸린다.**
// 후자가 더 중요하다: 오발화한 자동화는 할 일 목록을 쓰레기로 만들고,
// 그 순간부터 사람은 진짜 할 일도 안 본다.
//
// 그리고 자동화가 **사용자의 저장을 막으면 안 된다.** 딜 이동이 자동화 실패로 되돌아가면
// 사람은 "왜 저장이 안 되지"만 겪고 원인은 영영 모른다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseRules, matches, renderTitle, dueDateOf, runAutomations, validateRules,
  TRIGGER_LABEL, ACTION_LABEL, MAX_RULES, AUTOMATION_SETTING_KEY,
  type AutomationRule, type DealFacts,
} from './automation.ts'

const SRC = readFileSync(new URL('./automation.ts', import.meta.url), 'utf8')

const NOW = new Date('2026-08-17T03:00:00.000Z') // KST 8/17 12:00

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'r1', name: '확인 연락', enabled: true,
    trigger: 'deal.entered_stage', stageId: null, stalledDays: null, minAmountMinor: null,
    action: 'create_task', taskTitle: '{회사} 확인 연락', taskDueInDays: 3,
    ...over,
  }
}

const DEAL: DealFacts = {
  id: 'd1', name: '삼성SDS 신규 협력', companyName: '삼성SDS',
  stageId: 'st_1', amountMinor: 300_000_000n,
}

test('★ 꺼진 규칙은 절대 돌지 않는다 — 기본이 꺼짐인 이유가 여기 있다', () => {
  assert.equal(matches(rule({ enabled: false }), 'deal.entered_stage', DEAL, NOW), false)
})

test('★ 다른 사건에는 안 걸린다 — 성사 규칙이 단계 이동마다 돌면 할 일이 쏟아진다', () => {
  assert.equal(matches(rule({ trigger: 'deal.won' }), 'deal.entered_stage', DEAL, NOW), false)
  assert.equal(matches(rule({ trigger: 'deal.won' }), 'deal.won', DEAL, NOW), true)
})

test('단계를 지정하면 그 단계에서만 — 안 지정하면 모든 단계', () => {
  assert.equal(matches(rule({ stageId: 'st_1' }), 'deal.entered_stage', DEAL, NOW), true)
  assert.equal(matches(rule({ stageId: 'st_9' }), 'deal.entered_stage', DEAL, NOW), false)
  assert.equal(matches(rule({ stageId: null }), 'deal.entered_stage', DEAL, NOW), true)
})

test('★ 금액을 모르는 딜은 문턱에 안 걸린다 — 모르는 것을 "작다"로 치면 안 된다', () => {
  const big = rule({ minAmountMinor: '100000000' })
  assert.equal(matches(big, 'deal.entered_stage', { ...DEAL, amountMinor: null }, NOW), false)
  assert.equal(matches(big, 'deal.entered_stage', DEAL, NOW), true)
  assert.equal(matches(big, 'deal.entered_stage', { ...DEAL, amountMinor: 1n }, NOW), false)
})

test('오래 머문 딜은 날짜를 넘겼을 때만 — 하루 모자라면 안 걸린다', () => {
  const r = rule({ trigger: 'deal.stalled', stalledDays: 7 })
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
  assert.equal(matches(r, 'deal.stalled', { ...DEAL, stageEnteredAt: days(6) }, NOW), false)
  assert.equal(matches(r, 'deal.stalled', { ...DEAL, stageEnteredAt: days(8) }, NOW), true)
  // 들어온 시각을 모르면 며칠인지도 모른다 — 지어내지 않는다
  assert.equal(matches(r, 'deal.stalled', { ...DEAL, stageEnteredAt: null }, NOW), false)
  assert.equal(matches(r, 'deal.stalled', { ...DEAL, stageEnteredAt: '쓰레기' }, NOW), false)
})

test('제목의 자리표시자가 실제 이름으로 바뀐다 — 실측: "삼성SDS 확인 연락"', () => {
  assert.equal(renderTitle('{회사} 확인 연락', DEAL), '삼성SDS 확인 연락')
  assert.equal(renderTitle('{딜} 마무리', DEAL), '삼성SDS 신규 협력 마무리')
  // 회사를 모르면 빈칸으로 두고 나머지는 살린다
  assert.equal(renderTitle('{회사} 연락', { ...DEAL, companyName: null }), '연락')
})

test('기한은 KST 날짜다 — 시각까지 정하면 "오늘까지"가 사람마다 달라진다', () => {
  assert.equal(dueDateOf(rule({ taskDueInDays: 3 }), NOW), '2026-08-20')
  assert.equal(dueDateOf(rule({ taskDueInDays: null }), NOW), null)
})

test('★ 손상된 규칙 하나가 나머지를 죽이지 않는다 — 설정은 사람이 손으로도 고친다', () => {
  const parsed = parseRules([
    { id: 'ok', name: 'a', trigger: 'deal.won', action: 'create_task', taskTitle: 't' },
    null,
    { id: 'no-trigger', name: 'b', action: 'create_task', taskTitle: 't' },
    { id: 'no-title', name: 'c', trigger: 'deal.won', action: 'create_task' },
    { id: 'ok', name: '중복 id', trigger: 'deal.won', action: 'create_task', taskTitle: 't' },
    '문자열',
  ])
  assert.deepEqual(parsed.map((r) => r.id), ['ok'])
})

test('배열이 아니면 규칙 0개 — 예외로 딜 이동을 막지 않는다', () => {
  assert.deepEqual(parseRules(null), [])
  assert.deepEqual(parseRules({ rules: [] }), [])
  assert.deepEqual(parseRules('x'), [])
})

test('말이 안 되는 숫자는 버린다 — 0일 기한·1000일 체류는 실수다', () => {
  const [r] = parseRules([{
    id: 'r', name: 'n', trigger: 'deal.stalled', action: 'create_task', taskTitle: 't',
    taskDueInDays: 0, stalledDays: 9999,
  }])
  assert.equal(r.taskDueInDays, null)
  assert.equal(r.stalledDays, null)
})

test('★ 저장은 조용히 버리지 않는다 — 만든 규칙이 사라지면 "저장했는데 없다"가 된다', () => {
  assert.throws(() => validateRules([{ id: 'x' }]), /빠진 값/)
  assert.throws(() => validateRules('배열아님'), /목록이 아닙니다/)
  assert.throws(
    () => validateRules(Array.from({ length: MAX_RULES + 1 }, (_, i) => ({
      id: `r${i}`, name: 'n', trigger: 'deal.won', action: 'create_task', taskTitle: 't',
    }))),
    new RegExp(`${MAX_RULES}개`),
  )
})

test('★ 켜진 규칙이 실제로 할 일을 만든다 — 판정만 맞고 안 만들면 기능이 없는 것이다', async () => {
  const created: Record<string, unknown>[] = []
  const audits: Record<string, unknown>[] = []
  const tx = {
    crmTask: { create: async (a: { data: Record<string, unknown> }) => { created.push(a.data); return { id: 't1' } } },
    crmAuditLog: { create: async (a: { data: Record<string, unknown> }) => { audits.push(a.data); return {} } },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await runAutomations(tx as any, {
    rules: [rule()], event: 'deal.entered_stage', deal: DEAL, actorId: 'm1', now: NOW,
  })
  assert.equal(out.length, 1)
  assert.equal(created[0].title, '삼성SDS 확인 연락')
  assert.equal(created[0].dealId, 'd1')
  assert.equal(created[0].status, 'TODO')
})

test('★ 자동화가 만든 것은 자동화가 만들었다고 남는다 — "내가 안 만들었는데 왜 있지"에 답한다', async () => {
  const audits: Record<string, unknown>[] = []
  const tx = {
    crmTask: { create: async () => ({ id: 't1' }) },
    crmAuditLog: { create: async (a: { data: Record<string, unknown> }) => { audits.push(a.data); return {} } },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runAutomations(tx as any, {
    rules: [rule()], event: 'deal.entered_stage', deal: DEAL, actorId: null, now: NOW,
  })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].actorType, 'SYSTEM')
  assert.equal(audits[0].action, 'automation.task_created')
})

test('★ 한 규칙이 실패해도 나머지는 돈다 — 그리고 실패는 반드시 기록된다', async () => {
  let n = 0
  const audits: Record<string, unknown>[] = []
  const tx = {
    crmTask: { create: async () => { n++; if (n === 1) throw new Error('디스크 꽉참'); return { id: 't2' } } },
    crmAuditLog: { create: async (a: { data: Record<string, unknown> }) => { audits.push(a.data); return {} } },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await runAutomations(tx as any, {
    rules: [rule({ id: 'a' }), rule({ id: 'b', taskTitle: '두 번째' })],
    event: 'deal.entered_stage', deal: DEAL, actorId: null, now: NOW,
  })
  assert.equal(out.length, 1, '두 번째 규칙이 안 돌았다')
  assert.ok(audits.some((a) => a.action === 'automation.failed'), '실패가 조용히 묻혔다')
})

test('★ 자동화 실패가 사용자 저장을 막지 않는다 — 딜 이동이 되돌아가면 안 된다', async () => {
  const tx = {
    crmTask: { create: async () => { throw new Error('터짐') } },
    crmAuditLog: { create: async () => { throw new Error('기록도 터짐') } },
  }
  // 던지지 않아야 한다 — 던지면 트랜잭션이 통째로 롤백된다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await runAutomations(tx as any, {
    rules: [rule()], event: 'deal.entered_stage', deal: DEAL, actorId: null, now: NOW,
  })
  assert.deepEqual(out, [])
})

test('★ 딜 서비스가 실제로 자동화를 부른다 — 엔진만 있으면 아무 일도 안 일어난다', () => {
  const deal = readFileSync(new URL('./deal.ts', import.meta.url), 'utf8')
  assert.ok(deal.includes("fireAutomations(tx, 'deal.entered_stage'"), '단계 이동에 안 물렸다')
  assert.ok(deal.includes("fireAutomations(tx, 'deal.won'"), '성사에 안 물렸다')
  assert.ok(deal.includes("fireAutomations(tx, 'deal.lost'"), '실패에 안 물렸다')
})

test('★ 화면이 실제로 규칙을 저장한다 — API 만 있으면 아무도 못 만든다', () => {
  const page = readFileSync(new URL('../../../app/(crm)/crm/settings/page.tsx', import.meta.url), 'utf8')
  assert.ok(page.includes('<AutomationCard />'), '설정 화면에 카드가 없다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/settings/AutomationCard.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes("'/api/crm/automations'"), '화면이 API 를 부르지 않는다')
  assert.ok(ui.includes("method: 'PUT'"), '저장하지 않는다')
})

test('★ 규칙 변경은 관리자만 — 화면에서만 숨기면 API 로 새어 나간다', () => {
  const route = readFileSync(new URL('../../../app/api/crm/automations/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes("withCrmApi('ADMIN'"), '아무나 규칙을 바꿀 수 있다')
})

test('★ 새 테이블을 만들지 않는다 — 기존 설정에 담아 마이그레이션 없이 간다', () => {
  assert.equal(AUTOMATION_SETTING_KEY, 'automation.rules')
  assert.ok(SRC.includes('crmAppSetting'), '규칙을 기존 설정 테이블에서 읽지 않는다')
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')
  assert.ok(!/model CrmAutomation/.test(schema), '자동화 전용 테이블이 생겼다 — 마이그레이션 승인이 필요해진다')
})

test('★ 밖으로 나가는 행동은 넣지 않는다 — 자동 발송은 되돌릴 수 없다', () => {
  assert.deepEqual(Object.keys(ACTION_LABEL), ['create_task'])
  assert.ok(!/sendMail|webhook|fetch\(/.test(SRC), '자동화가 외부로 나간다')
})

test('시점·행동에 사람이 읽는 이름이 있다', () => {
  for (const [k, v] of Object.entries(TRIGGER_LABEL)) assert.ok(v.length > 0, `${k} 이름이 없다`)
  for (const [k, v] of Object.entries(ACTION_LABEL)) assert.ok(v.length > 0, `${k} 이름이 없다`)
})

test('★ 기록 화면이 자동화 항목을 사람 말로 옮긴다 — 코드가 그대로 보이면 개발자 말이다', () => {
  const view = readFileSync(new URL('./audit-view.ts', import.meta.url), 'utf8')
  for (const a of ['automation.task_created', 'automation.rules_updated', 'automation.failed']) {
    assert.ok(view.includes(`'${a}':`), `${a} 가 번역되지 않는다`)
  }
})
