/**
 * 딜 원가 → 견적 줄 길의 가드
 *
 * **왜 이 길에 가드가 필요한가**: 받은 견적서를 원가로 보내는 길은 있었는데
 * **되돌아오는 길이 없었다.** 그래서 같은 품목을 사람이 편집기에 손으로 다시 적었고,
 * 적는 동안 수량과 단가가 어긋났다 — 그렇게 어긋난 견적은 고객에게 나간다.
 *
 * 화면 쪽 규칙(단추가 서 있나·창이 통화를 묻나)은 창을 읽는 가드가 본다.
 * 여기서는 **옮기는 값**만 줄마다 검사한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  costToQuoteLines, prefillMarginPct, FALLBACK_MARGIN_PCT,
  type CostSource,
} from './cost-to-quote.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const MODAL = read('components/ui/crm/CostToQuoteModal.tsx')
const PANEL = read('components/ui/crm/QuotePanel.tsx')
const ROUTE = read('app/api/crm/deals/[id]/costs/route.ts')

/** $360.00 × 3개월 = $1,080.00, 2026-09-14 매매기준율 1,346.40 */
const usd = (over: Partial<CostSource> = {}): CostSource => ({
  id: 'c_usd',
  name: 'GPU 서버 임대',
  descriptionMd: 'H100 SXM 8way\n640GB HBM3',
  remark: '월 단가 기준',
  kind: 'PERIOD',
  quantity: '3',
  unit: '개월',
  unitPriceMinor: '36000',
  amountMinor: '108000',
  currency: 'USD',
  fxRate: '1346.4',
  fxDate: '2026-09-14',
  ...over,
})

/* ── ① 옮기는 값 ─────────────────────────────────── */

test('★ 수량·단위·종류·단가가 그대로 간다 — 금액 한 칸만 옮기면 「몇 대에 얼마였나」가 사라진다', () => {
  const { lines } = costToQuoteLines([usd()], { currency: 'USD', marginPercent: '' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].quantity, '3')
  assert.equal(lines[0].unit, '개월')
  assert.equal(lines[0].kind, 'PERIOD')
  assert.equal(lines[0].unitPriceMinor, '36000', '마진을 안 얹으면 원가 단가 그대로다')
  assert.equal(lines[0].name, 'GPU 서버 임대')
  assert.equal(lines[0].descriptionMd, 'H100 SXM 8way\n640GB HBM3', '규격·구성이 잘렸다')
  assert.equal(lines[0].remark, '월 단가 기준')
})

test('★ 통화가 다르면 그 행에 박아 둔 환율로 환산한다 — 지금 환율로 하면 어제 본 원가와 어긋난다', () => {
  const r = costToQuoteLines([usd()], { currency: 'KRW', marginPercent: '' })
  // $360.00 × 1,346.40 = 484,704원
  assert.equal(r.lines[0].unitPriceMinor, '484704')
  assert.equal(r.fxRate, '1346.4', '환산 근거를 견적 초안에 안 실었다')
  assert.equal(r.fxDate, '2026-09-14')
})

test('같은 통화면 환산 근거를 싣지 않는다 — 환산한 것이 없는데 환율을 적으면 문서가 거짓말한다', () => {
  const r = costToQuoteLines([usd()], { currency: 'USD', marginPercent: '' })
  assert.equal(r.fxRate, null)
  assert.equal(r.fxDate, null)
})

test('★ 환율이 없는 원가는 1대1 로 옮기지 않고 빠진 사실을 남긴다', () => {
  const r = costToQuoteLines(
    [usd({ id: 'c_php', name: '현지 설치', currency: 'PHP', fxRate: null, unitPriceMinor: null, quantity: null, amountMinor: '50000' })],
    { currency: 'KRW', marginPercent: '' },
  )
  assert.equal(r.lines.length, 0, '환율을 모르는데 옮기면 50,000페소가 50,000원으로 앉는다')
  assert.deepEqual(r.skipped, [{ id: 'c_php', name: '현지 설치', currency: 'PHP' }])
})

test('수량이 없거나 0 이면 금액 한 줄로 옮긴다 — 0 으로 나눌 수도, 0개를 팔 수도 없다', () => {
  for (const over of [{ quantity: null }, { quantity: '0' }, { unitPriceMinor: null }]) {
    const { lines } = costToQuoteLines(
      [usd({ ...over, currency: 'KRW', amountMinor: '500000' })],
      { currency: 'KRW', marginPercent: '' },
    )
    assert.equal(lines[0].quantity, '1', `${JSON.stringify(over)} 에서 수량이 1 이 아니다`)
    assert.equal(lines[0].unitPriceMinor, '500000', '금액을 단가 자리에 안 넣었다')
  }
})

test('고시일이 여럿이면 가장 이른 것과 그 날의 환율을 싣는다 — 날짜와 환율이 다른 줄에서 오면 안 된다', () => {
  const r = costToQuoteLines([
    usd({ id: 'a', fxRate: '1400', fxDate: '2026-10-01' }),
    usd({ id: 'b', fxRate: '1300', fxDate: '2026-09-01' }),
  ], { currency: 'KRW', marginPercent: '' })
  assert.equal(r.fxDate, '2026-09-01')
  assert.equal(r.fxRate, '1300')
})

