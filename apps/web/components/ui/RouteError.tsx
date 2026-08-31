'use client'

// components/ui/RouteError.tsx — 라우트 그룹 오류 경계의 **공용 본체**(SSOT)
//
// ## 왜 필요한가 (실측 2026-08-31)
//
// 화면이 107개인데 오류 경계(`error.tsx`)가 **1개**뿐이었다. 그래서 어느 화면 하나가 깨지면
// 최상위 `app/global-error.tsx`로 떨어져 **앱 전체가 통째로** 오류 화면이 됐다 —
// 사이드바도, 다른 탭도, 입력 중이던 내용도 함께 사라진다.
//
// 라우트 그룹마다 `error.tsx`를 두면 **깨진 영역만** 오류를 보여 주고 셸은 살아 있다.
// 각 그룹의 `error.tsx`는 이 컴포넌트를 감싸기만 한다 — 문구·모양을 그룹마다 다시 만들지 않는다.
//
// 기록도 여기서 한 번만 한다. 예전엔 global-error 만 기록했으므로,
// 그룹 경계가 생기면서 **기록이 끊기지 않도록** 같은 통로(`/api/system-log/client`)로 보낸다.

import { useEffect } from 'react'

interface RouteErrorProps {
  error: Error & { digest?: string }
  reset: () => void
  /** 어느 영역이 깨졌는지 사람 말로 — "업무", "관리자", "영업 CRM" 처럼 */
  surface: string
}

export default function RouteError({ error, reset, surface }: RouteErrorProps) {
  useEffect(() => {
    // 실패해도 조용히 넘어간다 — 오류 화면이 또 오류를 내면 사용자는 할 수 있는 게 없다
    void fetch('/api/system-log/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack ?? '',
        digest: error.digest ?? '',
        route: typeof window !== 'undefined' ? window.location.pathname : '',
      }),
    }).catch(() => {})
  }, [error])

  return (
    <div role="alert" className="page-inner" style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
      <div className="card" style={{ maxWidth: '32rem', padding: 'var(--space-8)', textAlign: 'center' }}>
        <h2 style={{
          fontSize: 'var(--fs-xl)', fontWeight: 700, letterSpacing: '-0.03em',
          color: 'var(--text)', margin: '0 0 var(--space-3)',
        }}>
          {surface} 화면을 여는 중 문제가 생겼어요
        </h2>
        <p style={{ margin: `0 0 var(--space-6)`, lineHeight: 1.7, color: 'var(--text-muted)' }}>
          방금 무슨 일이 있었는지 관리자에게 자동으로 전달했어요.
          다른 메뉴는 그대로 쓰실 수 있습니다.
        </p>
        {error.digest && (
          <p style={{ margin: `0 0 var(--space-6)`, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            문의할 때 이 번호를 알려 주시면 빨리 찾을 수 있어요 — {error.digest}
          </p>
        )}
        <button type="button" onClick={reset} className="btn-primary">
          다시 시도
        </button>
      </div>
    </div>
  )
}
