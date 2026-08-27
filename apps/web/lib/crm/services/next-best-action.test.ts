// 다음 최선 행동 (dacrm FR-05 딜 인텔리전스)
//
// **왜 이 가드가 특히 중요한가**: AI 제안이 죽는 방식은 늘 같다 —
// "고객사에 연락해 보세요" 같은 **어느 딜에나 맞고 그래서 아무 딜에도 안 맞는 말**이
// 목록에 쌓이고, 그 순간 사람은 목록 전체를 안 믿게 된다.
//
// 그래서 지키는 것은 셋이다.
//   ① 지어낸 딜 id 는 버린다 — 붙일 곳 없는 제안은 눌러도 아무 일이 안 일어난다
//   ② 근거 없는 제안은 버린다 — 왜 지금인지 못 대면 그건 조언이 아니다
//   ③ **자동으로 만들지 않는다** — 사람이 눌러서 받아들이는 것까지가 사람 몫이다
//
// 실측(브라우저): 25일 멈춘 딜을 만드니 AI 가 "konst tech 담당자에게 유선으로 첫 미팅을 요청한다"
// + 근거 "마지막 활동 기록이 없고…"를 냈고, [할 일로]를 누르니 딜 카드가 "내일까지"로 바뀌었다.
// 그리고 **두 번째 물음에서는 그 딜이 빠졌다**(이미 정해 둔 사람에게 또 제안하지 않는다).

import { test } from 'node:test'
import { CRM_NAV_GROUPS } from '../nav/groups.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseNextBestActions, buildDealBriefs, MAX_DEALS_PER_RUN,
  NEXT_BEST_ACTION_VERSION, nextBestActionPrompt, type DealBrief,
} from '../ai/prompts/next-best-action.v1.ts'
import { STALE_DAYS } from './next-best-action.ts'

const SRC = readFileSync(new URL('./next-best-action.ts', import.meta.url), 'utf8')
const PROMPT = readFileSync(
  new URL('../ai/prompts/next-best-action.v1.ts', import.meta.url), 'utf8')
const UI = readFileSync(
  new URL('../../../app/(crm)/crm/today/TodayClient.tsx', import.meta.url), 'utf8')

const deal = (over: Partial<DealBrief> = {}): DealBrief => ({
  dealId: 'd1', name: '삼성SDS 협력', companyName: '삼성SDS',
  stageName: '제안', daysInStage: 28, amountText: '300000000 KRW',
  lastActivity: null, lastMeetingSummary: null, openTasks: [],
  ...over,
})

test('★ 지어낸 딜 id 는 버린다 — 붙일 곳 없는 제안은 눌러도 아무 일이 안 일어난다', () => {
  const out = parseNextBestActions(
    JSON.stringify({ suggestions: [
      { dealId: '없는딜', action: '전화', because: '28일째', dueInDays: 2 },
      { dealId: 'd1', action: '견적 확인 전화', because: '28일째 제안', dueInDays: 2 },
    ] }),
    ['d1'],
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].dealId, 'd1')
})

test('★ 근거 없는 제안은 버린다 — 왜 지금인지 못 대면 조언이 아니라 소음이다', () => {
  const out = parseNextBestActions(
    JSON.stringify({ suggestions: [
      { dealId: 'd1', action: '연락해 보세요', because: '', dueInDays: 3 },
      { dealId: 'd2', action: '', because: '28일째', dueInDays: 3 },
    ] }),
    ['d1', 'd2'],
  )
  assert.deepEqual(out, [])
})

test('한 딜에 하나만 — 여러 개면 사람이 무엇부터 할지 또 골라야 한다', () => {
  const out = parseNextBestActions(
    JSON.stringify({ suggestions: [
      { dealId: 'd1', action: '첫째', because: 'x', dueInDays: 1 },
      { dealId: 'd1', action: '둘째', because: 'y', dueInDays: 2 },
    ] }),
    ['d1'],
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].action, '첫째')
})

test('기한은 1~14일로 접는다 — 0일이나 1년 뒤는 실수다', () => {
  const out = parseNextBestActions(
    JSON.stringify({ suggestions: [
      { dealId: 'a', action: 'x', because: 'y', dueInDays: 0 },
      { dealId: 'b', action: 'x', because: 'y', dueInDays: 999 },
      { dealId: 'c', action: 'x', because: 'y', dueInDays: '이상한값' },
    ] }),
    ['a', 'b', 'c'],
  )
  assert.equal(out.find((s) => s.dealId === 'a')?.dueInDays, 1)
  assert.equal(out.find((s) => s.dealId === 'b')?.dueInDays, 14)
  assert.equal(out.find((s) => s.dealId === 'c')?.dueInDays, 3, '기본값이 아니다')
})

