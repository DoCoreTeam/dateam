import PageHeader from './PageHeader'

// 라우트 전환 시 loading.tsx에서 재사용하는 경량 스켈레톤 조각 (서버 렌더, 클라이언트 JS 0).
// 모든 치수/색은 globals.css의 .skel* 토큰 클래스에서만 — 인라인 하드코딩 금지.

export function SkelLine({ w = '100%', size }: { w?: string; size?: 'sm' | 'lg' }) {
  return <div className={`skel skel-line${size ? ` ${size}` : ''}`} style={{ width: w }} />
}

// 카드 1장: 제목 라인 + 본문 몇 줄. 일일/주간/부서 등 카드형 화면의 폴백.
export function SkelCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skel-card">
      <SkelLine w="40%" size="lg" />
      <div style={{ height: 'var(--space-3)' }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkelLine key={i} w={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  )
}

// 리스트형(거래처/딜/연락처/카탈로그): 행 스켈레톤 N개.
export function SkelList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skel-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel" style={{ height: '64px', borderRadius: 'var(--radius-lg)' }} />
      ))}
    </div>
  )
}

// 페이지 헤더(정적 제목) + 본문 폴백을 묶은 표준 셸.
export function SkelPage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="page-inner">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  )
}
