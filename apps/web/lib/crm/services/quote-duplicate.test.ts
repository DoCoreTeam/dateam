// lib/crm/services/quote-duplicate.test.ts — 복제가 **인쇄되는 값을 흘리지 않는지** 보는 가드
//
// 실측 2026-10-04: 복제본에서 품목 비고와 견적 환율이 조용히 비어 있었다.
// 둘 다 견적서에 인쇄되는 값이다 — 비고는 표 맨 오른쪽 열(QuoteSheet 의 remark 칸),
// 환율은 합계 위 「원화 환산」 줄. 복제한 사람은 고친 적이 없는데 문서가 달라진다.
//
// **왜 이름이 아니라 값을 보나**: `remark` 라는 글자가 어딘가 있기만 하면 통과하는 가드는
// 선언만 남기고 값을 안 넘기는 판을 못 잡는다(이 저장소가 네 번 겪었다).
// 그래서 `remark: l.remark` 처럼 **어느 값이 가는지**까지 맞춰 본다.
//
// **왜 DB 를 안 띄우나**: 복제는 트랜잭션 안에서 도는 서버 함수라 단위 시험으로 부르려면
// 트랜잭션을 통째로 흉내 내야 하고, 그러면 흉내가 틀렸을 때 가드가 거짓으로 초록이 된다.
// 대신 **그 함수가 실제로 무엇을 넘기는지**를 소스에서 읽는다(quote-from-file-mark.test.ts 와 같은 방식).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SERVICE = readFileSync(new URL('./quote.ts', import.meta.url), 'utf-8')

/** duplicateQuote 본문만 잘라낸다 — 다른 함수의 같은 글자에 속지 않게 */
function duplicateBody(): string {
  const start = SERVICE.indexOf('export async function duplicateQuote')
  assert.ok(start > 0, 'duplicateQuote 를 못 찾았다 — 가드가 엉뚱한 곳을 본다')
  const end = SERVICE.indexOf('export async function approveQuote')
  assert.ok(end > start, 'duplicateQuote 의 끝을 못 잡았다')
  return SERVICE.slice(start, end)
}

/*
  견적서에 **인쇄되는** 칸들. 복제본에서 비면 사람이 고친 적 없는데 문서가 달라진다.

  여기 적힌 것은 「복제가 반드시 들고 가야 하는 값」이지 「crm_quote 의 모든 칸」이 아니다 —
  승인·발송 자취처럼 **일부러 안 따라가는 것**도 있고 그건 코드 주석이 이유를 적는다.
*/
const QUOTE_CARRIED: Array<[field: string, from: string, why: string]> = [
  ['fxRate', 'src.fxRate', '합계 위 원화 환산 줄이 이 값으로 찍힌다'],
  ['fxDate', 'src.fxDate', '환산 근거로 「{날짜} 매매기준율」이 함께 인쇄된다'],
  ['fxSource', 'src.fxSource', '어느 고시를 썼는지가 근거다'],
  ['termIds', 'src.termIds', '거래 조건이 바뀌면 다른 안이 아니라 다른 문서다'],
  ['termsSnapshot', 'src.termsSnapshot', '굳은 조건이라 그대로 따라가야 한다'],
  ['supplierSnapshot', 'src.supplierSnapshot', '같은 견적의 다른 안이 다른 회사 정보를 찍으면 안 된다'],
  ['logoAssetHash', 'src.logoAssetHash', '문서 머리의 로고'],
  ['sealAssetHash', 'src.sealAssetHash', '상호 옆 직인'],
  /*
    금액 표시 선택 넷 — 실측 2026-10-04 에 **전부 빈 목록으로 태어났다.**
    「다른 안」은 조건만 다르고 같은 제안이라 **같은 축으로 보여야 둘을 견준다** —
    한쪽만 시간당이 적혀 있으면 고객이 비교를 못 한다.
  */
  ['rateAxisKeys', 'src.rateAxisKeys', '금액 칸에 어느 축을 인쇄할지'],
  ['lineNoteKeys', 'src.lineNoteKeys', '품목 아래 어느 근거를 인쇄할지'],
  ['totalConvKeys', 'src.totalConvKeys', '합계 영역에 어느 환산 줄을 세울지'],
  ['rateHoursPerMonth', 'src.rateHoursPerMonth', '시간당 환산이 이 값으로 나뉜다'],
]

