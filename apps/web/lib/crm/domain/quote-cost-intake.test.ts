/**
 * 받은 견적서 → 딜 원가 길의 가드
 *
 * **왜 이 길에 가드가 필요한가**: 원가는 관리자만 보는 값이라 **틀려도 아무도 안 본다.**
 * 견적은 고객에게 나가므로 틀리면 그날 들킨다 — 원가는 반년 뒤 정산에서 들킨다.
 * 그래서 화면이 아니라 여기서 줄마다 검사한다.
 *
 * 화면 쪽 규칙(원가 칸이 고른 사람에게만 뜨는가·첨부가 기본 꺼짐인가)은
 * 이미 그 창을 읽고 있는 `lib/ui/quote-layout.test.ts` 가 본다 — 창을 읽는 가드를 두 벌 두지 않는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  costBasisNote, withQuoteLineIds, toCostPayloads,
  INTAKE_DEFAULT_CATEGORY, INTAKE_DEFAULT_STAGE,
  type IntakeLine,
} from './quote-cost-intake.ts'
import { isCurrencyCode, toCurrencyCode } from './currency.ts'
import { joinSpec } from './quote-spec.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const ROUTE = read('app/api/crm/deals/[id]/costs/route.ts')
const SERVICE = read('lib/crm/services/cost.ts')
const MODAL = read('components/ui/crm/QuoteFromFileModal.tsx')

const line = (over: Partial<IntakeLine> = {}): IntakeLine => ({
  name: 'H100 SXM 8way',
  descriptionMd: '640GB HBM3',
  amountMinor: '143000000',
  sourceText: 'H100 SXM 8way | 1 | 143,000,000',
  ...over,
})

/* ── ① 옮기는 값 ─────────────────────────────────── */

test('★ 넣는 방식은 금액으로 고정 — 공수나 비율로 되돌리는 것은 우리가 지어내는 일이다', () => {
  const [row] = toCostPayloads([line()], { category: 'MATERIAL', stage: 'ESTIMATE' })
  assert.equal(row.inputMode, 'AMOUNT')
  assert.equal(row.amountMinor, '143000000')
  assert.equal(row.name, 'H100 SXM 8way')
  assert.equal(row.descriptionMd, '640GB HBM3')
})

test('★ 갈래·시점은 고른 값 그대로 — 여기서 추측하면 사람이 되돌리는 일부터 한다', () => {
  const [row] = toCostPayloads([line()], { category: 'SUBCONTRACT', stage: 'COMMITTED' })
  assert.equal(row.category, 'SUBCONTRACT')
  assert.equal(row.stage, 'COMMITTED')
})

test('시점 기본값은 추정 — 견적서를 받은 시점에 확정된 것은 아무것도 없다', () => {
  assert.equal(INTAKE_DEFAULT_STAGE, 'ESTIMATE')
  assert.equal(INTAKE_DEFAULT_CATEGORY, 'MATERIAL')
})

test('모르는 갈래·시점이 오면 기본값으로 내려앉는다 — 한 줄 때문에 그 건 전체가 죽지 않게', () => {
  const [row] = toCostPayloads([line()], {
    category: 'NOPE' as never, stage: 'LATER' as never,
  })
  assert.equal(row.category, INTAKE_DEFAULT_CATEGORY)
  assert.equal(row.stage, INTAKE_DEFAULT_STAGE)
})

test('이름이 빈 줄은 빠진다 — 서버가 거절하는 값이라 함께 보내면 그 건 전체가 실패한다', () => {
  const rows = toCostPayloads(
    [line(), line({ name: '   ' }), line({ name: '설치비' })],
    { category: 'MATERIAL', stage: 'ESTIMATE' },
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.name), ['H100 SXM 8way', '설치비'])
})

/* ── ② 근거 — 「이 숫자 어디서 왔지」 ─────────────── */

test('★ 근거에 파일 이름과 원문 조각이 함께 남는다', () => {
  const note = costBasisNote('견적서_KTL_2026.pdf', 'H100 SXM 8way | 1 | 143,000,000')
  assert.match(note ?? '', /견적서_KTL_2026\.pdf/)
  assert.match(note ?? '', /143,000,000/)
})

test('근거가 될 것이 하나도 없으면 비워 둔다 — 빈 말을 적으면 있는 것처럼 보인다', () => {
  assert.equal(costBasisNote(null, null), null)
  assert.equal(costBasisNote('  ', ''), null)
  assert.equal(costBasisNote('a.pdf', null), 'a.pdf')
})

