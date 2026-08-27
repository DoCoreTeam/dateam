import { Building2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import CompanyListView from './CompanyListView'

export const metadata = { title: '회사 · 영업 CRM' }

export default function CrmCompaniesPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="회사"
        icon={<Building2 size={20} />}
        description="거래처와 잠재 고객을 한곳에서 봅니다."
        below={<CrmGroupTabs />}
      />
      <CompanyListView />
    </>
  )
}