const LINE_CARRIED: Array<[field: string, from: string, why: string]> = [
  ['remark', 'l.remark', '견적서 표 맨 오른쪽 비고 열에 인쇄된다'],
  ['descriptionMd', 'l.descriptionMd', '규격과 구성이 한 칸에 들어 있다'],
  ['unit', 'l.unit', '수량 옆 단위'],
  ['specialDiscountPercent', 'l.specialDiscountPercent', '정상가에서 특별가로 내려가는 표시의 근거'],
  ['specialDiscountReason', 'l.specialDiscountReason', '왜 깎았는지'],
  ['kind', 'l.kind', '종류가 단가·수량 칸의 뜻을 정한다'],
  /*
    공급 기간 — 없으면 개월과 총 시간을 못 세고, 그러면 축을 켜 두어도
    복제본에서는 **아무것도 안 그려진다**(설 근거를 잃는다).
  */
  ['startDate', 'l.startDate', '여기서 개월과 총 시간을 센다'],
  ['endDate', 'l.endDate', '기간의 끝 — 하나만 비어도 축이 못 선다'],
]

test('★ 복제가 견적의 인쇄되는 값을 들고 간다', () => {
  const body = duplicateBody()
  for (const [field, from, why] of QUOTE_CARRIED) {
    assert.match(
      body,
      new RegExp(`\\b${field}:\\s*${from.replace('.', '\\.')}\\b`),
      `복제가 ${field} 을 안 넘긴다 (${why}) — 복제본에서 그 자리가 조용히 빈다`,
    )
  }
})

test('★ 복제가 품목의 인쇄되는 값을 들고 간다', () => {
  const body = duplicateBody()
  for (const [field, from, why] of LINE_CARRIED) {
    assert.match(
      body,
      new RegExp(`\\b${field}:\\s*${from.replace('.', '\\.')}\\b`),
      `복제가 품목 ${field} 을 안 넘긴다 (${why}) — 복제본 품목에서 그 자리가 조용히 빈다`,
    )
  }
})

/*
  **일부러 안 따라가는 것**도 못 박는다. 이게 없으면 「다 복사하면 되지」로 되돌아가
  복제본이 승인된 상태로 태어나거나 보낸 날짜를 물려받는다.
*/
test('★ 승인과 발송 자취는 따라가지 않는다', () => {
  const body = duplicateBody()
  for (const field of ['approvedAt', 'approvedById', 'sentAt', 'decidedAt']) {
    assert.ok(
      !new RegExp(`\\b${field}:`).test(body),
      `복제가 ${field} 을 넘긴다 — 새 안은 승인과 발송을 다시 받아야 한다`,
    )
  }
})

test('★ 새로 매기는 것은 원본에서 베끼지 않는다', () => {
  const body = duplicateBody()
  // 견적번호는 그날 순번에서 새로 받는다 — src.quoteNo 를 그대로 쓰면 번호가 겹친다
  assert.ok(!/quoteNo:\s*src\.quoteNo\b/.test(body), '견적번호를 원본에서 베꼈다 — 번호가 겹친다')
  assert.match(body, /quoteNo\b/, '견적번호를 새로 매기는 자리가 없다')
  // 만든 사람은 복제한 사람이다
  assert.match(body, /createdById:\s*actorId\b/, '복제한 사람이 만든 사람으로 안 적힌다')
  // 어디서 갈라졌는지 남긴다
  assert.match(body, /sourceQuoteId:\s*src\.id\b/, '뿌리를 안 남긴다 — 어느 견적의 안인지 잃는다')
})
