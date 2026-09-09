// /rfp/radar — 공고 레이더
//
// 자동은 찾기까지다. 케이스로 만드는 것은 사람이 고른다.

import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { RFP_RADAR, RFP_LIST } from '@/lib/rfp/terms'
import RadarRules, { type RadarHitRow, type RadarRuleRow } from '@/components/rfp/RadarRules'

export const dynamic = 'force-dynamic'

interface Q {
  from(t: string): {
    select(c: string): {
      eq(col: string, v: string): {
        order(col: string, o: { ascending: boolean }): { limit(n: number): Promise<{ data: unknown }> }
      }
      limit(n: number): Promise<{ data: unknown }>
    }
  }
}

export default async function RfpRadarPage() {
  const db = await createClient()
  const q = db as never as Q

  const [{ data: rules }, { data: hits }] = await Promise.all([
    q.from('rfp_radar_rules').select('id, name, keywords, budget_min, budget_max, enabled').limit(50),
    q.from('rfp_radar_hits')
      .select('id, rule_id, source_id, case_id, pre_score, reason, status')
      .eq('status', 'new')
      .order('pre_score', { ascending: false })
      .limit(50),
  ])

  return (
    <main className="page-inner">
      <PageHeader
        title={RFP_RADAR.title}
        description={RFP_RADAR.desc}
        back={{ href: '/rfp', label: RFP_LIST.title }}
      />
      <RadarRules
        initialRules={(rules as RadarRuleRow[] | null) ?? []}
        initialHits={(hits as RadarHitRow[] | null) ?? []}
      />
    </main>
  )
}
