import { Users } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import PersonListView from './PersonListView'

export const metadata = { title: '인물 · 영업 CRM' }

export default function CrmPeoplePage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="인물"
        icon={<Users size={20} />}
        description="담당자와 의사결정자를 관리합니다."
      />
      <PersonListView />
    </>
  )
}
