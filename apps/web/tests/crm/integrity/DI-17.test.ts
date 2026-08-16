/**
 * DI-17 — 통화가 다른 딜을 합산할 때 스냅샷 환율로 환산한 값이 일치한다
 * 근거: 통합기획서 v0.2.1 952행 (DI 표 원문)
 *       259행 "다중 통화 합산: 워크스페이스 기본 통화로 환산(환율 스냅샷)"
 *       597행 exchange_rate | base, quote, rate, as_of_date | "일별 스냅샷, 리포트 환산용"
 *       476행 "금액은 정수 minor unit + 통화 코드: 부동소수점 금지"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData } from './_helpers.ts'
import { convertMinor, rollupToBase, findRate, minorDigits } from '../../../lib/crm/domain/currency.ts'

const RATES = [
  { base: 'USD', quote: 'KRW', rate: 1380, date: '2026-08-16' },
]

test('DI-17 같은 통화는 그대로 (환율을 타지 않는다)', () => {
  assert.equal(convertMinor({ amountMinor: 1000n, currency: 'KRW' }, 'KRW', RATES), 1000n)
})

test('DI-17 자릿수가 다른 통화를 건너뛰지 않는다 (USD 2자리 ↔ KRW 0자리)', () => {
  // $100.00 = 10000 minor(센트) → 138,000원 = 138000 minor(원)
  assert.equal(convertMinor({ amountMinor: 10000n, currency: 'USD' }, 'KRW', RATES), 138000n)
})

test('DI-17 역방향도 같은 스냅샷으로 환산한다', () => {
  // 138,000원 → $100.00 = 10000 센트
  assert.equal(convertMinor({ amountMinor: 138000n, currency: 'KRW' }, 'USD', RATES), 10000n)
  assert.equal(findRate('KRW', 'USD', RATES), 1 / 1380)
})

test('DI-17 KRW 는 minor 자릿수가 0 이다 (원이 곧 minor)', () => {
  assert.equal(minorDigits('KRW'), 0)
  assert.equal(minorDigits('USD'), 2)
})

test('DI-17 환율이 없으면 0 으로 때우지 않고 못 셌다고 말한다', () => {
  assert.equal(convertMinor({ amountMinor: 100n, currency: 'JPY' }, 'KRW', RATES), null)

  const r = rollupToBase(
    [{ amountMinor: 10000n, currency: 'USD' }, { amountMinor: 500n, currency: 'JPY' }],
    'KRW', RATES,
  )
  assert.equal(r.totalMinor, 138000n)
  assert.equal(r.counted, 1)
  assert.equal(r.skipped.length, 1, '못 센 것을 조용히 버렸다 — 합계가 작아진 걸 아무도 모른다')
  assert.equal(r.skipped[0].currency, 'JPY')
})

test('DI-17 다통화 합산이 기본 통화 기준으로 일치한다', () => {
  const r = rollupToBase(
    [
      { amountMinor: 300000000n, currency: 'KRW' }, // 3억원
      { amountMinor: 10000n, currency: 'USD' },     // $100 = 138,000원
    ],
    'KRW', RATES,
  )
  assert.equal(r.totalMinor, 300138000n)
  assert.equal(r.counted, 2)
  assert.equal(r.skipped.length, 0)
})

test('DI-17 같은 스냅샷이면 몇 번을 다시 계산해도 같은 값이다', () => {
  // 리포트를 어제 보든 오늘 보든 지난달 실적이 달라지면 안 된다
  const items = [{ amountMinor: 12345n, currency: 'USD' }]
  const a = rollupToBase(items, 'KRW', RATES)
  const b = rollupToBase(items, 'KRW', RATES)
  assert.equal(a.totalMinor, b.totalMinor)
})

test('DI-17 스냅샷이 다르면 값도 다르다 (지금 환율로 매번 환산하지 않는다는 증거)', () => {
  const older = [{ base: 'USD', quote: 'KRW', rate: 1300, date: '2026-07-01' }]
  const withNew = rollupToBase([{ amountMinor: 10000n, currency: 'USD' }], 'KRW', RATES)
  const withOld = rollupToBase([{ amountMinor: 10000n, currency: 'USD' }], 'KRW', older)
  assert.notEqual(withNew.totalMinor, withOld.totalMinor)
  assert.equal(withOld.totalMinor, 130000n)
})

test('DI-17 딜이 통화별로 저장되고 합산이 성립한다 (실 DB)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di17') })
    await tx.crmDeal.create({
      data: {
        id: 'dl_di17_krw', companyId: 'co_di17', pipelineId: 'pl_gpu', stageId: 'st_gpu_1',
        name: '원화 딜', amountMinor: 300000000n, currency: 'KRW',
      },
    })
    await tx.crmDeal.create({
      data: {
        id: 'dl_di17_usd', companyId: 'co_di17', pipelineId: 'pl_gpu', stageId: 'st_gpu_1',
        name: '달러 딜', amountMinor: 10000n, currency: 'USD',
      },
    })

    const deals = await tx.crmDeal.findMany({ where: { companyId: 'co_di17' } })
    const rolled = rollupToBase(
      deals.map((d: any) => ({ amountMinor: d.amountMinor, currency: (d.currency ?? 'KRW').trim() })),
      'KRW', RATES,
    )
    assert.equal(rolled.counted, 2)
    assert.equal(rolled.totalMinor, 300138000n)
  })
})
