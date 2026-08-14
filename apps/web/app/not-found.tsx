import EmptyState from '@/components/ui/EmptyState'

// 전역 404 — 미매칭 경로(예: 잘못된 로케일 프리픽스 /ko/…)에서 루트 레이아웃(<html>/<body>) 안에 렌더되어
// "Missing required html tags" 에러를 방지하고 깔끔한 안내를 제공한다.
// 문구·버튼은 공용 EmptyState를 쓴다 — 404도 "없는 것을 알리고 다음 행동을 주는" 빈 상태다.
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-6)',
        textAlign: 'center',
        background: 'var(--surface-bg)',
        color: 'var(--text)',
      }}
    >
      <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, letterSpacing: '-0.04em' }}>404</div>
      <EmptyState
        title="페이지를 찾을 수 없어요"
        description={<>주소가 올바른지 확인해 주세요. (이 서비스는 <code>/ko</code> 같은 언어 접두어를 사용하지 않습니다)</>}
        action={{ label: '홈으로 돌아가기', href: '/home' }}
      />
    </main>
  )
}
