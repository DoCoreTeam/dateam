// GET  /api/rfp/radar — 후보 목록
// POST /api/rfp/radar — 지금 훑기
//
// 자동은 **찾기까지**다. 케이스로 만드는 것은 사람이 연 뒤에 한다 —
// 자동으로 만들면 분석 비용이 자동으로 나가고 아무도 안 볼 리포트가 쌓인다.
//
// ## 두 단계다: 모으기 → 거르기
//
// 예전에는 거르기만 있었다. `rfp_sources` 를 훑는데 **그 표를 채우는 코드가 없어서**
// 조건을 아무리 잘 만들어도 결과가 늘 0건이었다.
//
// 모으는 곳은 **설정에 등록된 곳 전부**다(`rfp_source_sites`). 나라장터만 보면
// 기관 자기 게시판에 먼저 붙는 공고를 늘 며칠 늦게 안다.
// 한 곳이 죽어도 나머지는 계속 모은다 — 기관 사이트는 자주 느리고 자주 막힌다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { toRadarRule } from '@/lib/rfp/radar/rules'
import { sweep, type NoticeCandidate } from '@/lib/rfp/radar/sweep'
import { collectNotices } from '@/lib/rfp/radar/collect'
import { collectFromSite, type SiteRow } from '@/lib/rfp/radar/collect-sites'
import { attachNotices } from '@/lib/rfp/radar/hit-notice'
import { listStatusOf } from '@/lib/rfp/radar/hit-status'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  /*
    **Vercel 크론은 GET 으로 온다.** 훑기를 POST 에만 두면 크론은 목록만 읽고 돌아가고,
    화면에는 아무 일도 안 일어난 채 「새 공고 0건」만 뜬다. 이 저장소는 그 사고를
    이미 한 번 겪었다(크론이 POST 에만 열린 창구를 여덟 시간 두드렸다).
    그래서 기계가 GET 으로 오면 훑기로 넘긴다.
  */
  if (isMachineCall(req)) return POST(req)

  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  /*
    볼 상태를 골라 받는다. 모르는 값이면 기본값(아직 정하지 않은 것)으로 떨어진다 —
    주소창에 아무 글자나 넣었다고 빈 목록을 보여 주면 사용자는 「공고가 없다」로 읽는다.
    뺀 것을 다시 보려면 이 갈래가 있어야 한다
  */
  const status = listStatusOf(new URL(req.url).searchParams.get('status'))
  const { data, error } = await (db as any)
    .from('rfp_radar_hits')
    .select('id, rule_id, source_id, case_id, pre_score, reason, status, created_at')
    .eq('status', status)
    .order('pre_score', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: '후보를 불러오지 못했습니다' }, { status: 500 })

  // 서버 첫 렌더와 **같은 함수**로 공고를 붙인다. 여기서 안 붙이면 훑기를 누른 직후
  // 클라이언트가 이 창구로 다시 받으면서 제목이 사라진다
  const hits = await attachNotices(db as never, (data ?? []) as { source_id: string }[])
  return NextResponse.json({ hits })
}

/**
 * 크론도 이 창구를 쓴다.
 *
 * 사람이 누를 때는 사람 인증과 그 사람의 클라이언트를 쓰고, 크론일 때는 기계 토큰을 보고
 * 서비스롤로 돈다 — 크론에는 세션이 없어 `rfp_default_org` 가 아무것도 못 준다.
 * 서비스롤 위의 사람 확인이 곧 기계 토큰이다(워커와 같은 모양).
 *
 * **열린 창구는 하나도 안 는다.** 토큰이 없으면 사람 인증으로 떨어지고, 그것도 없으면 거절이다.
 */
