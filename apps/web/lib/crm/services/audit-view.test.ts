// 기록 보기 (dacrm)
//
// **왜 이 가드가 있는가**: 감사 기록 1,364건이 쌓이는 동안 볼 화면이 없었다.
// 화면을 붙인 뒤 실브라우저에서 세 가지가 개발자 말로 나왔다.
//   ① `record.trashed` — 실제 쓰이는 action 과 내 매핑이 어긋났다
//   ② `stageId st_gpu_1 → st_gpu_2` — id 는 우리 사정이지 사용자의 사정이 아니다
//   ③ 삭제 기록이 id·version·companyId 까지 늘어놓았다
//
// 셋 다 "기록은 있는데 읽을 수 없다"는 같은 결함이다. 그래서 여기서 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACTION_LABEL, ACTOR_LABEL, TARGET_LABEL, FIELD_LABEL } from './audit-view.ts'

/** 실제 DB 에 쌓여 있는 action 들 — 여기 있는 건 전부 사람 말이 있어야 한다 */
const ACTIONS_IN_USE = [
  'deal.created', 'company.created', 'person.created', 'activity.created',
  'task.created', 'deal.won', 'deal.lost', 'record.trashed',
  'suggestion.auto_applied', 'record.purged', 'meeting.deleted', 'deal.stage_moved',
  'meeting.created', 'meeting.transcribed', 'suggestion.accepted', 'stage.criteria_changed',
  'record.merge_undone', 'record.merged', 'task.completed', 'budget.limit_changed',
  'field.unverified', 'ai.field_config_changed', 'company.restored',
  'task.created_from_suggestion', 'field.verified', 'deal.restored', 'deal.updated',
  'person.created_from_suggestion',
]

test('★ 실제로 쌓이는 action 이 전부 사람 말로 번역된다 — 하나라도 빠지면 그 줄만 개발자 말이 된다', () => {
  const missing = ACTIONS_IN_USE.filter((a) => !ACTION_LABEL[a])
  assert.deepEqual(missing, [], `번역 없는 action: ${missing.join(', ')}`)
})

test('번역된 문장에 점(.)으로 이어붙인 코드가 남아 있지 않다', () => {
  for (const [action, label] of Object.entries(ACTION_LABEL)) {
    assert.ok(!label.includes('.'), `${action} 의 문장이 코드처럼 보인다: ${label}`)
    assert.ok(label.length > 2, `${action} 문장이 너무 짧다`)
  }
})

test('행위자·대상·필드 이름도 사람 말이다', () => {
  assert.equal(ACTOR_LABEL.AI, 'AI')
  assert.equal(ACTOR_LABEL.HUMAN, '사람')
  assert.equal(TARGET_LABEL.deal, '딜')
  assert.equal(FIELD_LABEL.stageId, '단계')
  assert.equal(FIELD_LABEL.amountMinor, '금액')
})

/** 소스에서 규칙이 살아 있는지 — 로직은 서비스 안에 있어 DB 없이는 못 부른다 */
const SRC = readFileSync(new URL('./audit-view.ts', import.meta.url), 'utf8')

test('★ 단계 id 를 이름으로 바꾼다 — "st_gpu_1 → st_gpu_2"는 아무 뜻이 없다', () => {
  assert.ok(SRC.includes('crmStage.findMany'), '단계 이름을 조회하지 않는다')
  assert.ok(SRC.includes("k === 'stageId'"), '단계 필드를 이름으로 바꾸지 않는다')
})

test('★ 단계 이름을 한 번에 모아 조회한다 — 행마다 부르면 50번 왕복한다', () => {
  assert.ok(SRC.includes('id: { in: Array.from(stageIds) }'), '단계 조회가 묶여 있지 않다')
  assert.ok(SRC.includes('id: { in: memberIds }'), '멤버 조회가 묶여 있지 않다')
})

test('★ id·버전 같은 내부 필드는 기록에서 뺀다 — 진짜 변경이 묻힌다', () => {
  assert.ok(SRC.includes('const NOISE = new Set('), '노이즈 필드를 거르지 않는다')
  for (const k of ['id', 'version', 'workspaceId']) {
    assert.ok(SRC.includes(`'${k}'`), `${k} 를 노이즈로 보지 않는다`)
  }
})

test('★ 지운 기록은 무엇이었는지만 남긴다 — 필드를 다 늘어놓으면 안 읽힌다', () => {
  assert.ok(SRC.includes('NAME_ONLY'), '삭제 기록을 따로 접지 않는다')
  assert.ok(SRC.includes("'record.trashed'"), '휴지통 기록을 접지 않는다')
})

test('★ 진입 조건 JSON 을 사람 말로 바꾼다 — 배열 원문은 못 읽는다', () => {
  assert.ok(SRC.includes('function criteriaText('), '조건 번역기가 없다')
  assert.ok(SRC.includes("k === 'criteria'"), '조건 필드에 번역을 안 건다')
})

test('모르는 action 은 숨기지 않고 그대로 보여 준다 — "기록 없음"과 "이름 안 붙임"은 다르다', () => {
  assert.ok(SRC.includes('ACTION_LABEL[r.action] ?? r.action'), '모르는 action 을 숨긴다')
})

test('★ 기록 화면이 실제로 이 서비스를 쓴다 — 화면이 따로 조회하면 두 답이 갈린다', () => {
  const api = readFileSync(new URL('../../../app/api/crm/audit/route.ts', import.meta.url), 'utf8')
  assert.ok(api.includes('listAudit('), 'API 가 서비스를 부르지 않는다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/audit/AuditClient.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('/api/crm/audit'), '화면이 기록 API 를 부르지 않는다')
})

test('★ 인박스 뱃지는 만료된 것을 세지 않는다 — 뱃지와 목록이 어긋나면 아무도 뱃지를 안 믿는다', () => {
  const src = readFileSync(new URL('./suggestion.ts', import.meta.url), 'utf8')
  const at = src.indexOf('export async function countPendingSuggestions')
  assert.ok(at > 0, '뱃지용 카운트 함수가 없다')
  const body = src.slice(at)
  assert.ok(body.includes("status: 'PENDING'"), '대기 중인 것만 세지 않는다')
  assert.ok(body.includes('expiresAt: { gt: new Date() }'), '만료된 것을 걸러내지 않는다')
})

test('★ 메뉴가 실제로 그 수를 단다 — 세기만 하면 화면은 그대로다', () => {
  const layout = readFileSync(new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
  assert.ok(layout.includes('countPendingSuggestions('), '레이아웃이 세지 않는다')
  assert.ok(layout.includes('badge: pendingInbox'), '메뉴에 뱃지를 달지 않는다')
})
