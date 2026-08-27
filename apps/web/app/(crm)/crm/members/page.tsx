import { Users } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import MembersClient from './MembersClient'

export const metadata = { title: '멤버 · 영업 CRM' }

export default async function CrmMembersPage() {
  // 화면에서만 숨기면 API 로 새어 나간다 — 서버도 ADMIN 을 요구한다(members POST/PATCH/DELETE)
  const access = await resolveCrmAccess()
  const canEdit = access.ok ? hasCrmRole(access.session.role, 'ADMIN') : false
  const myMemberId = access.ok ? access.session.memberId : null

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="멤버"
        icon={<Users size={20} />}
        description="이 CRM을 누가 쓰는지 정합니다. 내보내도 그 사람이 남긴 기록은 그대로 남아요."
        below={<CrmGroupTabs />}
      />
      <MembersClient canEdit={canEdit} myMemberId={myMemberId} />
    </>
  )
}
