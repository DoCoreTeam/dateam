'use client'

// app/global-error.tsx — 화면이 통째로 깨졌을 때 마지막으로 남는 자리
//
// 두 가지를 한다.
//   ① 사용자에게 **무슨 일인지 사람 말로** 알린다(흰 화면은 아무것도 알려 주지 않는다)
//   ② 관리자 로그로 **사실을 넘긴다** — 지금까지 클라이언트 오류는 아무 데도 안 남았다
//
// 이 파일은 루트 레이아웃을 대체한다. 그래서 <html>·<body> 를 직접 그리고,
// **토큰을 쓰려면 globals.css 를 여기서 직접 불러야 한다**(레이아웃의 import 가 안 돌기 때문).
// 오류 화면이라고 다른 제품처럼 보이면 사용자는 "이상한 페이지에 왔다"고 읽는다.

import { useEffect } from 'react'
import './globals.css'

export default function GlobalError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
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
    <html lang="ko">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: 'var(--surface-bg)', color: 'var(--text)',
      }}>
        <main style={{ maxWidth: '32rem', padding: 'var(--space-8)', textAlign: 'center' }}>
          <h1 style={{
            fontSize: 'var(--fs-2xl)', fontWeight: 700, letterSpacing: '-0.03em',
            color: 'var(--text)', margin: '0 0 var(--space-3)',
          }}>
            화면을 여는 중 문제가 생겼어요
          </h1>
          <p style={{ margin: `0 0 var(--space-6)`, lineHeight: 1.7, color: 'var(--text-muted)' }}>
            방금 무슨 일이 있었는지 관리자에게 자동으로 전달했어요.
            아래 버튼으로 다시 시도해 보시고, 계속 같은 화면이 나오면 관리자에게 알려 주세요.
          </p>
          {error.digest && (
            <p style={{ margin: `0 0 var(--space-6)`, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              문의할 때 이 번호를 알려 주시면 빨리 찾을 수 있어요 — {error.digest}
            </p>
          )}
          <button type="button" onClick={reset} className="btn-primary">
            다시 시도
          </button>
        </main>
      </body>
    </html>
  )
}
