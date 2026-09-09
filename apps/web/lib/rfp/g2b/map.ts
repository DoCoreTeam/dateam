/**
 * 나라장터 응답을 우리 칸으로 (설계서 3.2.3)
 *
 * ## 원본을 통째로 남기는 이유
 *
 * 공공데이터포털 필드 이름은 **말없이 바뀐다.** 우리가 아는 칸만 저장하면
 * 바뀐 뒤에야 「그 값이 원래 있었나」를 확인할 수 없다.
 * 그래서 사상한 값과 함께 `raw` 에 응답 전체를 둔다.
 *
 * ## 금액 셋을 구분한다
 *
 * 배정예산·추정가격·기초금액은 다른 숫자다. 하나로 접으면
 * 제안 가격 계산이 통째로 틀린다.
 */

export interface SourceRow {
  sourceSystem: 'g2b'
  noticeNo: string | null
  noticeRound: number | null
  title: string | null
  announcingAgency: string | null
  demandAgency: string | null
  /** 배정예산 */
  budgetAmount: number | null
  /** 추정가격 */
  estimatedPrice: number | null
  /** 기초금액 */
  basePrice: number | null
  noticeDate: string | null
  bidOpenAt: string | null
  contractMethod: string | null
  awardMethod: string | null
  isItProject: boolean | null
  isUrgent: boolean | null
  raw: Record<string, unknown>
}

/** 나라장터 필드 이름 → 우리 칸. 이름이 바뀌면 여기 한 곳만 고친다 */
const FIELD = {
  noticeNo: ['bidNtceNo'],
  noticeRound: ['bidNtceOrd'],
  title: ['bidNtceNm'],
  announcingAgency: ['ntceInsttNm'],
  demandAgency: ['dminsttNm'],
  budgetAmount: ['asignBdgtAmt'],
  estimatedPrice: ['presmptPrce'],
  basePrice: ['bssamt'],
  noticeDate: ['bidNtceDt', 'bidNtceDate'],
  bidOpenAt: ['opengDt'],
  contractMethod: ['cntrctCnclsMthdNm'],
  awardMethod: ['sucsfbidMthdNm'],
} as const

function first(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return null
}

/** 「1,234,000」 「1234000원」 을 숫자로 */
export function toAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v).replace(/[\s,원]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 「20260410」 「2026-04-10 14:00:00」 을 ISO 로 */
export function toIsoDateTime(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?$/)
  if (compact) {
    const [, y, m, d, hh, mm] = compact
    return hh ? `${y}-${m}-${d}T${hh}:${mm}:00+09:00` : `${y}-${m}-${d}`
  }
  const loose = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (loose) {
    const [, y, m, d, hh, mm] = loose
    const mm2 = String(Number(m)).padStart(2, '0')
    const dd = String(Number(d)).padStart(2, '0')
    return hh ? `${y}-${mm2}-${dd}T${String(Number(hh)).padStart(2, '0')}:${mm}:00+09:00` : `${y}-${mm2}-${dd}`
  }
  return null
}

/** 날짜만 (date 칸용) */
export function toIsoDate(v: unknown): string | null {
  const iso = toIsoDateTime(v)
  return iso ? iso.slice(0, 10) : null
}

/** IT 사업인가 — 업종·품명에서 알아본다 */
const IT_HINTS = ['소프트웨어', '정보시스템', '시스템 구축', '정보화', '데이터', '인공지능', 'AI', '클라우드', '전산']

export function looksItProject(row: Record<string, unknown>): boolean | null {
  const text = [row.bidNtceNm, row.ntceKindNm, row.indstrytyNm]
    .filter((v) => typeof v === 'string')
    .join(' ')
  if (!text) return null
  return IT_HINTS.some((h) => text.includes(h))
}

/** 긴급 공고인가 */
export function looksUrgent(row: Record<string, unknown>): boolean | null {
  const text = [row.bidNtceNm, row.ntceKindNm].filter((v) => typeof v === 'string').join(' ')
  if (!text) return null
  return /긴급|재공고/.test(text)
}

/**
 * 응답 한 건을 `rfp_sources` 행으로 옮긴다.
 *
 * 모르는 필드는 버리지 않고 `raw` 에 남는다.
 */
export function toSourceRow(row: Record<string, unknown>): SourceRow {
  return {
    sourceSystem: 'g2b',
    noticeNo: strOf(first(row, FIELD.noticeNo)),
    noticeRound: numOf(first(row, FIELD.noticeRound)),
    title: strOf(first(row, FIELD.title)),
    announcingAgency: strOf(first(row, FIELD.announcingAgency)),
    demandAgency: strOf(first(row, FIELD.demandAgency)),
    // 배정예산·추정가격·기초금액은 다른 숫자다. 하나로 접으면 제안 가격이 틀린다
    budgetAmount: toAmount(first(row, FIELD.budgetAmount)),
    estimatedPrice: toAmount(first(row, FIELD.estimatedPrice)),
    basePrice: toAmount(first(row, FIELD.basePrice)),
    noticeDate: toIsoDate(first(row, FIELD.noticeDate)),
    bidOpenAt: toIsoDateTime(first(row, FIELD.bidOpenAt)),
    contractMethod: strOf(first(row, FIELD.contractMethod)),
    awardMethod: strOf(first(row, FIELD.awardMethod)),
    isItProject: looksItProject(row),
    isUrgent: looksUrgent(row),
    // 필드 이름이 말없이 바뀐다. 원본을 남겨야 그때 확인할 수 있다
    raw: row,
  }
}

function strOf(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v).trim() || null
}

function numOf(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

/** DB 칸 이름으로 바꾼다 — insert 에 그대로 넘긴다 */
export function toDbColumns(row: SourceRow, orgId: string): Record<string, unknown> {
  return {
    org_id: orgId,
    source_system: row.sourceSystem,
    notice_no: row.noticeNo,
    notice_round: row.noticeRound,
    title: row.title,
    announcing_agency: row.announcingAgency,
    demand_agency: row.demandAgency,
    budget_amount: row.budgetAmount,
    estimated_price: row.estimatedPrice,
    base_price: row.basePrice,
    notice_date: row.noticeDate,
    bid_open_at: row.bidOpenAt,
    contract_method: row.contractMethod,
    award_method: row.awardMethod,
    is_it_project: row.isItProject,
    is_urgent: row.isUrgent,
    raw: row.raw,
  }
}
