// L4 (client) — GPU 메뉴가 사용하는 SWR 키 레지스트리.
//
// 견적/재고/공급사 변경 후 mutateGpu(globalMutate)를 호출하면
// 4개 메뉴(가격표/시장비교/재고/고객판매가)의 SWR 캐시가 동시에 재요청된다.
// 라우트별 부분 mutate 대신 이 한 경로만 사용해 "동시 반영"을 보장한다.

import type { ScopedMutator } from 'swr'

/** GPU 카탈로그에 의존하는 모든 SWR 엔드포인트 (prefix 매칭) */
export const GPU_SWR_PREFIXES = [
  '/api/pricing/gpu/products',
  '/api/pricing/gpu/market',
  '/api/pricing/gpu/inventory',
  '/api/pricing/gpu/quotes',
  '/api/pricing/gpu/availability',
  '/api/pricing/gpu/suppliers',
] as const

/**
 * GPU 의존 SWR 키 일괄 무효화.
 * @param mutate  useSWRConfig()의 mutate (ScopedMutator)
 */
export function mutateGpu(mutate: ScopedMutator): void {
  mutate(
    (key) =>
      typeof key === 'string' && GPU_SWR_PREFIXES.some((p) => key.startsWith(p)),
    undefined,
    { revalidate: true }
  )
}
