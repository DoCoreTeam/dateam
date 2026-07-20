import { requireAdmin } from '@/lib/auth/requireAdmin'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import AnalyzeClient from './AnalyzeClient'
import SessionListClient from './SessionListClient'
import DocumentListClient from './DocumentListClient'

// 목록 심층분석 — admin 전용 게이트(§③ 동일 정책, /ai-chat 하위 서브라우트).
// §C4 세션 목록 + §FR-11-2 문서 라이브러리 — ?tab=list(세션 목록·CRUD) | ?tab=documents(내 분석 문서) | 기본(새 분석).
// 서버 컴포넌트 유지, 탭 전환은 href 네비게이션.
export default async function AiChatAnalyzePage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  await requireAdmin()
  const tab = searchParams.tab === 'list' ? 'list' : searchParams.tab === 'documents' ? 'documents' : 'new'

  return (
    <div>
      <WorkSubTabs
        items={[
          { key: 'new', label: '새 분석', href: '/ai-chat/analyze', testId: 'analyze-tab-new' },
          // 계약 E: 1급 객체는 "결과 문서". 세션은 원문 재열람용 부차 진입점으로 강등한다
          // (탭 순서·라벨이 정보구조를 말한다 — 세션을 동급으로 두면 계약 E가 명목뿐이 된다).
          { key: 'documents', label: '내 분석 문서', href: '/ai-chat/analyze?tab=documents', testId: 'analyze-tab-documents' },
          { key: 'list', label: '이전 원문', href: '/ai-chat/analyze?tab=list', testId: 'analyze-tab-list' },
        ]}
        activeKey={tab}
        ariaLabel="목록 심층분석 보기 전환"
      />
      <div style={{ marginTop: 'var(--space-4)' }}>
        {tab === 'list' ? <SessionListClient /> : tab === 'documents' ? <DocumentListClient /> : <AnalyzeClient />}
      </div>
    </div>
  )
}
