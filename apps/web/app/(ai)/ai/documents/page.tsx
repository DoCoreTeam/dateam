import { requireAdmin } from '@/lib/auth/requireAdmin'
import { FolderOpen } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import DocumentListClient from '../analyze/DocumentListClient'

// 문서함 — 심층분석이 만들어 낸 결과 문서가 쌓이는 곳(§FR-11-2).
//
// 예전엔 심층분석 화면의 **탭**이었다(주소는 ?tab=documents). 결과물을 보려면 분석 화면을
// 먼저 열어야 했다는 뜻이다. 계약 E 가 "1급 객체는 결과 문서"라고 정해 놓고 정작 문은
// 분석 안쪽에 있었다. 사이드바로 꺼내 자기 주소를 준다.
//
// 목록 구현은 그대로 재사용한다 — 화면을 새로 그리면 두 벌이 된다.
export default async function AiDocumentsPage() {
  await requireAdmin()

  return (
    <div>
      <PageHeader
        title="문서함"
        icon={<FolderOpen size={22} color="var(--brand)" />}
        description="목록 심층분석이 만들어 낸 결과 문서입니다. 제목을 눌러 열어 보고, 필요 없으면 삭제하거나 휴지통에서 되살립니다."
      />
      <div style={{ marginTop: 'var(--space-4)' }}>
        <DocumentListClient />
      </div>
    </div>
  )
}
