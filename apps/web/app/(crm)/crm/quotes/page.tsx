import { FileText } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import QuoteListView from './QuoteListView'

export const metadata = { title: '견적 · 영업 CRM' }

export default function CrmQuotesPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="견적"
        icon={<FileText size={20} />}
        description="지금 나가 있는 견적을 한곳에서 봅니다. 쓰고 고치는 건 딜 안에서 합니다."
        below={<CrmGroupTabs />}
      />
      <QuoteListView />
    </>
  )
}
