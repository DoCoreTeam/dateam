import { requireAdmin } from '@/lib/auth/requireAdmin'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import AnalyzeClient from './AnalyzeClient'
import SessionListClient from './SessionListClient'

// 목록 심층분석 — admin 전용 게이트(§③ 동일 정책, /ai-chat 하위 서브라우트).
// §C4 세션 목록 신설 — ?tab=list(세션 목록·CRUD) | 기본(새 분석). 서버 컴포넌트 유지, 탭 전환은 href 네비게이션.
export default async function AiChatAnalyzePage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  await requireAdmin()
  const tab = searchParams.tab === 'list' ? 'list' : 'new'

  return (
    <div>
      <WorkSubTabs
        items={[
          { key: 'new', label: '새 분석', href: '/ai-chat/analyze', testId: 'analyze-tab-new' },
          { key: 'list', label: '전체 세션', href: '/ai-chat/analyze?tab=list', testId: 'analyze-tab-list' },
        ]}
        activeKey={tab}
        ariaLabel="목록 심층분석 보기 전환"
      />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {tab === 'list' ? <SessionListClient /> : <AnalyzeClient />}
      </div>
    </div>
  )
}
