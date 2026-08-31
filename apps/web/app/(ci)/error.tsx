'use client'

// 라우트 그룹 오류 경계 — 본체는 components/ui/RouteError (SSOT).
import { SERVICE_LABEL } from '@/lib/terms'
import RouteError from '@/components/ui/RouteError'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} surface={SERVICE_LABEL.ci} />
}
