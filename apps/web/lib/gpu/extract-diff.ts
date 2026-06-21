// 재분석 결과 diff SSOT — 이전 추출(extracted)과 재분석 후 추출을 비교해
// "무엇이 바뀌었는가"를 필드 단위 before/after 목록으로 산출. 표시 로직은 뷰가 import만.
// 정책: 같은 비교를 여러 뷰가 복붙하지 않도록 단일 구현(재사용·단일구현 정책).

export interface FieldDiff {
  field: string
  label: string
  before: unknown
  after: unknown
}

// 사람이 검토하는 핵심 필드 라벨 (없는 키는 원문 키 노출)
const FIELD_LABELS: Record<string, string> = {
  model_name: '모델명',
  unit_price_usd: '단가 (USD/hr)',
  supplier: '공급사',
  term: '약정',
  term_months: '약정 (개월)',
  valid_until: '유효기간',
  min_qty: '최소 수량',
  memory: '메모리',
  tier: 'tier',
  gpu_count: 'GPU 장수',
  original_price: '원본가',
  original_currency: '원본 통화',
  original_unit: '원본 단위',
  setup_fee_krw: '설치비 (KRW)',
  monthly_price_krw: '월 단가 (KRW)',
  billing_model: '과금 유형',
}

// diff에서 제외할 큰/내부 필드 (원문 텍스트·AI 응답 래퍼 등은 비교 의미 없음)
const EXCLUDED_FIELDS = new Set(['original_text', 'notes', 'evidence', 'items', 'impact_assessment', 'provenance', 'usai'])

// 라벨이 있는 핵심 필드를 위로, 그 외는 아래로 정렬
const FIELD_ORDER = Object.keys(FIELD_LABELS)

function normalizeValue(v: unknown): unknown {
  return v === undefined ? null : v
}

/** 값 동등 비교 — 원시값은 문자열화 비교(숫자 1 == "1" 취급), 객체/배열은 JSON 비교. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeValue(a)
  const nb = normalizeValue(b)
  if (na === null && nb === null) return true
  if (na === null || nb === null) return false
  const aObj = typeof na === 'object'
  const bObj = typeof nb === 'object'
  if (aObj || bObj) {
    try {
      return JSON.stringify(na) === JSON.stringify(nb)
    } catch {
      return false
    }
  }
  return String(na) === String(nb)
}

/**
 * 이전 추출 vs 재분석 후 추출 → 변경된 필드 목록.
 * 추가(이전 null→새 값)·삭제(값→null)·변경 모두 포함. 무변경 필드는 제외.
 */
// 재분석 AI 응답 정규화 — 모델이 형태를 바꿔도(단일 {extracted}/멀티 {items:[{extracted}]}/평탄 JSON)
// 일관된 extracted/confidence/evidence를 뽑아낸다. (형태 미스매치로 재분석이 조용히 무시되던 버그 방지)
const REANALYZE_META = new Set(['extracted', 'confidence', 'evidence', 'impact_assessment', 'change_summary', 'items'])

export interface NormalizedReanalysis {
  extracted: Record<string, unknown>
  confidence: Record<string, number | null>
  evidence: Record<string, unknown>
}

export function normalizeReanalysis(
  reExtracted: Record<string, unknown> | null | undefined,
  fallbackExtracted: Record<string, unknown> | null | undefined,
): NormalizedReanalysis {
  const re = reExtracted ?? {}
  const items = re.items
  const firstItem = Array.isArray(items) && items[0] && typeof items[0] === 'object'
    ? (items[0] as Record<string, unknown>)
    : null
  const src = firstItem ?? re
  const nested = src.extracted

  let extracted: Record<string, unknown>
  if (nested && typeof nested === 'object' && Object.keys(nested).length > 0) {
    extracted = nested as Record<string, unknown>
  } else {
    const flat = Object.fromEntries(Object.entries(re).filter(([k]) => !REANALYZE_META.has(k)))
    extracted = Object.keys(flat).length > 0 ? flat : (fallbackExtracted ?? {})
  }

  const confidence = (src.confidence && typeof src.confidence === 'object'
    ? src.confidence
    : (re.confidence && typeof re.confidence === 'object' ? re.confidence : {})) as Record<string, number | null>
  const evidence = (src.evidence && typeof src.evidence === 'object'
    ? src.evidence
    : (re.evidence && typeof re.evidence === 'object' ? re.evidence : {})) as Record<string, unknown>

  return { extracted, confidence, evidence }
}

export function diffExtracted(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldDiff[] {
  const b = before ?? {}
  const a = after ?? {}
  const seen: Record<string, true> = {}
  const keys: string[] = []
  for (const k of [...Object.keys(b), ...Object.keys(a)]) {
    if (!seen[k]) { seen[k] = true; keys.push(k) }
  }
  const out: FieldDiff[] = []
  for (const k of keys) {
    if (EXCLUDED_FIELDS.has(k)) continue
    if (valuesEqual(b[k], a[k])) continue
    out.push({
      field: k,
      label: FIELD_LABELS[k] ?? k,
      before: normalizeValue(b[k]),
      after: normalizeValue(a[k]),
    })
  }
  out.sort((x, y) => {
    const ix = FIELD_ORDER.indexOf(x.field)
    const iy = FIELD_ORDER.indexOf(y.field)
    if (ix === -1 && iy === -1) return x.field.localeCompare(y.field)
    if (ix === -1) return 1
    if (iy === -1) return -1
    return ix - iy
  })
  return out
}