test('원문 조각이 길면 자른다 — 표 한 줄이 통째로 들어오면 근거 칸이 벽이 된다', () => {
  const note = costBasisNote('a.pdf', 'x'.repeat(400)) ?? ''
  assert.ok(note.length < 200, `근거가 ${note.length}자다`)
  assert.match(note, /…$/)
})

/* ── ③ 판매 줄과 잇기 — 어긋나면 남의 줄에 붙는다 ── */

test('★ 개수가 같을 때만 잇는다 — 하나라도 어긋나면 그 뒤가 전부 밀린다', () => {
  const lines = [line({ name: 'a' }), line({ name: 'b' })]
  const ok = withQuoteLineIds(lines, ['q1', 'q2'])
  assert.deepEqual(ok.map((l) => l.quoteLineId), ['q1', 'q2'])

  const short = withQuoteLineIds(lines, ['q1'])
  assert.deepEqual(short.map((l) => l.quoteLineId), [null, null],
    '개수가 다른데 이으면 둘째 원가가 첫째 판매 줄에 붙는다')
})

test('판매 견적을 안 만들었으면 줄은 비어 있다 — 안 이은 것과 잘못 이은 것은 다르다', () => {
  const rows = toCostPayloads(
    withQuoteLineIds([line()], []),
    { category: 'MATERIAL', stage: 'ESTIMATE' },
  )
  assert.equal(rows[0].quoteLineId, null)
})

test('이은 줄은 창구로 가는 모양에 그대로 실린다', () => {
  const rows = toCostPayloads(
    withQuoteLineIds([line()], ['ql_1']),
    { category: 'MATERIAL', stage: 'ESTIMATE', fileName: 'a.pdf' },
  )
  assert.equal(rows[0].quoteLineId, 'ql_1')
})

/* ── ④ 게이트는 한 곳 ────────────────────────────── */

/*
  **묶음에 창구를 따로 내면 게이트가 두 곳이 된다.** 그러면 한쪽만 고쳐지는 날이 오고,
  그날 원가는 관리자만 넣는다는 규칙이 반만 남는다.
*/
test('★ 원가 쓰기 게이트는 창구 하나에만 있다 — 묶음도 같은 문으로 들어온다', () => {
  const gates = ROUTE.match(/hasCapability\(\{ role: session\.role \}, 'cost\.edit'\)/g) ?? []
  assert.equal(gates.length, 2, '게이트(POST)와 그 답을 전하는 자리(GET) 둘뿐이어야 한다')

  const post = ROUTE.slice(ROUTE.indexOf('export async function POST'))
  assert.match(post, /if \(!hasCapability\(\{ role: session\.role \}, 'cost\.edit'\)\)/,
    '쓰기 앞에 게이트가 없다')
  assert.ok(
    post.indexOf("'cost.edit'") < post.indexOf('createDealCosts'),
    '묶음 만들기가 게이트보다 먼저 온다',
  )
})

test('★ 화면은 역할을 스스로 판정하지 않는다 — 규칙이 두 곳이 되면 한쪽만 늙는다', () => {
  for (const bad of [/role === /, /'ADMIN'/, /'admin'/, /isAdmin/]) {
    assert.ok(!bad.test(MODAL), `가져오기 창이 역할을 직접 본다: ${bad}`)
  }
  assert.match(MODAL, /body\?\.canEdit/, '서버가 준 답을 안 쓴다')
})

/* ── ⑤ 한 건은 한 덩어리 ─────────────────────────── */

