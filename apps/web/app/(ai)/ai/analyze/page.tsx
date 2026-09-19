import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import AnalyzeClient from './AnalyzeClient'
import SessionListClient from './SessionListClient'

// 목록 심층분석 — admin 전용 게이트(§③ 동일 정책, AI 스튜디오 하위 서브라우트).
// §C4 세션 목록 — ?tab=list(세션 목록·CRUD) | 기본(새 분석). 서버 컴포넌트 유지, 탭 전환은 href 네비게이션.
//
// 「내 분석 문서」탭은 사이드바의 **문서함**(`/ai/documents`)으로 나갔다.
// 결과 문서가 1급 객체라면 분석 화면을 열어야 보이는 자리에 둘 수 없다(계약 E).
// 옛 탭 주소는 리다이렉트로 살린다 — 완료 안내·모달에서 나간 링크가 이미 밖에 있다.
export default async function AiChatAnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin()
  if ((await searchParams).tab === 'documents') redirect('/ai/documents')
  const tab = (await searchParams).tab === 'list' ? 'list' : 'new'

  return (
    <div>
      <WorkSubTabs
        items={[
          { key: 'new', label: '새 분석', href: '/ai/analyze', testId: 'analyze-tab-new' },
          // 계약 E: 1급 객체는 "결과 문서"라 문서함이 사이드바로 나갔다.
          // 세션(원문)은 재열람용 부차 진입점이라 여기 남는다.
          { key: 'list', label: '이전 원문', href: '/ai/analyze?tab=list', testId: 'analyze-tab-list' },
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