test('코드펜스로 감싸 와도 읽는다 — 모델이 자주 그런다', () => {
  const out = parseNextBestActions(
    '```json\n{"suggestions":[{"dealId":"d1","action":"전화","because":"28일째","dueInDays":2}]}\n```',
    ['d1'],
  )
  assert.equal(out.length, 1)
})

test('빈 제안도 정답이다 — 억지로 만들면 사람이 이 기능 전체를 무시한다', () => {
  assert.deepEqual(parseNextBestActions(JSON.stringify({ suggestions: [] }), ['d1']), [])
})

test('깨진 응답은 던진다 — 러너가 한 번 더 묻는다', () => {
  assert.throws(() => parseNextBestActions('말이 안 되는 텍스트', ['d1']), /읽지 못했습니다/)
  assert.throws(() => parseNextBestActions(JSON.stringify({ x: 1 }), ['d1']), /제안 목록이 없습니다/)
})

test('★ 프롬프트가 "아는 사실로만"을 못 박는다 — 추측이 CRM 에 들어가면 사람이 사실로 읽는다', () => {
  assert.match(PROMPT, /아는 사실로만 말한다/)
  assert.match(PROMPT, /추측해서 쓰지 마세요/)
})

test('★ 프롬프트가 뭉뚱그린 조언을 금지한다 — 어느 딜에나 맞는 말은 아무 딜에도 안 맞는다', () => {
  assert.match(PROMPT, /관계를 강화한다/, '나쁜 예를 안 보여 준다')
  assert.match(PROMPT, /오늘 할 수 있는 크기/)
})

test('★ 프롬프트가 "제안할 게 없으면 빼라"고 말한다 — 억지 제안이 기능을 죽인다', () => {
  assert.match(PROMPT, /빈 배열도 정답입니다/)
})

test('이미 잡힌 할 일을 프롬프트에 실어 중복을 막는다', () => {
  const s = buildDealBriefs([deal({ openTasks: ['견적 보내기'] })])
  assert.match(s, /이미 잡힌 할 일: 견적 보내기/)
  assert.match(PROMPT, /이미 잡힌 할 일과 같은 것은 제안하지 마세요/)
})

test('브리핑에 아는 사실만 담는다 — 없는 것은 "기록 없음"이라고 쓴다', () => {
  const s = buildDealBriefs([deal({ lastActivity: null, amountText: null })])
  assert.match(s, /마지막 활동: 기록 없음/)
  assert.ok(!s.includes('금액:'), '없는 금액을 지어낸다')
})

test('한 번에 다루는 딜에 상한이 있다 — 많이 넣으면 모델이 뭉뚱그린다', () => {
  const many = Array.from({ length: 30 }, (_, i) => deal({ dealId: `d${i}` }))
  const s = buildDealBriefs(many)
  assert.equal(s.split('\n\n').length, MAX_DEALS_PER_RUN)
})

test('★ 이미 다음을 정해 둔 딜은 안 묻는다 (실측: 두 번째 물음에서 빠졌다)', () => {
  assert.ok(SRC.includes('if (openTasks.length > 0) continue'), '정해 둔 딜에도 제안한다')
})

test('★ 멈춘 딜만 본다 — 어제 미팅한 딜에 "연락해 보세요"는 방해다', () => {
  assert.ok(STALE_DAYS >= 7, `기준이 너무 짧다: ${STALE_DAYS}`)
  assert.ok(SRC.includes('updatedAt: { lt: cutoff }'), '오래된 것만 고르지 않는다')
})

test('★ AI 가 실패해도 화면은 산다 — 오늘 화면이 통째로 안 뜨면 그게 더 큰 사고다', () => {
  assert.ok(SRC.includes('catch'), '실패를 안 잡는다')
  assert.ok(SRC.includes('지금은 제안을 못 드려요'), '실패를 사람 말로 안 알린다')
  assert.ok(!/throw /.test(SRC.split('export async function suggestNextBestActions')[1] ?? ''),
    '제안 함수가 던진다')
})

