import { resolveCrmAccess, hasCrmRole } from '@/lib/crm/auth/requireCrmMember'
import { CONTRACT_ACTION_ROLE } from '@/lib/crm/domain/contract-status'
import { canExport } from '@/lib/access/guard'
import { SERVICE_LABEL } from '@/lib/terms/entity'
import { CONTRACT_DOC } from '@/lib/terms/contract-doc'
import ContractView, { type ContractAbilities } from './ContractView'

export const metadata = { title: `${CONTRACT_DOC.entity} · ${SERVICE_LABEL.crm}` }

const NONE: ContractAbilities = { conclude: false, terminate: false, exportFiles: false }

/**
 * 화면이 그릴 단추를 서버가 미리 판정한다.
 *
 * 단추를 감추는 것은 권한 검증이 아니다 — 창구(status·export)가 같은 판정을 다시 한다.
 * 여기서는 누를 수 없는 단추를 누르게 해 오류를 보이지 않으려고 미리 읽을 뿐이다.
 * 역할 기준은 CONTRACT_ACTION_ROLE 한 곳에서 가져온다, 화면이 ADMIN 을 또 적으면 갈린다.
 */
async function readAbilities(): Promise<ContractAbilities> {
  try {
    const access = await resolveCrmAccess()
    if (!access.ok) return NONE
    const role = access.session.role
    return {
      conclude: hasCrmRole(role, CONTRACT_ACTION_ROLE.conclude),
      terminate: hasCrmRole(role, CONTRACT_ACTION_ROLE.terminate),
      exportFiles: await canExport('/crm'),
    }
  } catch {
    // 세션을 못 읽으면 다 끈다 — 서버가 어차피 막으니 열어 두는 쪽이 더 위험하다
    return NONE
  }
}

export default async function CrmContractPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, abilities] = await Promise.all([params, readAbilities()])
  return <ContractView contractId={id} abilities={abilities} />
}
