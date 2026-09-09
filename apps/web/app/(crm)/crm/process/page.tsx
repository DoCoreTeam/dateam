import { Workflow } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import ProcessClient from './ProcessClient'

export const metadata = { title: '영업 단계 · 영업 CRM' }

export default async function CrmProcessPage() {
  // 단계 구성을 바꾸는 것은 관리자 몫이다 — 멤버는 어떤 흐름인지만 본다.
  // 화면에서만 숨기면 API 로 새어 나가므로 서버도 ADMIN 을 요구한다(stages PATCH).
  //
  // 파이프라인 자체(만들기·이름·기본 지정·접기·삭제)는 **설정 › 파이프라인** 카드에 있다
  // (사용자 지적 2026-09-09). 여기서는 «고르고 · 그 흐름의 단계를 편집»한다.
  const access = await resolveCrmAccess()
  const canEdit = access.ok ? hasCrmRole(access.session.role, 'ADMIN') : false

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="영업 단계"
        icon={<Workflow size={20} />}
        description="고른 파이프라인이 어떤 순서로 흐르는지 정합니다. 파이프라인 자체를 만들고 지우는 건 설정에서 합니다."
        below={<CrmGroupTabs />}
      />
      <ProcessClient canEdit={canEdit} />
    </>
  )
}
