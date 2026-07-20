import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcriptionToCompetitorItems, proseToCompetitorItems } from './transcription-to-items.ts'
import type { TranscriptionRow } from './transcription.ts'

function row(raw_label: string, price_text: string | null, cells: string[] = []): TranscriptionRow {
  return { raw_label, price_text, cells }
}

test('원문 모델명 보존 — 카탈로그 매핑 절대 안 함(HGX B300이 H100으로 둔갑하지 않음)', () => {
  const rows = [row('NVIDIA HGX B300', '$7.85'), row('HGX B200', '$7.15')]
  const items = transcriptionToCompetitorItems(rows, { provider: 'Nebius' })
  assert.equal(items.length, 2)
  assert.equal(items[0].model_name, 'NVIDIA HGX B300')
  assert.equal(items[0].source_model_name, 'NVIDIA HGX B300')
  assert.equal(items[1].model_name, 'HGX B200')
  assert.equal(items[0].competitor_name, 'Nebius')
  // 어디에도 H100으로 둔갑한 항목이 없어야 함
  assert.ok(!items.some((it) => /h100/i.test(it.model_name)))
})

test('가격 파싱 — "$7.85" → 7.85', () => {
  const items = transcriptionToCompetitorItems([row('H200', '$4.50')])
  assert.equal(items[0].price_usd, 4.5)
  assert.equal(items[0].price_unknown, false)
})

test('가격 파싱 — "from $1.82" → 1.82', () => {
  const items = transcriptionToCompetitorItems([row('L40S', 'from $1.82')])
  assert.equal(items[0].price_usd, 1.82)
  assert.equal(items[0].price_unknown, false)
})

test('가격 파싱 — 천단위 콤마 "$1,234.50" → 1234.5', () => {
  const items = transcriptionToCompetitorItems([row('Cluster', '$1,234.50')])
  assert.equal(items[0].price_usd, 1234.5)
})

test('"Contact us" → price_unknown(GB300/GB200 보존)', () => {
  const rows = [row('GB300', 'Contact us'), row('GB200', null)]
  const items = transcriptionToCompetitorItems(rows, { provider: 'Nebius' })
  assert.equal(items.length, 2)
  assert.equal(items[0].model_name, 'GB300')
  assert.equal(items[0].price_usd, null)
  assert.equal(items[0].price_unknown, true)
  assert.equal(items[1].model_name, 'GB200')
  assert.equal(items[1].price_unknown, true)
})

test('"—"/"-"/빈칸 → price_unknown', () => {
  for (const pt of ['—', '-', '', '문의', 'N/A', 'TBD']) {
    const items = transcriptionToCompetitorItems([row('X', pt)])
    assert.equal(items[0].price_unknown, true, `price_text=${JSON.stringify(pt)}`)
    assert.equal(items[0].price_usd, null)
  }
})

test('2가격(preemptible/on-demand) → 대표가=on-demand(더 비싼 값) 1행, 보조가는 notes', () => {
  // price_text에 두 가격이 "$3.95 / $7.15" 형태로 옴
  const items = transcriptionToCompetitorItems([row('HGX B200', '$3.95 / $7.15')], { provider: 'Nebius' })
  assert.equal(items.length, 1, '모델당 1행(중복 2행 금지)')
  assert.equal(items[0].price_usd, 7.15, '대표가 = on-demand(더 비싼 값)')
  assert.ok(items[0].notes && items[0].notes.includes('3.95'), '보조가는 notes에')
})

test('2가격 — cells에 가격열 2개로 들어와도 대표가 1개 선택', () => {
  const r = row('HGX B300', null, ['$4.30/hr', '$7.85/hr', '800GB'])
  const items = transcriptionToCompetitorItems([r])
  assert.equal(items.length, 1)
  assert.equal(items[0].price_usd, 7.85, 'on-demand 대표')
})

test('cells의 비가격 숫자(메모리 80GB)는 가격으로 오인하지 않음', () => {
  const r = row('H100', '$2.15', ['80GB', '900GB/s'])
  const items = transcriptionToCompetitorItems([r])
  assert.equal(items[0].price_usd, 2.15)
  assert.ok(!items[0].notes, '메모리 숫자는 보조가로 잡히면 안 됨')
})

test('라벨 없는 행은 스킵(경쟁사 후보로 식별 불가)', () => {
  const items = transcriptionToCompetitorItems([row('', '$1.00'), row('H100', '$2.15')])
  assert.equal(items.length, 1)
  assert.equal(items[0].model_name, 'H100')
})

test('provider 미지정 → competitor_name 빈 문자열(호출부가 추론)', () => {
  const items = transcriptionToCompetitorItems([row('H100', '$2.15')])
  assert.equal(items[0].competitor_name, '')
})

