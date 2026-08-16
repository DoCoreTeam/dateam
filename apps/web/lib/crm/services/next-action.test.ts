// 다음에 할 일 (활동 규율)
//
// **왜 이 가드가 있는가**: 이게 CRM 의 심장인데 우리에게 없었다.
//
// Pipedrive 원칙: "모든 열린 딜에는 다음 활동이 계획되어 있어야 한다."
// 그래서 그쪽 보드에는 계획 없는 딜에 **노란 삼각형**이 뜨고, 활동을 완료하면
// **즉시 다음 활동 입력창**이 열린다. 우리 보드는 단계만 보여 주는 정적인 목록이었다.
//
// 실측(브라우저): 카드에 "다음에 뭘 할지 정해 주세요" → 기한 지난 할 일 넣으니
// "5일 지났어요" → 마지막 할 일 완료하니 "이게 마지막이었어요" + 커서가 입력칸으로.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickNext, STATE_LABEL, type NextActionState } from './next-action.ts'

const SRC = readFileSync(new URL('./next-action.ts', import.meta.url), 'utf8')
const BOARD = readFileSync(
  new URL('../../../app/(crm)/crm/deals/DealBoard.tsx', import.meta.url), 'utf8')
const PANEL = readFileSync(
  new URL('../../../components/ui/crm/TaskPanel.tsx', import.meta.url), 'utf8')

const TODAY = '2026-08-17'
const t = (id: string, title: string, dueAt: string | null, created = '2026-08-01T00:00:00Z') =>
  ({ id, title, dueAt, createdAt: created })

test('★ 할 일이 없으면 "정해 주세요"라고 말한다 — 이게 노란 삼각형 자리다', () => {
  const n = pickNext('d1', [], TODAY)
  assert.equal(n.state, 'none')
  // "없음"만 쓰면 정보일 뿐이다. 무엇을 하라는 말까지 해야 사람이 움직인다
  assert.match(n.hint, /정해 주세요/)
})

test('★ 기한이 지났으면 며칠 지났는지 말한다 (실측: "5일 지났어요")', () => {
  const n = pickNext('d1', [t('t1', '확인 전화', '2026-08-12T00:00:00+09:00')], TODAY)
  assert.equal(n.state, 'overdue')
  assert.equal(n.hint, '5일 지났어요')
  assert.equal(n.title, '확인 전화')
})

test('오늘까지·내일까지를 구분한다 — "곧"이라고만 하면 오늘인지 모른다', () => {
  assert.equal(pickNext('d', [t('a', 'x', '2026-08-17T00:00:00+09:00')], TODAY).hint, '오늘까지')
  assert.equal(pickNext('d', [t('a', 'x', '2026-08-18T00:00:00+09:00')], TODAY).hint, '내일까지')
  assert.equal(pickNext('d', [t('a', 'x', '2026-08-20T00:00:00+09:00')], TODAY).hint, '3일 뒤')
})

test('먼 기한은 날짜를 그대로 — "45일 뒤"는 언제인지 감이 안 온다', () => {
  const n = pickNext('d', [t('a', 'x', '2026-10-01T00:00:00+09:00')], TODAY)
  assert.equal(n.state, 'planned')
  assert.equal(n.hint, '2026-10-01')
})

test('★ 급한 것이 이긴다 — 기한 지난 것이 내일까지인 것보다 먼저다', () => {
  const n = pickNext('d', [
    t('a', '내일 것', '2026-08-18T00:00:00+09:00'),
    t('b', '지난 것', '2026-08-12T00:00:00+09:00'),
  ], TODAY)
  assert.equal(n.title, '지난 것')
})

test('★ 기한 있는 것이 없는 것보다 먼저다 — 기한 없는 열 개보다 내일 하나가 급하다', () => {
  const n = pickNext('d', [
    t('a', '기한 없음', null),
    t('b', '내일', '2026-08-18T00:00:00+09:00'),
  ], TODAY)
  assert.equal(n.title, '내일')
  assert.equal(n.state, 'planned')
})

