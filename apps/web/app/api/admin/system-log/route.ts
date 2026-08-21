// GET /api/admin/system-log — 관리자가 읽는 시스템 사건 목록
//
// **지문 단위로 접어서** 돌려준다. 같은 오류 500건은 500줄이 아니라 1줄 + "500번"이다.
// 안 접으면 화면이 500줄이 되고, 500줄은 아무도 안 읽는다.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { featureLabel, sourceLabel, reasonLabel } from '@/lib/system-log/labels'

export const dynamic = 'force-dynamic'

/** 한 번에 볼 지문 수 상한 — 목록 표준(§2-6)의 100과 같다 */
const MAX_LIMIT = 100
/** 접기 전에 훑는 원본 사건 수. 이보다 오래된 것은 기간 필터로 좁혀 본다 */
const SCAN_LIMIT = 2000

interface Row {
  id: string; fingerprint: string; occurred_at: string
  source: string; severity: string; reason: string
  feature: string | null; route: string | null
  actor_id: string | null; headline: string; detail: string
  raw: string | null; context: Record<string, unknown> | null
  resolved_at: string | null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: { message: '로그인이 필요합니다.' } }, { status: 401 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any

  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: { message: '관리자만 볼 수 있습니다.' } }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Number(sp.get('limit')) || 20, MAX_LIMIT)
  const days = Math.min(Number(sp.get('days')) || 7, 90)
  const reason = sp.get('reason') ?? ''
  const source = sp.get('source') ?? ''
  const q = (sp.get('q') ?? '').trim()
  // 기본은 '아직 안 본 것'만 — 처리한 일까지 섞이면 지금 급한 것이 묻힌다
  const showResolved = sp.get('resolved') === '1'

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  let query = adm.from('system_events')
    .select('id,fingerprint,occurred_at,source,severity,reason,feature,route,actor_id,headline,detail,raw,context,resolved_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(SCAN_LIMIT)

  if (reason) query = query.eq('reason', reason)
  if (source) query = query.eq('source', source)
  if (!showResolved) query = query.is('resolved_at', null)
  if (q) query = query.or(`headline.ilike.%${q}%,detail.ilike.%${q}%,raw.ilike.%${q}%`)

  const { data, error } = await query
  if (error) {
    /**
     * 표가 아직 없는 환경(마이그레이션 전)에서도 **화면은 열려야 한다.**
     * 빈 목록 대신 무슨 일인지 말한다 — 관측 화면이 조용히 비면 "아무 일 없음"으로 읽힌다.
     */
    /**
     * 실측(v0.7.580): Supabase 는 표가 없을 때
     * `Could not find the table 'public.system_events' in the schema cache` 라고 말한다.
     * Postgres 원문(`relation ... does not exist`)만 보면 이 경우를 놓쳐,
     * 화면이 사람 말 대신 영어 오류를 그대로 보여 준다.
     */
    const notReady = /does not exist|relation|could not find the table|schema cache/i
      .test(error.message ?? '')
    return NextResponse.json({
      items: [], total: 0,
      notice: notReady
        ? '시스템 로그 표가 아직 만들어지지 않았습니다. 마이그레이션 218을 적용해 주세요.'
        : `시스템 로그를 읽지 못했습니다: ${error.message}`,
    })
  }

  const rows = (data ?? []) as Row[]

  // 사람 이름을 붙인다 — "누가 겪었나"가 관리자의 심각도 판단 근거다
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[]
  const nameMap: Record<string, string> = {}
  if (actorIds.length > 0) {
    const { data: profiles } = await adm.from('profiles').select('id,name').in('id', actorIds)
    for (const p of (profiles ?? []) as { id: string; name: string | null }[]) {
      nameMap[p.id] = p.name ?? '이름 없음'
    }
  }

  // 지문으로 접는다 — 최신 한 건의 문장을 대표로 쓰고, 나머지는 횟수로 센다
  const groups = new Map<string, {
    fingerprint: string; count: number; firstAt: string; lastAt: string
    latest: Row; actors: Set<string>; suppressed: number
  }>()
  for (const r of rows) {
    const g = groups.get(r.fingerprint)
    const extra = Number((r.context ?? {}).suppressed ?? 0) || 0
    if (!g) {
      groups.set(r.fingerprint, {
        fingerprint: r.fingerprint, count: 1 + extra,
        firstAt: r.occurred_at, lastAt: r.occurred_at, latest: r,
        actors: new Set(r.actor_id ? [r.actor_id] : []), suppressed: extra,
      })
      continue
    }
    g.count += 1 + extra
    g.suppressed += extra
    // 정렬이 내림차순이라 뒤에 오는 것이 더 오래된 것이다
    if (r.occurred_at < g.firstAt) g.firstAt = r.occurred_at
    if (r.actor_id) g.actors.add(r.actor_id)
  }

  const SEVERITY_RANK: Record<string, number> = { critical: 0, error: 1, warn: 2 }
  const items = Array.from(groups.values())
    .sort((a, b) => {
      const s = (SEVERITY_RANK[a.latest.severity] ?? 3) - (SEVERITY_RANK[b.latest.severity] ?? 3)
      return s !== 0 ? s : (a.lastAt < b.lastAt ? 1 : -1)
    })
    .slice(0, limit)
    .map((g) => {
      const sample = Array.from(g.actors)[0]
      return {
        id: g.latest.id,
        fingerprint: g.fingerprint,
        severity: g.latest.severity,
        reason: g.latest.reason,
        reasonLabel: reasonLabel(g.latest.reason),
        source: g.latest.source,
        sourceLabel: sourceLabel(g.latest.source),
        featureLabel: g.latest.feature ? featureLabel(g.latest.feature) : null,
        headline: g.latest.headline,
        detail: g.latest.detail,
        route: g.latest.route,
        raw: g.latest.raw,
        count: g.count,
        firstAt: g.firstAt,
        lastAt: g.lastAt,
        // 모르면 안 쓴다 — "0명"은 "아무도 안 겪었다"는 틀린 사실이 된다
        actorCount: g.actors.size || null,
        actorSample: sample ? (nameMap[sample] ?? '알 수 없음') : null,
        resolvedAt: g.latest.resolved_at,
      }
    })

  return NextResponse.json({
    items,
    total: groups.size,
    scanned: rows.length,
    // 훑기 상한에 닿았으면 밝힌다 — 조용히 자르면 "이게 전부"로 읽힌다
    capped: rows.length >= SCAN_LIMIT,
  })
}
