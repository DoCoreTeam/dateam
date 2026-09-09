// /rfp — 분석 케이스 목록
//
// 첫 화면을 서버에서 채운다 — 빈 목록이 잠깐 보였다가 채워지면
// 사용자는 「케이스가 없다」를 먼저 읽는다.

import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { RFP_LIST } from '@/lib/rfp/terms'
import CaseListClient, { type CaseRow } from './CaseListClient'

export const dynamic = 'force-dynamic'

export default async function RfpCasesPage() {
  const db = await createClient()
  const { data } = await (db as never as {
    from: (t: string) => {
      select: (c: string) => {
        is: (c: string, v: null) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: CaseRow[] | null }>
          }
        }
      }
    }
  })
    .from('rfp_cases')
    .select('id, title, doc_class, stage, sector, budget_amount, proposal_deadline, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <main className="page-inner">
      <PageHeader title={RFP_LIST.title} />
      <CaseListClient initial={data ?? []} />
    </main>
  )
}
