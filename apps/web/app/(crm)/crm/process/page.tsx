import { Workflow } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import ProcessClient from './ProcessClient'

export const metadata = { title: '영업 단계 · 영업 CRM' }

export default async function CrmProcessPage() {
  // 단계 구성을 바꾸는 것은 관리자 몫이다 — 멤버는 어떤 흐름인지만 본다.
  // 화면에서만 숨기면 API 로 새어 나가므로 서버도 ADMIN 을 요구한다(stages PATCH).
  const access = await resolveCrmAccess()
  const canEdit = access.ok ? hasCrmRole(access.session.role, 'ADMIN') : false

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="영업 단계"
        icon={<Workflow size={20} />}
        description="우리 영업이 어떤 순서로 흐르는지 정합니다. 단계를 만들고 이름과 순서를 고칠 수 있어요."
        below={<CrmGroupTabs />}
      />
      <ProcessClient canEdit={canEdit} />
    </>
  )
}
