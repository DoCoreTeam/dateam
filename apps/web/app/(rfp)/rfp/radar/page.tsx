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
    q.from('rfp_radar_rules').select('id, name, keywords, agencies, budget_min, budget_max, enabled').limit(50),
    q.from('rfp_radar_hits')
      .select('id, rule_id, source_id, case_id, pre_score, reason, status')
      .eq('status', 'new')
      .order('pre_score', { ascending: false })
      .limit(50),
  ])

  // 걸린 공고가 **무엇인지**를 함께 읽는다. 점수와 사유만 보이면 아무것도 정할 수 없다.
  // 임베드(!inner) 대신 두 번 읽는 이유: rfp_radar_hits.source_id 는 FK 가 있지만
  // 원천이 지워진 적중은 임베드로 읽으면 통째로 사라진다 — 그건 「어제 본 공고가 없어짐」이다
  const hitRows = ((hits as RadarHitRow[] | null) ?? [])
  const sourceIds = Array.from(new Set(hitRows.map((h) => h.source_id).filter(Boolean)))
  let noticeById = new Map<string, RadarHitRow['notice']>()
  if (sourceIds.length > 0) {
    const { data: sources } = await (db as never as {
      from(t: string): { select(c: string): { in(k: string, v: string[]): Promise<{ data: unknown }> } }
    }).from('rfp_sources').select('id, title, announcing_agency, budget_amount, notice_date').in('id', sourceIds)
    noticeById = new Map(((sources as Record<string, unknown>[] | null) ?? []).map((r) => [
      String(r.id),
      {
        title: r.title === null || r.title === undefined ? null : String(r.title),
        agency: r.announcing_agency === null || r.announcing_agency === undefined ? null : String(r.announcing_agency),
        budgetAmount: r.budget_amount === null || r.budget_amount === undefined ? null : Number(r.budget_amount),
        noticeDate: r.notice_date === null || r.notice_date === undefined ? null : String(r.notice_date),
      },
    ]))
  }

  return (
    <main className="page-inner">
      <PageHeader
        title={RFP_RADAR.title}
        description={RFP_RADAR.desc}
        back={{ href: '/rfp', label: RFP_LIST.title }}
      />
      <RadarRules
        initialRules={(rules as RadarRuleRow[] | null) ?? []}
        initialHits={hitRows.map((h) => ({ ...h, notice: noticeById.get(h.source_id) ?? null }))}
      />
    </main>
  )
}
