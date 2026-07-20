// 한국수출입은행 AP01 응답 파서 (SSOT, 순수함수).
//   AP01은 전 통화를 한 번에 반환. cur_unit이 "JPY(100)"·"IDR(100)" 형태(100단위 고시)라
//   반드시 per_unit으로 나눠 "1통화당 KRW"로 정규화(미처리 시 100배 사고). deal_bas_r은 콤마 포함 문자열.
//   확정 기획 P2: docs/2026-07-20-.../02-CONFIRMED.md

export interface KoraeximRow {
  result?: number
  cur_unit?: string   // "USD" | "JPY(100)" | "CNH" ...
  cur_nm?: string
  deal_bas_r?: string // "1,342.5" (콤마 포함)
}

export interface FxRateNormalized {
  currency: string      // ISO4217 정규화 (CNH→CNY)
  per_unit: number      // 고시 단위 (JPY/IDR=100, 그 외 1)
  deal_bas_krw: number  // 원문 매매기준율(per_unit당 KRW)
  krw_per_1: number     // 1통화당 KRW = deal_bas_krw / per_unit
}

// 수출입은행 통화코드 → ISO4217. 위안화 역외(CNH)를 CNY로 통일. 그 외는 그대로.
const CODE_ALIAS: Record<string, string> = { CNH: 'CNY' }

/** "JPY(100)" → { code:'JPY', per_unit:100 }. "USD" → { code:'USD', per_unit:1 }. */
export function parseCurUnit(curUnit: string): { code: string; per_unit: number } | null {
  if (typeof curUnit !== 'string') return null
  const m = curUnit.trim().match(/^([A-Za-z]{3})(?:\((\d+)\))?$/)
  if (!m) return null
  const raw = m[1].toUpperCase()
  const code = CODE_ALIAS[raw] ?? raw
  const per_unit = m[2] ? parseInt(m[2], 10) : 1
  return per_unit > 0 ? { code, per_unit } : null
}

/** deal_bas_r("1,342.5") → 1342.5. 숫자 아니면 null. */
export function parseDealBas(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** AP01 rows → 통화별 정규화 환율[]. result!=1(성공 아님)이거나 파싱 실패 행은 스킵(무손실 로그는 호출부). */
export function parseKoraeximRows(rows: unknown): FxRateNormalized[] {
  if (!Array.isArray(rows)) return []
  const out: FxRateNormalized[] = []
  for (const r of rows as KoraeximRow[]) {
    if (!r || typeof r !== 'object') continue
    if (typeof r.result === 'number' && r.result !== 1) continue // 1=정상
    const cu = parseCurUnit(r.cur_unit ?? '')
    const deal = parseDealBas(r.deal_bas_r)
    if (!cu || deal == null) continue
    out.push({
      currency: cu.code,
      per_unit: cu.per_unit,
      deal_bas_krw: deal,
      krw_per_1: deal / cu.per_unit, // 100단위 정규화 — 100배 사고 방지
    })
  }
  return out
}
