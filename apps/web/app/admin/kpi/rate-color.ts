// app/admin/kpi/rate-color.ts — 달성률 색 SSOT
//
// 피벗표(서버 컴포넌트)와 로그 목록(클라이언트 컴포넌트)이 같은 기준으로 칠해야 한다.
// 'use client' 모듈에서 import하면 서버에서 호출할 때 client-reference 프록시가 되므로
// 색 판정은 이렇게 순수 모듈로 분리한다.

export interface RateTone {
  color: string
  backgroundColor: string
}

export function rateColor(rate: number): RateTone {
  if (rate >= 100) return { color: 'var(--success)', backgroundColor: 'var(--success-bg)' }
  if (rate >= 50) return { color: 'var(--warning)', backgroundColor: 'var(--warning-bg)' }
  return { color: 'var(--danger)', backgroundColor: 'var(--danger-bg)' }
}
