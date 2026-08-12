'use client'

import { useEffect } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import ErrorState from '@/components/ui/ErrorState'

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
      <PageHeader title="일일업무 모니터링" />
      <ErrorState
        message="데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
        code={error.digest}
        onRetry={() => reset()}
      />
    </div>
  )
}
