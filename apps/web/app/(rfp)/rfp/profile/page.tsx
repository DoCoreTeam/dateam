// /rfp/profile — 회사 프로필
//
// 적합도 판정이 이 정보를 쓴다. 초안은 draft 로만 저장되고
// 사람이 확인해야 판정에 쓰인다.

import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { RFP_PROFILE, RFP_LIST } from '@/lib/rfp/terms'
import ProfileEditor, { type ProfileBasic } from '@/components/rfp/ProfileEditor'

export const dynamic = 'force-dynamic'

export default async function RfpProfilePage() {
  const db = await createClient()
  const { data } = await (db as never as {
    from(t: string): {
      select(c: string): {
        order(c: string, o: { ascending: boolean }): {
          limit(n: number): { maybeSingle(): Promise<{ data: unknown }> }
        }
      }
    }
  })
    .from('rfp_company_profiles')
    .select('version, status, basic')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as { version?: number; status?: string; basic?: ProfileBasic } | null

  return (
    <main className="page-inner">
      <PageHeader
        title={RFP_PROFILE.title}
        description={RFP_PROFILE.desc}
        back={{ href: '/rfp', label: RFP_LIST.title }}
      />
      <ProfileEditor
        initial={row?.basic ?? null}
        initialVersion={row?.version ?? null}
        initialStatus={row?.status ?? null}
      />
    </main>
  )
}