test('기한이 같으면 먼저 만든 것 — 순서가 매번 달라지면 사람이 못 믿는다', () => {
  const same = '2026-08-20T00:00:00+09:00'
  const n = pickNext('d', [
    t('a', '나중 등록', same, '2026-08-05T00:00:00Z'),
    t('b', '먼저 등록', same, '2026-08-01T00:00:00Z'),
  ], TODAY)
  assert.equal(n.title, '먼저 등록')
})

test('기한 없는 할 일만 있으면 그렇다고 말한다 — 없는 기한을 지어내지 않는다', () => {
  const n = pickNext('d', [t('a', '언젠가', null)], TODAY)
  assert.equal(n.state, 'undated')
  assert.equal(n.dueDate, null)
})

test('다섯 상태에 사람이 읽는 이름이 있다', () => {
  const states: NextActionState[] = ['overdue', 'today', 'planned', 'undated', 'none']
  for (const s of states) assert.ok(STATE_LABEL[s]?.length > 0, `${s} 이름이 없다`)
})

test('★ 끝난 할 일은 세지 않는다 — 끝낸 걸 계속 보여 주면 딜이 멈춘 줄 모른다', () => {
  assert.ok(SRC.includes("status: { in: ['TODO', 'DOING'] }"), '끝난 할 일도 본다')
})

test('★ 딜마다 따로 조회하지 않는다 — 보드에 100개면 조회가 100번이 된다', () => {
  assert.ok(SRC.includes('dealId: { in: dealIds }'), '한 번에 안 읽는다')
  assert.ok(!/for \(const id of dealIds\)[\s\S]{0,200}await/.test(SRC), '반복문 안에서 조회한다')
})

test('★ 새 테이블·새 컬럼을 만들지 않는다 — 만들면 할 일 목록과 딜의 다음 할 일이 어긋난다', () => {
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')
  assert.ok(!/nextActionAt|nextTaskId/.test(schema), '딜에 다음 활동 컬럼이 생겼다')
  assert.ok(!/\.create\(|\.update\(/.test(SRC), '무언가를 쓰고 있다 — 여기는 읽기만 한다')
})

test('★ 보드 카드가 실제로 다음 할 일을 그린다 — 안 그리면 정적인 목록 그대로다', () => {
  assert.ok(BOARD.includes('nextAction'), '카드가 다음 할 일을 모른다')
  assert.ok(BOARD.includes('다음에 뭘 할지 정해 주세요'), '계획 없는 딜을 경고하지 않는다')
  assert.ok(BOARD.includes('AlertTriangle'), '경고 표시가 없다')
})

test('★ 목록 API 가 다음 할 일을 함께 준다 — 화면이 따로 물으면 100번 왕복한다', () => {
  const route = readFileSync(
    new URL('../../../app/api/crm/deals/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('nextActions('), 'API 가 다음 할 일을 안 붙인다')
})

test('★ 마지막 할 일을 끝내면 다음을 묻는다 (실측: "이게 마지막이었어요" + 커서 이동)', () => {
  assert.ok(PANEL.includes('setAskNext(true)'), '마지막을 끝내도 안 묻는다')
  assert.ok(PANEL.includes('이게 마지막이었어요'), '왜 커서가 옮겨졌는지 말하지 않는다')
  assert.ok(PANEL.includes('nextRef.current?.focus()'), '커서를 안 옮긴다')
})

test('★ 모달로 막지 않는다 — 성가시면 사람은 그 기능을 피한다', () => {
  assert.ok(!/window\.(alert|confirm|prompt)/.test(PANEL), '완료를 모달로 가로막는다')
})

test('할 일을 하나 넣으면 안내가 사라진다 — 정하고 나면 더 볼 필요 없다', () => {
  assert.ok(PANEL.includes('setAskNext(false)'), '안내가 계속 남는다')
})

test('★ 딜이 없는 곳(회사·인물 패널)에서는 안 묻는다 — 딜이 멈추는 것이 문제이지 할 일 자체가 아니다', () => {
  assert.ok(PANEL.includes('!!scope.dealId'), '딜 여부를 안 본다')
})

test('규율 지표를 셀 수 있다 — 계획 없는 딜 수가 곧 "얼마나 멈춰 있나"다', () => {
  assert.ok(SRC.includes('export async function countUnplanned'), '지표 계산이 없다')
  assert.ok(SRC.includes("distinct: ['dealId']"), '딜을 중복으로 센다')
})
