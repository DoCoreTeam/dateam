'use client'

// 라우트 그룹 오류 경계 — 본체는 components/ui/RouteError (SSOT).
// 로그인 화면은 서비스가 아니라 관문이라 SERVICE_LABEL 에 자리가 없다.
import RouteError from '@/components/ui/RouteError'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} surface="로그인" />
}
