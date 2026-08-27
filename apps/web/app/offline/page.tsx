import { CloudOff } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '연결 없음' }

/**
 * 받은 적 없는 화면을 오프라인에서 열었을 때.
 *
 * **브라우저 기본 오류 화면을 보여 주지 않는다.** 그건 "앱이 고장났다"로 읽히고,
 * 사용자는 회의 중에 앱을 닫는다. **연결이 없는 것과 고장난 것은 다르다** —
 * 그 구분을 화면이 말해야 사람이 하던 일을 이어간다.
 *
 * 셸 밖 화면이다(사이드바 없음) — 오프라인이라 셸이 필요로 하는 조회가 어차피 안 된다.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-4)', padding: 'var(--space-6)',
        textAlign: 'center', background: 'var(--surface-bg)', color: 'var(--text)',
      }}
    >
      <EmptyState
        title="연결이 없어요"
        description="이 화면은 아직 받아 둔 적이 없어서 지금은 열 수 없습니다. 적어 두신 것과 녹음은 이 기기에 그대로 있고, 연결되면 자동으로 올라갑니다."
        icon={<CloudOff size={28} />}
        action={{ label: '홈으로', href: '/home' }}
      />
    </main>
  )
}