test('★ 묶음은 한 트랜잭션이다 — 줄마다 커밋하면 절반만 들어간 원가가 남는다', () => {
  const fn = SERVICE.slice(
    SERVICE.indexOf('export async function createDealCosts'),
    SERVICE.indexOf('export const MAX_COST_BATCH'),
  )
  assert.ok(fn.length > 0, 'createDealCosts 가 없다')
  assert.equal((fn.match(/withCrmTx\(/g) ?? []).length, 1, '트랜잭션이 하나가 아니다')
  assert.ok(!/createDealCost\(/.test(fn), '낱개 함수를 돌려 부르면 트랜잭션이 줄마다 열린다')
  assert.match(fn, /MAX_COST_BATCH/, '상한이 없다')
})

/* ── 같은 성격의 자리를 전부 (v0.10.31x) ─────────── */

/*
  **왜 여기서 보나**: 파일 경로만 고치면 붙여넣기로 만든 견적과 원가로 보낸 항목은
  여전히 규격 한 줄이다. 같은 내용이 **넣는 방법에 따라** 달라지고, 그 차이는
  아무도 설명할 수 없다(이 저장소가 반복한 「인물만 고치고 회사는 안 고침」과 같은 모양).
*/

test('★ 원가로 보낸 항목도 구성을 함께 나른다 — 매입끼리 견주려면 구성이 있어야 한다', () => {
  const composed = ['AMD 9355 32Core x 2Ea', 'Dual AMD EPYC 9005/9004', '12-Channel DDR5'].join('\n')
  const [out] = toCostPayloads(
    [{ name: 'GIGABYTE R283-Z96-AAJ1', descriptionMd: composed, amountMinor: '6050000', sourceText: '원문 줄' }],
    { category: 'HARDWARE', stage: 'PLANNED', fileName: 'a.pdf' },
  )
  assert.equal(out.descriptionMd, composed, '구성이 잘리거나 한 줄로 뭉쳤다')
  assert.ok(out.descriptionMd?.includes('\n'), '줄바꿈이 사라졌다')
})

test('★ 붙여넣기 스키마도 구성을 받는다 — 파일만 고치면 같은 화면이 두 결과를 낸다', async () => {
  const { QuoteDraftOutputSchema, MAX_DOC_COMPONENT_LINES } =
    await import('../ai/schemas/quote-draft.ts')
  const parsed = QuoteDraftOutputSchema.parse({
    title: null, currency: 'KRW', roundingUnit: 0,
    targetTotalMinor: null, targetIncludesTax: false, taxPercent: null, unclear: [],
    lines: [{
      name: 'GIGABYTE R283-Z96-AAJ1', spec: 'AMD 9355 32Core x 2Ea',
      components: ['Dual AMD EPYC 9005/9004', '12-Channel DDR5'],
      kind: 'QUANTITY', quantity: 1, unit: '대', unitPriceMinor: 6050000,
      discountPercent: null, specialDiscountPercent: null,
    }],
  })
  assert.deepEqual(parsed.lines[0].components, ['Dual AMD EPYC 9005/9004', '12-Channel DDR5'])
  assert.equal(MAX_DOC_COMPONENT_LINES, 40)
})

test('★ 두 경로가 같은 상한을 쓴다 — 한 곳에서만 오면 갈릴 수가 없다', async () => {
  const draft = await import('../ai/schemas/quote-draft.ts')
  const doc = await import('../ai/schemas/quote-from-doc.ts')
  assert.equal(doc.MAX_DOC_COMPONENT_LINES, draft.MAX_DOC_COMPONENT_LINES)
  assert.equal(doc.MAX_COMPONENT_TEXT, draft.MAX_COMPONENT_TEXT)

  // 값이 나오는 단정 — 붙여넣기 경로도 실제로 잘리나
  const many = Array.from({ length: draft.MAX_DOC_COMPONENT_LINES + 5 }, (_, i) => `구성 ${i}`)
  const parsed = draft.QuoteDraftOutputSchema.parse({
    title: null, currency: 'KRW', roundingUnit: 0,
    targetTotalMinor: null, targetIncludesTax: false, taxPercent: null, unclear: [],
    lines: [{
      name: 'A', spec: null, components: many, kind: null, quantity: 1, unit: null,
      unitPriceMinor: null, discountPercent: null, specialDiscountPercent: null,
    }],
  })
  assert.equal(parsed.lines[0].components.length, draft.MAX_DOC_COMPONENT_LINES)
})

test('★ 붙여넣기 화면도 구성을 폼으로 나른다 — 받아 놓고 안 넘기면 저장에서 사라진다', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const src = readFileSync(join(web, 'components/ui/crm/QuoteFillPanel.tsx'), 'utf8')
  assert.match(src, /descriptionMd: joinSpec\(l\.spec, l\.components\)/,
    '말로 채우기가 구성을 버린다')
})

/* ── 줄바꿈이 저장까지 사는가 (v0.10.32x) ────────── */

/*
  **실브라우저가 잡은 결함이다.** 화면까지는 구성이 여러 줄이었는데 저장하는 순간
  한 줄로 뭉쳤다 — `normalizeText` 가 `\s+` 를 공백 하나로 눕히기 때문이다.
  타입 검사도 단위 시험도 못 밟는 자리였고, DB 값을 직접 보고서야 알았다.
*/

test('★ 여러 줄 정리는 줄바꿈을 살린다 — 한 줄 정리를 쓰면 구성이 뭉친다', async () => {
  const { normalizeMultiline, normalizeText } = await import('./normalize.ts')
  const spec = 'AMD 9355 32Core x 2Ea\nDual AMD EPYC 9005/9004\n12-Channel DDR5'

  assert.equal(normalizeMultiline(spec), spec)
  assert.ok(!(normalizeText(spec) ?? '').includes('\n'),
    '한 줄 정리가 줄바꿈을 살리면 이 가드가 헛돈다')
})

test('줄 안의 연속 공백은 정리하고 빈 줄은 버린다 — 빈 줄이 인쇄되면 문서에 구멍이 생긴다', async () => {
  const { normalizeMultiline } = await import('./normalize.ts')
  assert.equal(normalizeMultiline('  가   나  \n\n\n  다  '), '가 나\n다')
  assert.equal(normalizeMultiline('   '), null)
  assert.equal(normalizeMultiline(null), null)
})

test('★ 견적 저장 경로가 여러 줄 정리를 쓴다 — 규격과 특기사항 둘 다', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../services/quote.ts', import.meta.url), 'utf8')
  assert.match(src, /descriptionMd: normalizeMultiline\(line\.descriptionMd\)/,
    '규격이 한 줄로 뭉친다')
  assert.ok(!/notesMd: normalizeText\(/.test(src),
    '특기사항이 한 줄로 뭉친다 — 화면은 여러 줄 칸이고 인쇄는 pre-wrap 인데 저장만 눕히고 있었다')
})

/* ── ⑥ 통화와 줄 — 읽은 것을 그대로 싣는가 (v0.10.85x) ─ */

/*
  **이 절이 이 플랜의 이유다.**

  실측 2026-10-02: 공급사 USD 견적서를 원가로 보냈더니 $1,080.00 의 센트값 108000 이
  원화로 앉아 화면에 「108,000원」으로 떴다. 참값은 1,346.40 환율로 1,454,112원 —
  **13.46분의 1** 이다. 그 딜의 마진율이 94.6% 로 떠 있었고 참값은 27.3% 였다.
  원가가 작아지면 마진은 커지고, 그 딜은 「남는 장사」로 보인 채 값이 정해진다.

  원인은 계산이 아니라 **옮기는 자리**였다 — `toCostPayloads` 가 여덟 칸만 넘기고
  통화·수량·단위·단가·종류·비고를 버렸다. 금액 한 칸만 남으면 나중에
  「몇 대에 얼마였나」를 문서를 다시 열어야 알 수 있고, 견적 줄로 되돌릴 수도 없다.
*/

const usd = (over: Partial<IntakeLine> = {}): IntakeLine => ({
  name: 'GPU 서버 임대',
  descriptionMd: joinSpec('H100 SXM 8way', ['640GB HBM3', '12-Channel DDR5']),
  amountMinor: '108000',
  currency: 'USD',
  kind: 'PERIOD',
  quantity: '3',
  unit: '개월',
  unitPriceMinor: '36000',
  remark: '월 단가 기준',
  sourceText: 'GPU 서버 임대 | 3 | $360.00 | $1,080.00',
  ...over,
})

test('★ USD 줄이 일곱 칸을 지닌 채 원가로 간다 — 금액 한 칸만 남으면 달러가 원화로 앉는다', () => {
  const [row] = toCostPayloads([usd()], { category: 'MATERIAL', stage: 'ESTIMATE', fileName: 'supplier.pdf' })

  assert.equal(row.currency, 'USD', '통화가 안 실렸다 — 이것이 108,000원 사고의 자리다')
  assert.equal(row.kind, 'PERIOD')
  assert.equal(row.quantity, '3')
  assert.equal(row.unit, '개월')
  assert.equal(row.unitPriceMinor, '36000')
  assert.equal(row.remark, '월 단가 기준')
  assert.equal(row.amountMinor, '108000')
})

test('★ 규격은 descriptionMd 첫 줄에 서고 구성이 그 아래 남는다 — 칸을 새로 만들지 않는 약속', () => {
  const [row] = toCostPayloads([usd()], { category: 'MATERIAL', stage: 'ESTIMATE' })
  const lines = (row.descriptionMd ?? '').split('\n')
  assert.equal(lines[0], 'H100 SXM 8way', '규격이 첫 줄이 아니다')
  assert.deepEqual(lines.slice(1), ['640GB HBM3', '12-Channel DDR5'], '구성이 잘렸다')
})

test('★ 안 넘긴 칸은 비어 있다 — 못 읽은 것을 0 으로 적으면 0원짜리 줄이 조용히 들어간다', () => {
  const [row] = toCostPayloads(
    [{ name: '설치비', amountMinor: '500000' }],
    { category: 'EXPENSE', stage: 'ESTIMATE' },
  )
  assert.equal(row.quantity, null)
  assert.equal(row.unitPriceMinor, null)
  assert.equal(row.unit, null)
  assert.equal(row.remark, null)
  assert.equal(row.currency, null, '안 넘긴 통화를 여기서 KRW 로 적으면 서버가 구별할 수 없다')
  assert.equal(row.kind, null)
})

test('통화는 공백을 떼고 대문자로 올린다 — 「 usd 」와 「USD」가 다른 통화일 수는 없다', () => {
  const [row] = toCostPayloads([usd({ currency: '  usd  ' })], { category: 'MATERIAL', stage: 'ESTIMATE' })
  assert.equal(row.currency, 'USD')
})

test('★ 모르는 통화를 KRW 로 눕히지 않는다 — 조용히 고쳐지는 것보다 거절당하는 것이 낫다', () => {
  const [row] = toCostPayloads([usd({ currency: '달러' })], { category: 'MATERIAL', stage: 'ESTIMATE' })
  assert.equal(row.currency, '달러', '여기서 null 로 만들면 서버가 「안 넘긴 것」과 구별할 수 없다')
  assert.equal(isCurrencyCode(row.currency), false, '서버가 거절할 값이어야 한다')
})

test('모르는 줄 종류는 비워서 보낸다 — 서버 enum 이 거절하면 그 건 전체가 안 들어간다', () => {
  const [row] = toCostPayloads([usd({ kind: 'MONTHLY' as never })], { category: 'MATERIAL', stage: 'ESTIMATE' })
  assert.equal(row.kind, null)
})

/* ── ⑦ 통화 코드 문지기 ──────────────────────────── */

test('★ ISO 세 글자 대문자만 통화다', () => {
  for (const ok of ['USD', 'KRW', 'JPY', 'EUR', 'usd', ' krw ']) {
    assert.equal(isCurrencyCode(ok), true, `${ok} 를 거절했다`)
  }
  for (const bad of ['달러', 'US', 'USDT', '$', '', null, undefined, 'U S D']) {
    assert.equal(isCurrencyCode(bad as never), false, `${String(bad)} 를 통과시켰다`)
  }
})

test('자릿수 표에 없는 코드도 통화다 — 그 표는 「2 가 아닌 통화」만 적어 둔 것이다', () => {
  assert.equal(toCurrencyCode('gbp'), 'GBP')
  assert.equal(toCurrencyCode('달러'), null)
})

/* ── ⑧ 서버가 문지기다 ──────────────────────────── */

/*
  통화 검사를 화면에 두면 창구를 직접 부르는 길(API·묶음 넣기)이 그 검사를 안 지난다.
  그래서 **거절은 서버에서** 하고, 여기서는 그 자리가 실제로 서 있는지만 본다.
  `services/cost.ts` 는 `@/` 와 prisma 를 물고 있어 단위 시험이 import 할 수 없다 —
  그래서 글로 읽는다(이 파일의 다른 서버 가드와 같은 방식이다).
*/

test('★ 모르는 통화는 서버가 VALIDATION_FAILED 로 거절한다 — KRW 로 고쳐 주지 않는다', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('function assertCurrency'), SERVICE.indexOf('async function stampFx'))
  assert.ok(fn.length > 0, 'assertCurrency 가 없다')
  assert.match(fn, /isCurrencyCode\(code\)/, '세 글자 검사를 안 쓴다')
  assert.match(fn, /throw new CrmError\('VALIDATION_FAILED'/, '거절하지 않는다')
  // 검사를 **통과한 값만** 돌아간다 — 코드가 아닌 값에 기본값을 돌려주면 달러가 원화로 앉는다
  const afterCheck = fn.slice(fn.indexOf('isCurrencyCode'))
  assert.ok(!/return fallback/.test(afterCheck),
    '코드가 아닌 값을 기본값으로 내려앉힌다')
  assert.match(afterCheck, /return code/, '검사를 지난 코드를 안 돌려준다')
})

