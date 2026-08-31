'use client'

// 라우트 그룹 오류 경계 — 본체는 components/ui/RouteError (SSOT).
// 이 파일은 「어느 영역인가」만 알려 준다. 문구·모양을 여기서 다시 만들지 않는다.
import { SERVICE_LABEL } from '@/lib/terms'
import RouteError from '@/components/ui/RouteError'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} surface={SERVICE_LABEL.member} />
}