test('Nebius 전체 표 — 9모델 전부, H100 둔갑 0, GB300/GB200 price_unknown', () => {
  const rows: TranscriptionRow[] = [
    row('NVIDIA HGX B300', '$4.30 / $7.85'),
    row('NVIDIA HGX B200', '$3.95 / $7.15'),
    row('NVIDIA HGX H200', '$2.45 / $4.50'),
    row('NVIDIA HGX H100', '$2.15 / $3.85'),
    row('RTX PRO 6000', '$0.95 / $1.80'),
    row('L40S', 'from $0.90 / $1.82'),
    row('GB300', 'Contact us'),
    row('GB200', 'Contact us'),
    row('RTX A6000', '$0.50 / $1.00'),
  ]
  const items = transcriptionToCompetitorItems(rows, { provider: 'Nebius' })
  assert.equal(items.length, 9, '9모델 전부 보존(누락 0)')
  // 원문 모델명 그대로 — H100 둔갑 없음(B300/B200이 H100으로 안 바뀜)
  assert.ok(items.some((it) => it.model_name === 'NVIDIA HGX B300'))
  assert.ok(items.some((it) => it.model_name === 'NVIDIA HGX B200'))
  assert.ok(items.some((it) => it.model_name === 'RTX PRO 6000'))
  // B300 대표가 = on-demand 7.85
  const b300 = items.find((it) => it.model_name === 'NVIDIA HGX B300')!
  assert.equal(b300.price_usd, 7.85)
  // GB300/GB200 = price_unknown(드롭 금지)
  const gb300 = items.find((it) => it.model_name === 'GB300')!
  const gb200 = items.find((it) => it.model_name === 'GB200')!
  assert.equal(gb300.price_unknown, true)
  assert.equal(gb200.price_unknown, true)
})

test('비배열 입력 방어', () => {
  assert.deepEqual(transcriptionToCompetitorItems(undefined as unknown as TranscriptionRow[]), [])
})

// ── 관측 성격 obs 부착(P5) — 소프트뱅크 DGX 번들행은 managed_bundle·비교불가로 격리 ──
test('DGX 번들행 → obs.segment=managed_bundle·comparable=false·tax_excluded·month', () => {
  const rows = [{ raw_label: 'NVIDIA DGX H100プラン', price_text: '¥2,500,000/月 税別', cells: ['ストレージ InfiniBand 포함', 'H100 80GB 8장'] }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows, { provider: 'SoftBank' })
  const obs = items[0].obs!
  assert.equal(obs.segment, 'managed_bundle')   // DGX 플랜 → 번들
  assert.equal(obs.comparable, false)            // 콕핏 밴드 제외(참고전용)
  assert.equal(obs.tax_basis, 'tax_excluded')    // 税別
  assert.equal(obs.pricing_unit, 'month')        // /月
  assert.equal(obs.gpu_count, 8)                 // 8장
  assert.equal(obs.bundle_inclusive, true)       // 스토리지·InfiniBand 포함
})
test('순수 GPU 시간임대 → obs.segment=raw_gpu·comparable=true', () => {
  const items = transcriptionToCompetitorItems([{ raw_label: 'H100 SXM', price_text: '$2.79/hr on-demand' }] as unknown as TranscriptionRow[], { provider: 'RunPod' })
  const obs = items[0].obs!
  assert.equal(obs.segment, 'raw_gpu')
  assert.equal(obs.comparable, true)
  assert.equal(obs.pricing_unit, 'hour')
})

// ── 통화 원본보존(W2) ──
test('KRW 입력 — 원본 통화·금액 보존 + krwPerUsd로 USD 환산', () => {
  const rows = [{ raw_label: 'H100', price_text: '₩2,400/hr' }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows, { provider: 'X', krwPerUsd: 1200 })
  assert.equal(items[0].original_currency, 'KRW')
  assert.equal(items[0].original_price, 2400)
  assert.equal(items[0].price_usd, 2) // 2400 / 1200
  assert.equal(items[0].price_unknown, false)
})

test('USD 입력 — original_currency=USD, price_usd=원본', () => {
  const rows = [{ raw_label: 'H100', price_text: '$1.82/hr' }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows, { provider: 'X', krwPerUsd: 1300 })
  assert.equal(items[0].original_currency, 'USD')
  assert.equal(items[0].original_price, 1.82)
  assert.equal(items[0].price_usd, 1.82)
})

