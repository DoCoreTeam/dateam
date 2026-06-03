// L4 — GPU 원자적 캐시 무효화
//
// 견적/재고/공급사 변경이 일어난 모든 라우트는 변경 직후 revalidateGpu()를 호출한다.
// 한 번의 호출로 4개 메뉴(가격표/시장비교/재고/고객판매가)가 의존하는
// Next 캐시 태그를 동시 무효화하여 "한 곳 수정 → 동시 반영"을 보장한다.
//
// 클라이언트(SWR) 측은 lib/gpu/swr-keys.ts의 GPU_SWR_KEYS를 mutate해 갱신한다.

import { revalidateTag } from 'next/cache'

/** GPU 카탈로그 의존 캐시 태그 — fetch() 시 next:{tags:[GPU_CACHE_TAG]} 로 부착 */
export const GPU_CACHE_TAG = 'gpu-catalog'

/** 모든 GPU 메뉴의 Next 캐시를 원자적으로 무효화 */
export function revalidateGpu(): void {
  try {
    revalidateTag(GPU_CACHE_TAG)
  } catch {
    // revalidateTag는 요청 컨텍스트 밖에서 throw할 수 있음 — 캐시 무효화 실패는 치명적이지 않음
  }
}
