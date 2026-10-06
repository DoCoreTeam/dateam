// lib/crm/services/cost-copy-paths.test.ts — **원가가 지나는 길이 칸을 떨어뜨리지 않는지** 보는 가드
//
// ## 왜 목록이 아니라 스키마를 세나
//
// 이 저장소는 「칼럼을 더했고 화면도 붙였는데 베끼는 코드만 몰랐다」를 **세 판 연속** 겪었다
// (비고·환율 → 표시 선택·공급 기간 → 비율 줄). 사람이 손으로 적은 목록은 다음 칼럼을 모르고,
// 모르는 채로 초록이다.
//
// 견적 복제는 이미 스키마를 세고 있었고(`quote-duplicate.test.ts`), 그 가드는 2026-10-06 에
// 기간 두 칸을 더하자마자 **스스로 빨개져** 자기가 살아 있음을 증명했다.
// 원가가 지나는 길에는 그런 가드가 없었다 — 여기서 만든다.
//
// ## 무엇을 보나
//
//   ① **조회** `cost.ts` 의 SELECT 가 crm_deal_cost 의 모든 값 칸을 읽는가
//   ② **옮기기** 원가 → 견적(`cost-to-quote.ts`)이 견적 줄에 들어갈 칸을 들고 가는가
//
// 둘 중 하나만 비어도 사람은 적은 값이 사라진 것을 **나중에** 안다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const SCHEMA = read('prisma/schema.prisma')
const COST = read('lib/crm/services/cost.ts')
const TO_QUOTE = read('lib/crm/domain/cost-to-quote.ts')

/** 모델의 **값 칸**만 — 관계는 FK 로 따로 선다 */
function scalarFields(model: string): string[] {
  const i = SCHEMA.indexOf(`model ${model} {`)
  assert.ok(i > 0, `${model} 을 스키마에서 못 찾았다`)
  const j = SCHEMA.indexOf('\n}', i)
  return SCHEMA.slice(i, j).split('\n').slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/))
    .filter((p) => p.length >= 2 && /^(String|Int|BigInt|Boolean|DateTime|Decimal|Float|Json)(\[\])?\??$/.test(p[1]))
    .map((p) => p[0])
}

/*
  **조회가 안 읽는 칸**과 그 사유. 사유 없이 비워 두면 다음 사람이 「왜 안 오지」를
  코드에서 찾아야 한다.
*/
const NOT_SELECTED: Readonly<Record<string, string>> = {
  workspaceId: '조회 자체가 워크스페이스 안에서만 돈다 — 값을 또 실어 보낼 이유가 없다',
  createdById: '만든 사람은 감사 기록에서 본다. 원가 목록이 쓰지 않는다',
  deletedAt: '지워진 줄은 조회에 안 들어온다 — 값을 봐야 할 자리가 없다',
}

test('★ 원가 조회가 표의 모든 값 칸을 읽는다 — 안 읽으면 저장돼도 화면에 안 닿는다', () => {
  const select = COST.slice(COST.indexOf('const SELECT = {'), COST.indexOf('} as const', COST.indexOf('const SELECT = {')))
  const 빠진것 = scalarFields('CrmDealCost')
    .filter((f) => !(f in NOT_SELECTED))
    .filter((f) => !new RegExp(`\\b${f}:\\s*true`).test(select))
  assert.deepEqual(빠진것, [],
    `원가 조회가 이 칸들을 안 읽는다: ${빠진것.join(', ')}. `
    + 'SELECT 에 넣거나, 안 읽는 이유를 이 파일의 NOT_SELECTED 에 적어라')
})

test('★ 안 읽는 칸 목록에 사유 없는 줄이 없다', () => {
  for (const [field, why] of Object.entries(NOT_SELECTED)) {
    assert.ok(why.trim().length > 10, `${field} 의 사유가 비었다 — 사유 없는 예외는 예외가 아니다`)
  }
})

/*
  **원가에서 견적으로 옮길 때 들고 가야 하는 칸.**

  「금액 한 칸만 옮기면 «몇 대에 얼마였나»가 사라지고 사람이 문서를 다시 열어 적게 된다」가
  이 길이 있는 이유다(cost-to-quote 머리말). 그 이유에 걸리는 칸을 센다.
*/
const CARRIED_TO_QUOTE: Array<[field: string, from: string, why: string]> = [
  ['name', 'row.name', '무엇을 파는 줄인가'],
  ['kind', 'kindOf(row.kind)', '「수량 × 단가」가 뜻하는 것 — 라벨이 실제와 달라지면 사람이 잘못 넣는다'],
  ['unit', "row.unit ?? ''", '수량 옆 단위'],
  ['durationValue', "row.durationValue ?? ''", '기간이 떨어지면 매출과 원가의 기간이 갈려 마진이 거꾸로 선다'],
  ['durationUnit', "row.durationUnit ?? ''", '값과 한 벌이다 — 하나만 가면 2 가 2개월인지 2시간인지 모른다'],
  ['remark', "row.remark ?? ''", '견적서 표 맨 오른쪽 열에 인쇄된다'],
  ['descriptionMd', "row.descriptionMd ?? ''", '규격과 구성이 한 칸에 들어 있다'],
]

test('★ 원가를 견적으로 옮길 때 칸이 **값째로** 간다 — 선언만 남는 판을 잡는다', () => {
  const body = TO_QUOTE.slice(TO_QUOTE.indexOf('export function costToQuoteLines'))
  for (const [field, from, why] of CARRIED_TO_QUOTE) {
    const 실림 = new RegExp(`${field}:\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(body)
    assert.ok(실림, `원가→견적이 ${field} 를 안 들고 간다(${from}). ${why}`)
  }
})

test('★ 단가는 기간을 안 곱한 채로 간다 — 곱해 두면 견적에서 또 곱해진다', () => {
  const body = TO_QUOTE.slice(TO_QUOTE.indexOf('export function costToQuoteLines'))
  assert.ok(!/unitPriceMinor:[^,\n]*duration/i.test(body),
    '단가에 기간을 곱해 넣었다 — 견적 줄이 다시 곱하므로 금액이 기간의 제곱이 된다')
})