test('★ 넣는 자리가 그 검사를 지난다 — 선언만 하고 안 부르면 가드가 아니다', () => {
  const fn = SERVICE.slice(
    SERVICE.indexOf('async function insertCost'),
    SERVICE.indexOf('export async function updateDealCost'),
  )
  assert.match(fn, /const currency = assertCurrency\(input\.currency\)/, '통화를 검사하지 않는다')
  assert.ok(fn.indexOf('assertCurrency') < fn.indexOf('crmDealCost.create'), '검사가 저장보다 늦다')
  // 값이 실제로 가는가 — 선언만 있고 data 에 안 실리면 표의 기본값(KRW)이 앉는다
  const data = fn.slice(fn.indexOf('data: {'), fn.indexOf('select: SELECT'))
  for (const col of ['currency,', '...fx,', 'kind,', 'quantity:', 'unit:', 'unitPriceMinor:', 'remark:']) {
    assert.ok(data.includes(col), `${col} 가 저장 자리에 없다`)
  }
})

test('★ 환율은 통화가 원화가 아닐 때만 받고, 못 받으면 null 이다 — 1 로 눕히면 1,454,112원이 1,080원이 된다', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('async function stampFx'), SERVICE.indexOf('function minorOrNull'))
  assert.ok(fn.length > 0, 'stampFx 가 없다')
  assert.match(fn, /if \(!needsFx\(currency\)\)/, '원화에도 환율을 받으러 간다')
  assert.match(fn, /await latestFxRate\(currency\)/, '환율 SSOT 를 안 쓴다')
  assert.match(fn, /fxRate: fx\?\.rate \?\? null/, '환율을 못 받았을 때 null 이 아니다')
  for (const bad of [/\?\? 1/, /\|\| 1/, /\?\? 0/]) {
    assert.ok(!bad.test(fn), `환율을 ${String(bad)} 으로 눕힌다`)
  }
})