test('KRW인데 krwPerUsd 미주입 — 원본은 보존하되 price_usd=null(가격미상)', () => {
  const rows = [{ raw_label: 'H100', price_text: '₩2,400/hr' }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows)
  assert.equal(items[0].original_currency, 'KRW')
  assert.equal(items[0].original_price, 2400)
  assert.equal(items[0].price_usd, null)
  assert.equal(items[0].price_unknown, true)
})

test('통화 미감지(순수 숫자) — original_currency=null(USD 가정 폴백), price_usd=숫자', () => {
  const rows = [{ raw_label: 'H100', price_text: '2.5' }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows, { provider: 'X', krwPerUsd: 1300 })
  assert.equal(items[0].original_currency, null)
  assert.equal(items[0].price_usd, 2.5)
})

// ── 통화 보류(P0-1) — 감지된 비USD·비KRW는 USD 둔갑 금지(일본 사이트 ¥30,000→$30,000 150배 사고 차단) ──
test('JPY(¥) 입력 — 원본 보존하되 price_usd=null(보류). USD로 둔갑 절대 금지', () => {
  const rows = [{ raw_label: 'H100', price_text: '¥30,000/hr' }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows, { provider: 'SoftBank', krwPerUsd: 1300 })
  assert.equal(items[0].original_currency, 'JPY')
  assert.equal(items[0].original_price, 30000)
  assert.equal(items[0].price_usd, null, '¥30,000이 $30,000으로 둔갑하면 안 됨')
  assert.equal(items[0].price_unknown, true)
})

test('円 표기 JPY도 동일 보류', () => {
  const rows = [{ raw_label: 'A100', price_text: '7,200円/月' }] as unknown as TranscriptionRow[]
  const items = transcriptionToCompetitorItems(rows, { provider: 'SoftBank', krwPerUsd: 1300 })
  assert.equal(items[0].original_currency, 'JPY')
  assert.equal(items[0].price_usd, null)
  assert.equal(items[0].price_unknown, true)
})

test('EUR(€)·CNY(元) 입력 — 환율 미지원 통화 전부 보류(둔갑 금지)', () => {
  for (const [pt, cur] of [['€2,50/hr', 'EUR'], ['元18/hr', 'CNY']] as const) {
    const items = transcriptionToCompetitorItems([{ raw_label: 'H100', price_text: pt }] as unknown as TranscriptionRow[], { provider: 'X', krwPerUsd: 1300 })
    assert.equal(items[0].original_currency, cur, `${pt} → ${cur}`)
    assert.equal(items[0].price_usd, null, `${pt}는 USD 둔갑 금지`)
    assert.equal(items[0].price_unknown, true)
  }
})

// ── 요금성분 회수 결선(v0.7.351 T1.3) — 소프트뱅크 A100 時間貸し(기본료+종량+스토리지) 무손실 흡수 ──
test('소프트뱅크 A100 시간제 — 기본료·종량·스토리지 3성분이 A100 후보 1건에 흡수됨(비GPU 라벨 행은 별도 후보로 새지 않음)', () => {
  const rows: TranscriptionRow[] = [
    row('NVIDIA A100 時間貸しプラン', null, []),
    row('月額基本料金', '30,000円', []),
    row('GPU利用料金（1枚あたり）', '7.2円/1分', []),
    row('データストアストレージ（月額）', '1,000円/100GB', []),
  ]
  const fxMap = { JPY: 9.5, USD: 1400 }
  const items = transcriptionToCompetitorItems(rows, { provider: 'SoftBank', krwPerUsd: 1400, fxMap })

  // 기본료/종량/스토리지 라벨 행은 각자 후보로 새지 않고 A100 1건으로 흡수됨(무손실 회수 — 드롭 0)
  assert.equal(items.length, 1, '비GPU 라벨 3행이 별도 후보로 새지 않고 흡수됨')
  const a100 = items[0]
  assert.equal(a100.model_name, 'NVIDIA A100 時間貸しプラン')
  assert.equal(a100.components?.length, 3, '기본료+종량+스토리지 3성분 전량 회수')
  const base = a100.components!.find((c) => c.component_kind === 'base_fee')!
  assert.equal(base.amount, 30_000); assert.equal(base.currency, 'JPY'); assert.equal(base.unit, 'month')
  const usage = a100.components!.find((c) => c.component_kind === 'usage')!
  assert.equal(usage.amount, 7.2); assert.equal(usage.unit, 'minute')
  const storage = a100.components!.find((c) => c.component_kind === 'storage')!
  assert.equal(storage.amount, 10); assert.equal(storage.unit, 'per_gb')

  // 대표가 — usage 성분(GPU 종량)으로 갱신, price_unknown 해소(기본료/스토리지는 시간축 아니라 제외)
  assert.equal(a100.price_unknown, false)
  // 7.2 JPY/min × 9.5(fx) × 60(분→시) ÷ 1400(krwPerUsd)
  const expectUsd = (7.2 * 9.5 * 60) / 1400
  assert.ok(Math.abs(a100.price_usd! - expectUsd) < 1e-6, `기대 ${expectUsd}, 실제 ${a100.price_usd}`)
  assert.equal(a100.original_currency, 'JPY')
  assert.equal(a100.original_price, 7.2)
})

