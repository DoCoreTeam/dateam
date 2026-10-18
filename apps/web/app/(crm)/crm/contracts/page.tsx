import { FileSignature } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { SERVICE_LABEL } from '@/lib/terms'
import { CONTRACT_DOC, CONTRACT_LIST } from '@/lib/terms/contract-doc'
import ContractListView from './ContractListView'

export const metadata = { title: `${CONTRACT_DOC.list} · ${SERVICE_LABEL.crm}` }

export default function CrmContractsPage() {
  return (
    <>
      <PageHeader
        eyebrow={SERVICE_LABEL.crm}
        title={CONTRACT_DOC.list}
        icon={<FileSignature size={20} />}
        description={CONTRACT_LIST.description}
        below={<CrmGroupTabs />}
      />
      <ContractListView />
    </>
  )
}