test('예산에 걸리면 그렇다고 말한다 — 사람이 고칠 수 있는 일이다', () => {
  assert.ok(SRC.includes('AI 예산 한도에 걸렸어요'), '예산 차단을 일반 오류로 뭉갠다')
  assert.ok(SRC.includes('estimateMinorUsd'), '예상 비용을 안 잡는다 — 상한 0 을 뚫는다')
})

test('★ 왜 제안이 없는지 말한다 — 빈 화면에 이유가 없으면 사람은 고장으로 읽는다', () => {
  assert.ok(SRC.includes('넘게 멈춘 딜이 없어요'), '볼 게 없을 때 이유를 안 말한다')
  assert.ok(SRC.includes('딱히 제안할 게 없었어요'), '봤는데 없을 때 이유를 안 말한다')
})

test('★ 자동으로 할 일을 만들지 않는다 — 쌓이면 사람이 목록 전체를 안 믿는다', () => {
  // 서비스는 읽기만 한다. 만드는 것은 화면에서 사람이 누를 때
  assert.ok(!/crmTask\.create/.test(SRC), '서비스가 할 일을 만든다')
  assert.ok(UI.includes('async function accept'), '받아들이는 동작이 없다')
  assert.ok(UI.includes('저절로 만들어지지 않습니다'), '자동이 아님을 화면이 안 말한다')
})

test('★ 근거를 화면이 보여 준다 — 근거 없이 뜬 제안은 조언이 아니다', () => {
  assert.ok(UI.includes('{s.because}'), '근거를 화면이 숨긴다')
})

test('★ 화면을 열 때마다 모델을 부르지 않는다 — 사람이 안 볼 때도 돈이 든다', () => {
  assert.ok(UI.includes("fetch('/api/crm/today?ai=1')"), 'AI 를 따로 안 부른다')
  assert.ok(!UI.includes("void askAi()\n  }, [])"), '자동으로 부른다')
  const route = readFileSync(
    new URL('../../../app/api/crm/today/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes("searchParams.get('ai') === '1'"), '기본 조회에 AI 가 섞인다')
})

test('★ 모델 선택을 두 벌로 만들지 않는다 — 한쪽만 고치면 같은 워크스페이스가 두 모델을 쓴다', () => {
  assert.ok(SRC.includes('adapterFromSetting'), '자체 어댑터 결정을 쓴다')
})

test('★ 새 AI 종류를 만들지 않는다 — enum 을 늘리면 마이그레이션이 필요해진다', () => {
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8')
  assert.ok(!/NEXT_BEST_ACTION/.test(schema), 'enum 에 새 값이 생겼다')
  assert.ok(SRC.includes("kind: 'ASSISTANT'"), '기존 종류를 안 쓴다')
})

test('프롬프트에 버전이 붙어 있다 — 어느 판이 낸 제안인지 못 대면 되돌릴 수 없다', () => {
  assert.match(NEXT_BEST_ACTION_VERSION, /^next_best_action@v\d+\.\d+\.\d+$/)
  assert.equal(nextBestActionPrompt.version, NEXT_BEST_ACTION_VERSION)
})

test('★ 오늘 화면이 첫 화면이다 — 인박스는 처음 온 사람에겐 구조적으로 비어 있다', () => {
  const index = readFileSync(
    new URL('../../../app/(crm)/crm/page.tsx', import.meta.url), 'utf8')
  assert.ok(index.includes("redirect('/crm/today')"), '첫 화면이 오늘이 아니다')
  // v0.7.625: 인박스는 **「오늘」 묶음 안의 탭**이 됐다. 따로 세우면 안 열어 보고 제안이 만료된다.
  // 그러니 '오늘이 인박스보다 앞인가'가 아니라 '인박스가 오늘 묶음에 들어 있는가'를 본다.
  const today = CRM_NAV_GROUPS[0]
  assert.equal(today.href, '/crm/today', '첫 묶음이 오늘이 아니다')
  assert.ok(today.tabs.some((t) => t.href === '/crm/inbox'), '인박스가 오늘 묶음 밖에 있다')
})

test('★ 규율 지표를 첫 화면에 띄운다 — 안 띄우면 딜은 계속 조용히 멈춰 있다', () => {
  assert.ok(UI.includes('unplanned'), '계획 없는 딜 수를 안 보여 준다')
  assert.ok(UI.includes('다음에 뭘 할지 안 정한 딜이'), '사람 말로 안 쓴다')
})