test('★ 통화를 안 바꿨으면 환율을 다시 안 박는다 — 어제 본 마진이 오늘 달라지면 안 된다', () => {
  const fn = SERVICE.slice(
    SERVICE.indexOf('export async function updateDealCost'),
    SERVICE.indexOf('export async function deleteDealCost'),
  )
  assert.match(fn, /currency === before\.currency \? null : await stampFx\(currency\)/,
    '통화가 그대로인데 환율을 다시 받거나, 통화를 고쳤는데 옛 환율이 남는다')
})

test('★ 창구로 나가는 모양에 환율과 단가가 실린다 — 안 주면 화면이 환산을 못 한다', () => {
  const fn = SERVICE.slice(SERVICE.indexOf('export function toCostJson'), SERVICE.indexOf('export function toTotalsJson'))
  for (const key of ['fxRate:', 'fxDate:', 'quantity:', 'unitPriceMinor:']) {
    assert.ok(fn.includes(key), `${key} 가 응답에 없다`)
  }
  assert.match(fn, /fxDate \? r\.fxDate\.toISOString\(\)\.slice\(0, 10\)/, '고시일이 날짜가 아니다')
})

/* ── ⑨ 화면이 그 값을 넘기는가 ───────────────────── */

test('★ 가져오기 창이 통화와 줄 칸을 넘긴다 — 받아 놓고 안 넘기면 저장에서 사라진다', () => {
  const src = MODAL.slice(MODAL.indexOf('const source: IntakeLine[]'), MODAL.indexOf('toCostPayloads('))
  assert.ok(src.length > 0, '원가로 보낼 줄을 만드는 자리가 없다')
  assert.match(src, /currency: r\.currency/, '통화를 안 넘긴다 — 이것이 108,000원 사고의 자리다')
  for (const f of ['kind: r.lines[i].kind', 'quantity: r.lines[i].quantity', 'unit: r.lines[i].unit',
    'unitPriceMinor: r.lines[i].unitPriceMinor', 'remark: r.lines[i].remark']) {
    assert.ok(src.includes(f), `${f} 를 안 넘긴다`)
  }
})
