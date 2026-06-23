// 행수 대조(Reconciliation) SSOT — 순수함수. 전사 원본 행수 vs 최종 추출건수를 비교해 누락을 가시화한다.
// 왜: 추출이 원본보다 적으면 행이 조용히 사라진 것 — 침묵을 제거하고 UI에 "원본 N행 중 M행 — 누락 X행(라벨)"로 경고.
// 도메인 판단 없음. 단순·테스트가능. 호출부는 결과를 SSE/done payload에 그대로 싣는다.

export interface ReconcileExtractedLike {
  /** 전사 원문 모델명(보존값) — 라벨 대조에 우선 사용. 신뢰 불가 입력이라 unknown 허용(내부 정규화). */
  source_model_name?: unknown
  /** 추출/매핑된 모델명 — source_model_name이 없을 때 폴백 대조 */
  model_name?: unknown
}

export interface ReconcileResult {
  /** 전사가 센 원본 행 수 */
  source_rows: number
  /** 최종 추출건수 */
  extracted: number
  /** 누락 의심 행 수 = max(0, source_rows - extracted) */
  missing: number
  /** 추출결과에 없는 전사 라벨들(가능한 경우) — 사용자 경고 표시용 */
  missing_labels: string[]
}

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

/** reconcile 옵션 */
export interface ReconcileOptions {
  /**
   * distinct 모델명 기준으로 누락 산출(행수 기준 대신).
   * 왜: 모델당 2가격(preemptible/on-demand)을 2행으로 전개하면 extracted가 부풀려져
   *   행수 기준 missing이 0이 되어 실제 누락(예 GB300/GB200)을 못 잡는다.
   *   모델 기준이면 같은 모델 여러 행이 1개로 합쳐져 누락이 드러난다.
   */
  byDistinctModel?: boolean
}

/**
 * 행수 대조. 순수함수(부수효과 없음).
 * @param sourceRowCount 전사 원본 행 수(byDistinctModel일 땐 distinct 모델 수의 기준값)
 * @param extracted 최종 추출 항목들(원문 모델명 source_model_name 보존)
 * @param sourceLabels (선택) 전사 raw_label 목록 — 있으면 missing_labels를 라벨 차집합으로 산출
 * @param opts (선택) byDistinctModel: 누락을 distinct 모델 기준으로 산출
 */
export function reconcile(
  sourceRowCount: number,
  extracted: ReconcileExtractedLike[],
  sourceLabels?: string[],
  opts?: ReconcileOptions,
): ReconcileResult {
  const source_rows = Number.isFinite(sourceRowCount) ? Math.max(0, Math.floor(sourceRowCount)) : 0
  const items = Array.isArray(extracted) ? extracted : []

  // 추출 결과가 보유한 라벨(원문 우선, 없으면 매핑명) — 정규화 키 집합
  const extractedKeys = new Set<string>()
  for (const it of items) {
    const k = norm(it?.source_model_name) || norm(it?.model_name)
    if (k) extractedKeys.add(k)
  }

  // extracted 카운트: 모델 기준이면 distinct 모델 수, 아니면 행수.
  //   모델 기준은 라벨 차집합과 정합 — 2가격/모델 전개로 missing이 0으로 무력화되는 것 차단.
  const extractedCount = opts?.byDistinctModel ? extractedKeys.size : items.length
  const missing = Math.max(0, source_rows - extractedCount)

  // 전사 라벨이 주어지면: 추출에 없는 라벨을 누락 후보로(중복 제거, 원문 표기 유지).
  let missing_labels: string[] = []
  if (Array.isArray(sourceLabels) && sourceLabels.length > 0) {
    const seen = new Set<string>()
    for (const label of sourceLabels) {
      const raw = typeof label === 'string' ? label.trim() : ''
      if (!raw) continue
      const key = raw.toLowerCase()
      if (extractedKeys.has(key) || seen.has(key)) continue
      seen.add(key)
      missing_labels.push(raw)
    }
    // 라벨 차집합이 missing 수보다 많으면(중복 추출 등) 표시는 missing 수만큼만 — 과경고 방지
    if (missing_labels.length > missing) missing_labels = missing_labels.slice(0, missing)
  }

  return { source_rows, extracted: extractedCount, missing, missing_labels }
}