/* ── ② 원가 그대로 파는 견적을 만들지 않는다 ─────── */

test('★ 기본 모드에서 단가가 원가보다 크다 — 원가 그대로 나가는 견적을 기본값으로 두지 않는다', () => {
  const { lines, note } = costToQuoteLines([usd()], {
    currency: 'USD',
    marginPercent: String(FALLBACK_MARGIN_PCT),
  })
  assert.ok(Number(lines[0].unitPriceMinor) > 36000,
    `단가 ${lines[0].unitPriceMinor} 가 원가 36000 보다 크지 않다`)
  // 마진은 판매가 대비다 — 원가 36,000 에 20% 는 43,200 이 아니라 45,000
  assert.equal(lines[0].unitPriceMinor, '45000')
  assert.match(note ?? '', /마진 20%/, '무엇을 얼마로 올렸는지 말하지 않으면 조용히 바꾼 것이다')
})

test('★ 미리 채우는 마진율은 딜이 스스로 말하는 값이다 — 지어낸 숫자가 아니다', () => {
  // 실측 딜: 수주 매출 2,000,000 · 환산 원가 1,454,112 → 27.2%
  assert.equal(prefillMarginPct('2000000', '1454112'), 27.2)
  // 딜이 말할 것이 없으면 채워 둔 값으로 시작한다
  assert.equal(prefillMarginPct('0', '1454112'), FALLBACK_MARGIN_PCT)
  assert.equal(prefillMarginPct('1000000', '2000000'), FALLBACK_MARGIN_PCT, '원가가 매출보다 크면 마진이 음수다')
  assert.equal(prefillMarginPct(null, null), FALLBACK_MARGIN_PCT)
})

test('마진율을 안 적으면 원가 그대로 간다 — 빈 칸은 0% 가 아니라 「안 적음」이다', () => {
  const { lines, note } = costToQuoteLines([usd()], { currency: 'USD', marginPercent: '' })
  assert.equal(lines[0].unitPriceMinor, '36000')
  assert.equal(note, null)
})

test('마진 계산은 quote-margin 한 곳에서 한다 — 두 벌이 되면 원가 화면과 견적 화면이 다른 말을 한다', async () => {
  const { sellFromCost } = await import('./quote-margin.ts')
  const { lines } = costToQuoteLines([usd()], { currency: 'USD', marginPercent: '20' })
  assert.equal(lines[0].unitPriceMinor, sellFromCost(BigInt(36000), 20).toString())
})

/* ── ③ 화면이 그 값을 쓰는가 ─────────────────────── */

test('★ 견적 패널에 「딜 원가에서 가져오기」가 서 있고 그 창을 연다', () => {
  assert.match(PANEL, /CostToQuoteModal/, '창을 안 부른다')
  assert.match(PANEL, /QUOTE\.fromDealCost/, '단추 이름을 용어집 밖에서 적는다')
  assert.ok(
    PANEL.indexOf('setCosting(true)') > -1,
    '단추를 눌러도 창이 열리지 않는다',
  )
})

test('★ 창이 통화와 마진을 묻는다 — 고를 것이 없으면 원가 그대로 나간다', () => {
  assert.match(MODAL, /CURRENCY_CHOICES/, '통화 고르기가 없다')
  assert.match(MODAL, /id="cost-quote-margin"/, '마진 칸이 없다')
  assert.match(MODAL, /prefillMarginPct/, '마진율을 지어낸 숫자로 채운다')
})

test('★ 옮긴 결과가 편집기를 지난다 — 바로 저장하면 원가 그대로 나간 견적이 조용히 생긴다', () => {
  assert.match(MODAL, /onPicked/, '결과를 넘기는 자리가 없다')
  assert.ok(!/fetch\('\/api\/crm\/quotes'/.test(MODAL), '창이 스스로 견적을 만든다')
  assert.match(PANEL, /setEditing\(/, '넘겨받은 초안을 편집기에 안 올린다')
})

test('★ 환산 근거가 초안에 실린다 — 원화로 고르면 환율과 고시일이 함께 간다', () => {
  assert.match(MODAL, /fxRate/, '환율을 초안에 안 싣는다')
  assert.match(MODAL, /fxDate/, '고시일을 초안에 안 싣는다')
})

/* ── ④ 게이트는 창구가 본다 ──────────────────────── */

/*
  **단추를 감추는 것으로 권한 검증을 대신하지 않는다**(정책 F-N).
  화면이 원가를 읽으려면 창구를 지나야 하고, 그 창구가 `cost.view` 를 본다.
*/
test('★ 원가 읽기 게이트는 창구에 있다 — 화면이 역할을 직접 판정하지 않는다', () => {
  const get = ROUTE.slice(ROUTE.indexOf('export async function GET'), ROUTE.indexOf('export async function POST'))
  assert.match(get, /hasCapability\(\{ role: session\.role \}, 'cost\.view'\)/, '읽기 앞에 게이트가 없다')
  assert.match(get, /throw new CrmError\('FORBIDDEN'/, '막지 않는다')
  for (const bad of [/role === /, /'ADMIN'/, /isAdmin/]) {
    assert.ok(!bad.test(MODAL), `창이 역할을 직접 본다: ${bad}`)
  }
})
