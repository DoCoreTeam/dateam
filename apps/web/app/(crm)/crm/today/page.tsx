import { Sun } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import TodayClient from './TodayClient'

export const metadata = { title: '오늘 · 영업 CRM' }

export default function CrmTodayPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="오늘"
        icon={<Sun size={20} />}
        description="지금 손을 대야 할 것만 모았습니다."
        below={<CrmGroupTabs />}
      />
      <TodayClient />
    </>
  )
}