export async function POST(req: NextRequest) {
  const machine = isMachineCall(req)
  if (machine && machineAuthUnconfigured()) {
    return NextResponse.json({ error: '기계 인증이 설정되지 않았습니다' }, { status: 500 })
  }
  if (!machine) {
    const gate = await requireMemberApi()
    if (gate.error) return gate.error
  }

  const db = machine ? createAdminClient() : await createClient()
  const orgId = machine ? await firstOrgId(db) : (await (db as any).rpc('rfp_default_org')).data
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  // ① 먼저 모은다. 못 모아도 이미 담긴 것으로 거르기는 계속한다 —
  //    나라장터가 죽었다고 어제 담은 공고까지 안 보일 이유가 없다
  const { data: siteRows } = await (db as any)
    .from('rfp_source_sites')
    .select('id, name, kind, url, base_url, enabled')
    .is('deleted_at', null).eq('enabled', true)
  const sites = ((siteRows ?? []) as SiteRow[])

  const collected = sites.some((s) => s.kind === 'g2b')
    ? await collectNotices(db as any, { orgId: String(orgId) })
    : { fetched: 0, inserted: 0, skipped: 0, reason: 'g2b_off' as string | null, guide: null as string | null }

  // 기관 자체 사이트 — 한 곳이 죽어도 나머지는 계속 모은다
  const siteResults = []
  for (const site of sites.filter((s) => s.kind === 'web' && s.url)) {
    siteResults.push(await collectFromSite(db as any, { orgId: String(orgId), site }))
  }

  const { data: ruleRows } = await (db as any)
    .from('rfp_radar_rules')
    .select('id, name, keywords, classifications, budget_min, budget_max, agencies, enabled, last_swept_at')
    .eq('enabled', true)
  const rules = (ruleRows ?? []).map(toRadarRule)
  if (rules.length === 0) {
    return NextResponse.json({ hits: [], swept: 0, reason: 'no_rules', collected, siteResults })
  }

  const { data: sourceRows } = await (db as any)
    .from('rfp_sources')
    .select('id, notice_no, title, announcing_agency, budget_amount, notice_date')
    .order('notice_date', { ascending: false })
    .limit(500)

  const candidates: NoticeCandidate[] = (sourceRows ?? []).map((r: Record<string, unknown>) => ({
    sourceId: String(r.id),
    noticeNo: String(r.notice_no ?? ''),
    title: String(r.title ?? ''),
    agency: r.announcing_agency === null || r.announcing_agency === undefined ? null : String(r.announcing_agency),
    budgetAmount: r.budget_amount === null || r.budget_amount === undefined ? null : Number(r.budget_amount),
    classification: null,
    noticeDate: r.notice_date === null || r.notice_date === undefined ? null : String(r.notice_date),
  }))

  const { data: seenRows } = await (db as any)
    .from('rfp_radar_hits')
    .select('rule_id, source_id')
  const seen = (seenRows ?? []).map((r: Record<string, unknown>) => ({
    ruleId: String(r.rule_id), sourceId: String(r.source_id),
  }))

  const hits = sweep(rules, candidates, seen)
  if (hits.length > 0) {
    // 유니크 (rule_id, source_id) 가 최종 방어다 — 크론 둘이 동시에 돌아도 한 줄이다
    await (db as any).from('rfp_radar_hits').insert(hits.map((h) => ({
      org_id: orgId,
      rule_id: h.ruleId,
      source_id: h.sourceId,
      pre_score: h.score,
      reason: h.reason,
      status: 'new',
    })))
  }

  await (db as any)
    .from('rfp_radar_rules')
    .update({ last_swept_at: new Date().toISOString() })
    .in('id', rules.map((r: { id: string }) => r.id))

  // 몇 건을 새로 모았는지 화면이 말해야 한다 — 「0건」이 «없다»인지 «못 가져왔다»인지 갈린다
  return NextResponse.json({ hits, swept: candidates.length, collected, siteResults })
}

/**
 * 크론이 돌 조직. 지금은 하나지만 늘면 여기서 갈린다.
 *
 * 세션이 없으니 `rfp_default_org` 를 못 쓴다 — 그 함수는 지금 로그인한 사람의 조직을 준다.
 */
async function firstOrgId(db: unknown): Promise<string | null> {
  const { data } = await (db as any).from('rfp_orgs').select('id').order('created_at').limit(1)
  const row = ((data ?? []) as { id?: unknown }[])[0]
  return row?.id ? String(row.id) : null
}
