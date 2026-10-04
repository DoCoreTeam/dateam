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

/*
  ── 빠뜨린 칸이 또 생기는 것을 막는다 ──────────────────────────────────────────

  위의 목록은 **사람이 적은 것**이라, 새 칼럼을 더하면서 목록에 안 적으면 아무도 안 본다.
  실제로 두 번 그랬다 — 비고·환율(P0109 I02)과 금액 표시·공급 기간(P0110 I01).
  둘 다 「칼럼을 더했고 화면도 붙였는데 복제만 몰랐다」였고, 복제본을 연 사람은
  **고친 적 없는 자리가 비어 있는 것**을 봤다.

  그래서 여기서는 목록이 아니라 **스키마를 센다.** 표의 칸 하나하나가 셋 중 하나여야 한다
  — 복제가 들고 가거나, 새로 매기거나, 「안 따라간다」고 사유와 함께 적혀 있거나.
  어느 쪽도 아니면 그 칸 이름을 대며 떨어진다.
*/
const SCHEMA = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf-8')

/** 모델의 **값 칸**만 — 관계는 복제가 따로 잇는다(묶음·비율 줄) */
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

/**
 * **일부러 안 따라가는 칸.** 사유 없이 여기 적지 않는다 —
 * 이 목록이 길어지는 것이 곧 「복제가 점점 다른 문서를 만든다」는 뜻이다.
 */
const QUOTE_NOT_CARRIED: Record<string, string> = {
  id: '새로 매긴다',
  workspaceId: '트랜잭션이 넣는다',
  version: '낙관적 잠금 — 새 행은 처음부터 센다',
  status: '새 안은 초안에서 시작한다',
  createdAt: '저장소가 매긴다',
  updatedAt: '저장소가 매긴다',
  deletedAt: '새 행은 안 지워진 상태다',
  approvedAt: '승인은 금액이 달라질 문서라 다시 받는다',
  approvedById: '같은 이유',
  sentAt: '보낸 적 없는 새 문서다',
  decidedAt: '같은 이유',
  // 원본 문서 자취 — **일부러 안 옮긴다.** 이 안은 사람이 앞 견적에서 갈라 만든 것이지
  // 파일을 읽어 만든 것이 아니다. 원본과의 끈은 sourceQuoteId 가 들고 있고 목록이 그걸 보인다
  fromFileAt: '파일에서 읽어 만든 것이 아니다 — 끈은 sourceQuoteId 가 들고 있다',
  sourceFileName: '같은 이유',
  sourcePageStart: '같은 이유',
  sourcePageEnd: '같은 이유',
  sourceSnapshotId: '같은 이유',
}

const LINE_NOT_CARRIED: Record<string, string> = {
  id: '새로 매긴다',
  quoteId: '새 견적을 가리킨다',
  createdAt: '저장소가 매긴다',
  updatedAt: '저장소가 매긴다',
  // ratioOfLineId 는 **값이 아니라 가리키는 줄**이라 두 번째 바퀴에서 새 id 로 잇는다
  ratioOfLineId: '같은 견적의 다른 줄을 가리켜 옛 id 를 베끼면 원본을 가리킨다 — 아래에서 따로 잇는다',
}

for (const [model, exempt, prefix] of [
  ['CrmQuote', QUOTE_NOT_CARRIED, 'src'],
  ['CrmQuoteLine', LINE_NOT_CARRIED, 'l'],
] as const) {
  test(`★ ${model} 의 모든 칸이 복제에서 셋 중 하나다 — 들고 가거나 새로 매기거나 사유가 적혀 있거나`, () => {
    const body = duplicateBody()
    const 빠진것: string[] = []
    for (const f of scalarFields(model)) {
      if (f in exempt) continue
      // `f: 값` 도 되고 `f,`(줄임꼴) 도 된다 — 둘 다 그 칸을 넣고 있다는 뜻이다
      const 실림 = new RegExp(`\\b${f}\\s*[:,]`).test(body)
      if (!실림) 빠진것.push(f)
    }
    assert.deepEqual(빠진것, [],
      `복제가 이 칸들을 안 다룬다: ${빠진것.join(', ')}. ` +
      '들고 가도록 고치거나, 안 따라가는 이유를 이 파일의 목록에 적어라 — ' +
      '적어 두지 않으면 다음 사람이 복제본에서 빈 자리를 보고 원인을 못 찾는다')
  })
}

test('★ 비율 줄은 새 견적 안의 줄을 가리킨다 — 옛 id 를 베끼면 원본을 고칠 때 복제본이 따라 움직인다', () => {
  const body = duplicateBody()
  assert.match(body, /lineMap\.set\(/, '옛 줄 id → 새 줄 id 표를 안 만든다')
  assert.match(body, /ratioOfLineId:\s*lineMap\.get\(/,
    '비율 줄이 가리키는 줄을 새 id 로 안 바꾼다 — 복제본이 원본 견적의 줄을 가리킨다')
  assert.ok(!/ratioOfLineId:\s*l\.ratioOfLineId\b/.test(body),
    '옛 id 를 그대로 베꼈다')
})

test('★ 안 따라가는 칸 목록에 사유 없는 줄이 없다', () => {
  for (const [model, exempt] of [['CrmQuote', QUOTE_NOT_CARRIED], ['CrmQuoteLine', LINE_NOT_CARRIED]] as const) {
    for (const [field, why] of Object.entries(exempt)) {
      assert.ok(why.trim().length >= 4, `${model}.${field} 에 사유가 없다 — 「나중에」로 미룬 칸이 여기 숨는다`)
    }
  }
})
