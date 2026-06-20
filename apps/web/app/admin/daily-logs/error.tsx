'use client'

import { useEffect } from 'react'

/**
 * 관리자 일일업무 모니터링 에러 바운더리.
 * 데이터 페치 실패 시 "0건"으로 오인되지 않도록 명시적 에러 화면을 보여준다(감사 신뢰).
 */
export default function MonitoringError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[daily-monitoring] render error', error)
  }, [error])

  return (
    <div className="page-inner">
      <div className="monitor-error">
        <h1 className="monitor-title">데이터를 불러오지 못했어요</h1>
        <p className="monitor-subtitle">
          일시적인 오류일 수 있습니다. 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의하세요.
        </p>
        <button type="button" className="monitor-search-btn" onClick={() => reset()}>
          다시 시도
        </button>
      </div>
    </div>
  )
}
