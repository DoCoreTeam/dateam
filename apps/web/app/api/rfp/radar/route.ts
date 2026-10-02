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
import { sweepRanges, sweepTruncated } from '@/lib/rfp/radar/sweep-scope'
import { attachNotices } from '@/lib/rfp/radar/hit-notice'
import { listStatusOf } from '@/lib/rfp/radar/hit-status'
import {
  pageOf, groupHits, slicePage, MAX_SCAN, queryOf, matchesQuery, sortRows, sortKeyOf,
  type RawHit,
} from '@/lib/rfp/radar/hit-page'

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
  const params = new URL(req.url).searchParams
  const status = listStatusOf(params.get('status'))
  const page = pageOf(params.get('offset'), params.get('limit'))

  /*
    **묶은 다음에 자른다.** 적중은 규칙마다 하나씩 생기므로 같은 공고가 여러 줄로 온다.
    자른 다음 묶으면 한 공고의 적중이 쪽 경계에 걸쳐 묶여도 소용이 없다.

    그래서 상한까지 읽어 묶고 그 뒤에 쪽을 자른다. 적중이 MAX_SCAN 을 넘으면
    점수 낮은 쪽부터 안 보이는데, 그 사실을 응답에 담아 화면이 말할 수 있게 한다.
  */
  const { data, error } = await (db as any)
    .from('rfp_radar_hits')
    .select('id, rule_id, source_id, case_id, pre_score, reason, status, created_at')
    .eq('status', status)
    .order('pre_score', { ascending: false })
    // 점수가 같으면 순서가 흔들려 같은 줄이 두 쪽에 나뉜다
    .order('id', { ascending: true })
    .limit(MAX_SCAN)

  if (error) return NextResponse.json({ error: '후보를 불러오지 못했습니다' }, { status: 500 })

  const grouped = groupHits((data ?? []) as RawHit[])

  /*
    **좁히기는 공고 정보가 붙은 뒤에 한다.** 제목과 발주처는 적중이 아니라 공고가 들고 있어서,
    붙이기 전에 거르면 찾을 글자가 어디에도 없다.

    그래서 묶은 전부에 공고를 붙이고 → 거르고 → 세우고 → 자른다.
    상한이 2000건이라 이 일이 한 요청 안에서 끝난다.
  */
  const withNotice = await attachNotices(db as never, grouped)
  const q = queryOf(params.get('q'))
  const filtered = q ? withNotice.filter((h) => matchesQuery(h.notice, q)) : withNotice
  const sorted = sortRows(filtered, sortKeyOf(params.get('sort')))

  // 배지는 **공고 수**를 센다. 적중 수를 세면 화면 줄 수와 안 맞는다
  const total = sorted.length
  const pageRows = slicePage(sorted, page)

  // 서버 첫 렌더와 **같은 함수**로 공고를 붙인다. 여기서 안 붙이면 훑기를 누른 직후
  // 클라이언트가 이 창구로 다시 받으면서 제목이 사라진다
  return NextResponse.json({
    hits: pageRows,
    total,
    offset: page.offset,
    limit: page.limit,
    // 상한에 닿았으면 화면이 그 사실을 말해야 한다 — 조용히 자르면 없는 것처럼 보인다
    truncated: (data ?? []).length >= MAX_SCAN,
  })
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

  /*
    **옛 공고도 본다.** 최근 500건만 읽던 시절, 공고 567건 중 옛 67건은 어떤 규칙에도
    안 걸렸다(실측 2026-10-01). 규칙을 새로 만들어도 그 전에 들어온 공고에는 영영 안 걸려
    사용자는 「규칙이 안 먹는다」로 읽는다.

    한 번에 다 읽지는 않는다 — 공고는 계속 쌓이고, 한 요청이 전부를 읽으려 들면
    어느 날부터 그 요청이 죽는다. 죽으면 아무것도 안 걸린다. 그래서 나눠 돈다.
  */
  const { count: sourceTotal } = await (db as any)
    .from('rfp_sources')
    .select('id', { count: 'exact', head: true })

  const ranges = sweepRanges(sourceTotal ?? 0)
  const sourceRows: Record<string, unknown>[] = []
  for (const r of ranges) {
    const { data: part } = await (db as any)
      .from('rfp_sources')
      .select('id, notice_no, title, announcing_agency, budget_amount, notice_date')
      .order('notice_date', { ascending: false })
      // 같은 날짜가 여럿이면 쪽마다 순서가 흔들려 어떤 공고는 영영 안 읽힌다
      .order('id', { ascending: true })
      .range(r.offset, r.offset + r.limit - 1)
    if (!part || part.length === 0) break
    sourceRows.push(...(part as Record<string, unknown>[]))
  }

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
  return NextResponse.json({
    hits,
    swept: candidates.length,
    collected,
    siteResults,
    // 이번에 다 못 봤으면 말한다. 조용히 끊으면 안 걸린 공고가 없는 것처럼 보인다
    sweepTruncated: sweepTruncated(sourceTotal ?? 0),
  })
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