test('fxMap 미주입 — 성분은 부착되지만 대표가는 갱신되지 않음(price_unknown 유지, 보류)', () => {
  const rows: TranscriptionRow[] = [
    row('NVIDIA A100 時間貸しプラン', null, []),
    row('GPU利用料金（1枚あたり）', '7.2円/1分', []),
  ]
  const items = transcriptionToCompetitorItems(rows, { provider: 'SoftBank', krwPerUsd: 1400 })
  assert.equal(items.length, 1)
  assert.equal(items[0].components?.length, 1)
  assert.equal(items[0].price_unknown, true, 'fxMap 없이는 JPY 대표가 확정 불가 — 보류 유지')
  assert.equal(items[0].price_usd, null)
})

test('직전 GPU 모델 없이 나오는 비GPU 라벨 행 — 기존 동작 그대로(별도 후보, 결국 필터링 대상)', () => {
  const rows: TranscriptionRow[] = [row('月額基本料金', '30,000円', [])]
  const items = transcriptionToCompetitorItems(rows, { provider: 'SoftBank' })
  assert.equal(items.length, 1, '흡수 대상 모델이 없으면 기존처럼 자기 자신이 후보(다운스트림에서 걸러짐)')
  assert.equal(items[0].model_name, '月額基本料金')
})

// [실화면 회귀고정 v0.7.352] 산문형 복합요금 회수 — 행 구조 없는 한 덩어리 입력.
//   사고: 성분 흡수를 "직전 행이 GPU 모델"이라는 행 구조에 의존시켰더니, 실제 소프트뱅크 원문처럼
//   산문 1블록으로 들어오면 전사가 행을 못 쪼개 3성분이 통째로 유실됐다(실화면 $0.00·가격미상).
//   단위테스트는 이미 행으로 정리된 입력을 먹고 있어 이를 못 잡았다 → 실제 원문 그대로 박제한다.
test('실화면 회귀 — 소프트뱅크 산문 원문에서 3성분 전량 회수 + 대표가 산출', () => {
  const REAL = 'ソフトバンク AIデータセンター GPUサーバー 料金例（税抜） サービス NVIDIA A100 時間貸しプラン 月額基本料金 30,000円 GPU利用料金（1枚あたり） 7.2円/1分 データストアストレージ（月額） 1,000円/100GB'
  const items = proseToCompetitorItems(REAL, { provider: 'SoftBank', krwPerUsd: 1484, fxMap: { JPY: 9.134 } })
  assert.equal(items.length, 1, '후보 1건')
  const it = items[0]
  assert.equal(it.competitor_name, 'SoftBank')
  assert.equal(it.model_name, 'A100')
  assert.equal(it.components?.length, 3, '기본료·종량·스토리지 3성분(누락=무음 손실)')

  const byKind = Object.fromEntries((it.components ?? []).map((c) => [c.component_kind, c]))
  assert.equal(byKind.base_fee.amount, 30_000)
  assert.equal(byKind.base_fee.unit, 'month', '月額 주기 보존')
  assert.equal(byKind.usage.amount, 7.2)
  assert.equal(byKind.usage.unit, 'minute')
  assert.equal(byKind.storage.amount, 10, '1,000円/100GB → 1GB 단가(미정규화 시 100배)')
  assert.equal(byKind.storage.unit, 'per_gb')

  // 대표가는 usage 성분에서만 — 7.2엔/분 ×60 = 432엔/hr → ×9.134 ÷1484
  assert.equal(it.price_unknown, false)
  assert.ok(Math.abs(it.price_usd! - (7.2 * 60 * 9.134) / 1484) < 1e-6, `실제 ${it.price_usd}`)
})

test('실화면 회귀 — 환율 미보유면 성분은 붙되 대표가는 보류(AI 추정가 유입 금지)', () => {
  const REAL = 'NVIDIA A100 時間貸しプラン 月額基本料金 30,000円 GPU利用料金 7.2円/1分'
  const items = proseToCompetitorItems(REAL, { provider: 'SoftBank', krwPerUsd: 1484 })
  assert.equal(items[0].components?.length, 2)
  assert.equal(items[0].price_unknown, true, '환율 없으면 보류')
  assert.equal(items[0].price_usd, null)
})
