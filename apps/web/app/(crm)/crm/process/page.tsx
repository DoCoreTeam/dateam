import { Workflow } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import ProcessClient from './ProcessClient'

export const metadata = { title: '프로세스 · 영업 CRM' }

export default async function CrmProcessPage() {
  // 조건을 바꾸는 것은 관리자 몫이다 — 멤버는 어떤 조건이 걸려 있는지만 본다.
  // 화면에서만 숨기면 API 로 새어 나가므로 서버도 ADMIN 을 요구한다(stages PATCH).
  const access = await resolveCrmAccess()
  const canEdit = access.ok ? hasCrmRole(access.session.role, 'ADMIN') : false

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="프로세스"
        icon={<Workflow size={20} />}
        description="각 단계에 오려면 무엇이 정해져 있어야 하는지 정합니다."
      />
      <ProcessClient canEdit={canEdit} />
    </>
  )
}
