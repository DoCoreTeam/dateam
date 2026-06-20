'use client'

// 판매가격표(/pricing/catalog) 독립 라우트 — 가격 정확도 우선 마운트 재검증.
// 전역 SWRProvider는 영속캐시 + revalidateIfStale:false(즉시표시 최적화)인데,
// 가격 데이터는 stale 노출 시 손해가 크다. 근본적으론 SyncRevalidator의 pricing 토큰이 변경을
// 감지해 재검증하지만(member 레이아웃서 동작), 이 라우트에서도 nested override로 이중 보강한다.
// (탭으로서의 catalog는 GpuPricingClient의 nested SWRConfig가 별도 커버.)
import { SWRConfig } from 'swr'

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ revalidateIfStale: true }}>{children}</SWRConfig>
}
