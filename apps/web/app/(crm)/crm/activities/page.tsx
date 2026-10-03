import { Activity } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { ENTITY, SERVICE_LABEL } from '@/lib/terms'
import ActivitiesClient from './ActivitiesClient'

export const metadata = { title: '활동 · 영업 CRM' }

export default function CrmActivitiesPage() {
  return (
    <>
      <PageHeader
        eyebrow={SERVICE_LABEL.crm}
        title={ENTITY.activity.label}
        icon={<Activity size={20} />}
        description="회사·인물·딜에 남은 기록을 한자리에서 봅니다. 종류·남긴 사람·기간으로 걸러 누가 언제 무엇을 했는지 봅니다."
        below={<CrmGroupTabs />}
      />
      <ActivitiesClient />
    </>
  )
}
