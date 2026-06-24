import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcriptionToCompetitorItems } from './transcription-to-items.ts'
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
