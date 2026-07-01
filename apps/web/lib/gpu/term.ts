// 약정(term) 정규화 SSOT — 제각각 표기(on-demand, reserved 6개월, 1년약정, RI-12, spot…)를 표준 term 문자열로.
// 저장·표시·확정 경로가 동일 함수를 import해 재사용(복붙 금지). 미지 표기도 버리지 않고 보존(무음 금지).
// 표준값: 'on_demand' | 'spot' | 'reserved_<N>m'(N=개월) | 'reserved'(기간불명) | 그 외 정규화 원문.

/** 문자열에서 약정 개월 수 추출 — "1year"/"1년"→12, "3년"→36, "6개월"/"6month"/"6m"/"reserved_6m"→6. 없으면 null. */
function extractMonths(s: string): number | null {
  const lower = s.toLowerCase()
  // 연 단위 우선(년/year/yr) — \b는 한글(년)에서 안 먹으므로 미사용. 정수만.
  const yr = lower.match(/(\d+)\s*(?:년|years?|yrs?)/)
  if (yr) {
    const n = parseInt(yr[1], 10)
    if (n > 0 && n <= 10) return n * 12
  }
  // 월 단위(개월/월/month/mo).
  const mo = lower.match(/(\d+)\s*(?:개월|months?|mos?|mo|월)/)
  if (mo) {
    const n = parseInt(mo[1], 10)
    if (n > 0 && n <= 120) return n
  }
  // 축약 'Nm'(reserved_6m, 6m) — m 뒤에 다른 알파벳이 없을 때만(6meters 오매칭 방지).
  const bare = lower.match(/(\d+)\s*m(?![a-z])/)
  if (bare) {
    const n = parseInt(bare[1], 10)
    if (n > 0 && n <= 120) return n
  }
  return null
}

/**
 * 약정 표기 → 표준 term. 빈값/미지정은 on_demand(대표 요금제).
 * on-demand 계열 / spot 계열 / 개월수 있는 reserved(reserved_Nm) / 기간불명 reserved / 그 외 정규화 원문.
 */
export function normalizeTerm(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim()
  if (!s) return 'on_demand'
  const k = s.toLowerCase().replace(/[\s_-]+/g, '')

  if (k === 'ondemand' || k === 'od') return 'on_demand'
  if (k === 'spot' || k === 'preemptible' || k === 'preemptable') return 'spot'

  const months = extractMonths(s)
  if (months != null) return `reserved_${months}m`

  if (k.includes('reserved') || k.includes('committed') || k.includes('commitment') || s.includes('약정')) return 'reserved'

  // 알 수 없는 표기 — 원문을 정규화 키로 보존(무음 폐기 금지). 빈 키만 on_demand로.
  // 길이 캡(64) — 비정상 장문 입력이 term 컬럼을 오염시키지 않게 방어(DC-SEC LOW).
  return (k || 'on_demand').slice(0, 64)
}

/** on_demand 여부 — 전략가(strategic_price_krw) 미러 대상 판별. */
export function isOnDemand(term: unknown): boolean {
  return normalizeTerm(term) === 'on_demand'
}

/** 사람이 읽는 약정 라벨 — 'reserved_6m'→'약정 6개월', 'on_demand'→'온디맨드', 'spot'→'스팟'. */
export function termLabel(term: string): string {
  if (term === 'on_demand') return '온디맨드'
  if (term === 'spot') return '스팟'
  if (term === 'reserved') return '약정'
  const m = term.match(/^reserved_(\d+)m$/)
  if (m) {
    const n = parseInt(m[1], 10)
    return n % 12 === 0 ? `약정 ${n / 12}년` : `약정 ${n}개월`
  }
  return term
}
