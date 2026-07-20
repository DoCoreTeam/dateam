// 결정론 추출 SSOT (v0.7.351 재설계 §2) — 구조화 텍스트(htmlToStructuredText 결과)에서
//   AI 없이 파이프표·라벨산문을 파싱해 관측+요금성분으로 복원. 같은 입력→같은 결과(결정론).
//   AI는 이 결정론이 못 잡은 잔여만 보완. "무엇이 가격인가" 판단을 코드가 1차로 확정.
import { canonicalizeModel } from './canonical-model.ts'
import { looksLikeGpuModel } from './validate.ts'
import { resolveGpuCount } from './normalize-money.ts'
import type { PriceComponent } from './price-components.ts'

export interface DetObservation {
  model_name: string             // 캐노니컬(H100 등)
  source_model_name: string      // 원본 라벨
  segment: 'raw_gpu' | 'managed_bundle'
  components: PriceComponent[]
  provenance: string
}

// 전각/반각 통화 정규화 후 금액 파싱. 円/¥/￥/₩/$/€ + 숫자.
const CURRENCY_RE = /[¥￥$₩€]|円|원|krw|usd|jpy/i
function parseAmount(cell: string): number | null {
  const m = cell.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}
// 전각 ￥(U+FFE5)·円 등 어떤 표기든 JPY로 (소프트뱅크 GB200만 전각 ￥ 쓰는 사고 방어).
function currencyOf(cell: string): string {
  if (/[¥￥]|円|jpy/i.test(cell)) return 'JPY'
  if (/[$]|usd/i.test(cell)) return 'USD'
  if (/[₩]|원|krw/i.test(cell)) return 'KRW'
  if (/[€]|eur/i.test(cell)) return 'EUR'
  return 'JPY' // 円 컨텍스트 기본(호출부가 국가 힌트로 상위 확정)
}

const splitPipe = (line: string): string[] => line.split('|').map((s) => s.trim())

/**
 * 파이프 비교표(월정액) → flat 관측. 헤더행(GPU모델 다수) + 가격행(통화 다수) 열정렬 복원.
 *   각 열 = 1 관측(flat 성분 1개). segment=managed_bundle(월정액 세트는 번들 성격, Sprint3서 트랙 분리).
 */
export function parsePivotFlat(structuredText: string): DetObservation[] {
  const lines = structuredText.split('\n').filter((l) => l.includes('|'))
  const rows = lines.map(splitPipe)
  const priceRow = rows.find((cells) => cells.filter((c) => CURRENCY_RE.test(c) && parseAmount(c) != null).length >= 2)
  if (!priceRow) return []
  // 다중 표 정렬 사고 방지: 모델·장수 행은 가격행과 "같은 열수(=같은 표)"인 것만 채택.
  //   (사양표 4열·요금예 3열이 공존하면 열 인덱스가 어긋나 GB200 장수/가격이 오정렬 → 실효비용 오류)
  const sameWidth = (cells: string[]) => cells.length === priceRow.length
  const modelRow = rows.find((cells) => sameWidth(cells) && cells.filter((c) => looksLikeGpuModel(c)).length >= 2)
  if (!modelRow) return []
  // 장수 힌트 행(× N / N枚) — 같은 표에서만.
  const countRow = rows.find((cells) => cells !== priceRow && sameWidth(cells) && cells.some((c) => /[×x]\s*\d|枚|장/.test(c)))
  const width = Math.min(modelRow.length, priceRow.length)
  const out: DetObservation[] = []
  for (let i = 0; i < width; i++) {
    const rawModel = modelRow[i] ?? ''
    const modelCell = looksLikeGpuModel(rawModel) ? rawModel : (looksLikeGpuModel(countRow?.[i] ?? '') ? countRow![i] : '')
    if (!modelCell) continue
    const priceCell = priceRow[i] ?? ''
    if (!CURRENCY_RE.test(priceCell)) continue
    const amount = parseAmount(priceCell)
    if (amount == null) continue
    const gpuCount = resolveGpuCount(`${countRow?.[i] ?? ''} ${rawModel}`)
    const canon = canonicalizeModel(modelCell).canonical || modelCell
    out.push({
      model_name: canon,
      source_model_name: modelCell,
      segment: 'managed_bundle',
      components: [{
        component_kind: 'flat', amount, currency: currencyOf(priceCell),
        unit: 'month', gpu_count: gpuCount, provenance: `${modelCell} | ${priceCell}`,
      }],
      provenance: `pivot: ${modelCell} | ${priceCell}`.slice(0, 200),
    })
  }
  return out
}

