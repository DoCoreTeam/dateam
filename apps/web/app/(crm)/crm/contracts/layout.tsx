import { canOpen } from '@/lib/access/guard'
import AccessDenied from '@/components/ui/AccessDenied'
import { CONTRACT_HREF } from '@/lib/crm/api/handler'
import { CONTRACT_DOC } from '@/lib/terms/contract-doc'

export default async function ContractsLayout({ children }: { children: React.ReactNode }) {
  /**
   * 접근권한의 「계약서」 자리 (P0184 I12d). 영업 CRM 문을 지난 뒤 계약서만 따로 묻는다.
   * 부여가 없으면 영업 CRM 판정이 내려와 앞 문과 같은 답이다. 막는 것은 창구(withContractApi)도 한다
   */
  if (!(await canOpen(CONTRACT_HREF))) return <AccessDenied what={CONTRACT_DOC.entity} />
  return <>{children}</>
}
