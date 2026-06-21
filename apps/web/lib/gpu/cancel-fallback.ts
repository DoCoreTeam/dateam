// 공급가 '지정 취소' 후 귀결 판정 (SSOT, 자기완결 → node:test 대상)
//   백엔드 cost_basis 자동선택 후보 정의(= status='confirmed' 인 cost 견적, list 제외)와 동일 규칙으로,
//   프론트가 취소 결과(auto/list/none)와 자동 적용될 공급사를 정확히 예측한다.
//   (DC-REV HIGH-1: 만료/반려 견적을 자동후보로 거짓표시 방지 — confirmed만, 단가 오름차순 최저가.)

export interface CancelFallbackQuote {
  id: string
  price_type?: string | null // 'list'(공시가)는 원가 후보 아님 → 제외
  status?: string | null // 'confirmed'만 자동선택 후보(백엔드 buildCatalog와 정합)
  unit_price_usd?: number | null
  suppliers?: { name?: string | null } | null
}

export type CancelPost = 'auto' | 'list' | 'none'

export interface CancelFallback {
  /** auto=다른 확정견적 자동 적용 | list=gcube 공시가로 복귀 | none=기준 공급가 없음(경고) */
  post: CancelPost
  /** post='auto'일 때 자동 적용될 공급사명(최저 확정 견적). 그 외 null. */
  autoSupplier: string | null
}

/**
 * 지정 취소 시 귀결 판정.
 * @param quotes 해당 product의 전체 견적(status=* — list 포함, 함수가 내부에서 거른다)
 * @param cancelQid 취소 대상 견적 id
 * @param hasGcube gcube(공시가) 존재 여부 (예: row.list_price_krw != null)
 */
export function resolveCancelFallback(
  quotes: readonly CancelFallbackQuote[],
  cancelQid: string,
  hasGcube: boolean,
): CancelFallback {
  // 자동선택 후보 = 본인 제외 + cost(비-list) + 확정 + 단가 존재. 단가 오름차순 최저가 = 백엔드 채택값.
  //   (API 정렬에 의존하지 않고 여기서 직접 정렬 — SSOT 견고성)
  const candidates = quotes
    .filter((q) => q.id !== cancelQid && q.price_type !== 'list' && q.status === 'confirmed' && q.unit_price_usd != null)
    .sort((a, b) => (a.unit_price_usd as number) - (b.unit_price_usd as number))

  if (candidates.length > 0) {
    return { post: 'auto', autoSupplier: candidates[0].suppliers?.name ?? null }
  }
  return { post: hasGcube ? 'list' : 'none', autoSupplier: null }
}