/**
 * 라벨산문(시간제) → 관측+복합성분. 소프트뱅크 A100 時間貸し류:
 *   "月額基本料金 30,000円"(base_fee/month/per_account), "GPU利用料금 7.2円/1分"(usage/minute/1장),
 *   "1,000円/100GB"(storage/per_gb). 표(파이프)가 아니라 산문이라 파이프 파서가 못 잡는 것을 회수.
 */
export function parseHourlyProse(structuredText: string, model?: string): DetObservation | null {
  const t = structuredText
  const comps: PriceComponent[] = []
  // 모델 미지정 시 자동 감지 — 기본료(基本料金) 매치 위치 직전의 가장 가까운 GPU 모델 토큰.
  //   (소프트뱅크 "… NVIDIA A100 時間貸しプラン 月額基本料金 …" → A100)
  let detected = model
  if (!detected) {
    const baseIdx = t.search(/基本料金|時間貸|従量|per\s*minute|\/\s*1?\s*分/i)
    const before = baseIdx > 0 ? t.slice(Math.max(0, baseIdx - 120), baseIdx) : ''
    const words = before.split(/[\s|:：、]+/).filter(Boolean)
    for (let i = words.length - 1; i >= 0; i--) { if (looksLikeGpuModel(words[i])) { detected = words[i]; break } }
  }
  if (!detected) return null
  // 기본료: "基本料金 30,000円" / "월 기본료 30000원"
  //   단위: per_account(계정 고정비 — scenario-cost가 월액으로 합산). 月額 등 원문 주기는 provenance에 보존.
  const base = t.match(/(月額|월)?\s*基本料金[^0-9]{0,6}(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(円|¥|￥|원)/)
  if (base) comps.push({ component_kind: 'base_fee', amount: parseFloat(base[2].replace(/,/g, '')), currency: currencyOf(base[3]), unit: base[1] ? 'month' : 'per_account', provenance: base[0] })
  // 종량: "7.2円/1分" (1枚あたり=1장)
  const usage = t.match(/(\d+(?:\.\d+)?)\s*(円|¥|￥|원)\s*\/\s*1?\s*(分|時間|hour|min)/)
  if (usage) {
    const unit = /分|min/.test(usage[3]) ? 'minute' : 'hour'
    comps.push({ component_kind: 'usage', amount: parseFloat(usage[1]), currency: currencyOf(usage[2]), unit, gpu_count: 1, provenance: usage[0] })
  }
  // 스토리지: "1,000円/100GB" → unit=per_gb이므로 **1GB당 단가로 정규화**해야 한다(÷100 = 10円/GB).
  //   정규화 없이 1,000을 per_gb로 저장하면 100배 과대계상(scenario-cost가 amount×사용GB로 곱함).
  //   원문은 provenance에 보존(무손실). 분모 0/결측은 방어.
  const stor = t.match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(円|¥|￥|원)\s*\/\s*(\d+)\s*GB/i)
  if (stor) {
    const perBlock = parseFloat(stor[1].replace(/,/g, ''))
    const gbPerBlock = parseInt(stor[3], 10)
    if (Number.isFinite(perBlock) && gbPerBlock > 0) {
      comps.push({ component_kind: 'storage', amount: perBlock / gbPerBlock, currency: currencyOf(stor[2]), unit: 'per_gb', provenance: `${stor[0]} (per ${gbPerBlock}GB → 1GB 단가 정규화)` })
    }
  }
  if (comps.length === 0) return null
  const canon = canonicalizeModel(detected).canonical || detected
  return { model_name: canon, source_model_name: detected, segment: 'raw_gpu', components: comps, provenance: 'prose:hourly' }
}
