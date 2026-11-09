import { FileSignature } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import { SERVICE_LABEL } from '@/lib/terms'
import { CONTRACT_DOC, CONTRACT_LIST } from '@/lib/terms/contract-doc'
import ContractListView, { type ContractListAbilities } from './ContractListView'
import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import { visibleSensitivities } from '@/lib/crm/domain/contract-sensitivity'

/** 단추를 그릴지만 미리 읽는다 — 막는 것은 창구다 (POST /api/crm/contracts, 등급 거름망) */
async function readAbilities(): Promise<ContractListAbilities> {
  try {
    const access = await resolveCrmAccess()
    if (!access.ok) return { create: false, corporate: false }
    const role = access.session.role
    return { create: hasCrmRole(role, 'MEMBER'), corporate: visibleSensitivities(role).includes('CORPORATE') }
  } catch {
    return { create: false, corporate: false }
  }
}

export const metadata = { title: `${CONTRACT_DOC.list} · ${SERVICE_LABEL.crm}` }

export default async function CrmContractsPage() {
  const abilities = await readAbilities()
  return (
    <>
      <PageHeader
        eyebrow={SERVICE_LABEL.crm}
        title={CONTRACT_DOC.list}
        icon={<FileSignature size={20} />}
        description={CONTRACT_LIST.description}
        below={<CrmGroupTabs />}
      />
      <ContractListView abilities={abilities} />
    </>
  )
}
