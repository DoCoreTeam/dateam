import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { mergeAndRefineByCategory } from '@/lib/gemini-refine'
import { type MergeContext, categoriesFromBodies } from '@/lib/weekly-merge-context'
import { prevWeekStart } from '@/lib/week'
import { orgScopeKey } from '@/lib/reports/org-scope-key'
import { reportsSourceHash } from '@/lib/reports/source-hash'
import type { WeeklyReport } from '@/types/database'

type ReportWithProfile = WeeklyReport & { profiles: { name: string } | null }

type PreviewRow = {
  userName: string; orgName: string; category: string
  performance: string; plan: string; issues: string; weekStart: string
}

const PREVIEW_FIELDS = ['userName', 'orgName', 'category', 'performance', 'plan', 'issues', 'weekStart'] as const
const MAX_ROWS = 500
const MAX_FIELD_LEN = 20000

interface ScopeCtx {
  user: { id: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any
  week: string
  member: string | null
  memberIds: string[] | null
  scopeKey: string
}

/** 공통: admin(비삭제) 인증 + 스코프 파라미터 파싱. 실패 시 { error: NextResponse }. */
async function resolveScope(
  week: string | null,
  member: string | null,
  membersCsv: string | null,
): Promise<{ ctx: ScopeCtx } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role, deleted_at').eq('id', user.id).single() as unknown as { data: { role: string; deleted_at: string | null } | null }
  if (!profile || profile.role !== 'admin' || profile.deleted_at !== null) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return { error: NextResponse.json({ error: 'week 파라미터가 필요합니다' }, { status: 400 }) }
  }

  // 빈 배열은 null로 정규화 → GET/POST/PUT 및 scope_key가 항상 동일 스코프를 가리킨다.
  const parsedIds = membersCsv ? membersCsv.split(',').filter(Boolean) : null
  const memberIds = parsedIds && parsedIds.length > 0 ? parsedIds : null
  const scopeKey = orgScopeKey(member, memberIds)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any
  return { ctx: { user, adminClient, week, member: member || null, memberIds, scopeKey } }
}

/** 저장된 취합본 조회 */
async function loadSaved(ctx: ScopeCtx): Promise<{ body: PreviewRow[]; sourceHash: string | null; updatedAt: string | null } | null> {
  const { data } = await ctx.adminClient
    .from('org_weekly_reports')
    .select('body, source_hash, updated_at')
    .eq('scope_key', ctx.scopeKey)
    .eq('week_start', ctx.week)
    .maybeSingle()
  if (!data) return null
  return {
    body: Array.isArray(data.body) ? (data.body as PreviewRow[]) : [],
    sourceHash: (data.source_hash as string | null) ?? null,
    updatedAt: (data.updated_at as string | null) ?? null,
  }
}

/** 편집 저장 페이로드 정규화 — 필드 화이트리스트 + 행/필드 크기 상한 (오염·팽창 방어) */
function sanitizeReports(input: unknown): PreviewRow[] | null {
  if (!Array.isArray(input) || input.length > MAX_ROWS) return null
  return input.map((row) => {
    const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const f of PREVIEW_FIELDS) {
      const v = typeof r[f] === 'string' ? (r[f] as string) : ''
      out[f] = v.length > MAX_FIELD_LEN ? v.slice(0, MAX_FIELD_LEN) : v
    }
    return out as unknown as PreviewRow
  })
}

/** GET — 저장된 취합본 조회(Gemini 미호출). mount 시 복원용. */
export async function GET(req: NextRequest) {
  try {
    const r = await resolveScope(
      req.nextUrl.searchParams.get('week'),
      req.nextUrl.searchParams.get('member'),
      req.nextUrl.searchParams.get('members'),
    )
    if ('error' in r) return r.error
    const saved = await loadSaved(r.ctx)
    return NextResponse.json({ reports: saved?.body ?? [], saved: !!saved, updatedAt: saved?.updatedAt ?? null })
  } catch (err: unknown) {
    console.error('[preview GET]', err)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

/** POST — AI 취합 실행 후 org_weekly_reports 에 UPSERT. 원본 무변경 시 저장본 재사용(Gemini skip). */
export async function POST(req: NextRequest) {
  try {
    const r = await resolveScope(
      req.nextUrl.searchParams.get('week'),
      req.nextUrl.searchParams.get('member'),
      req.nextUrl.searchParams.get('members'),
    )
    if ('error' in r) return r.error
    const ctx = r.ctx
    const force = req.nextUrl.searchParams.get('force') === '1'

    const { data: metaData } = await ctx.adminClient
      .from('org_content').select('value').eq('key', 'META').single()
    const meta = (metaData?.value as Record<string, unknown>) ?? {}
    const apiKey = meta.gemini_api_key as string | undefined
    const model = (meta.gemini_model as string | undefined) ?? 'gemini-1.5-flash'
    const orgName = (meta.org as string | undefined) || (meta.title as string | undefined) || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 400 })
    }

    let query = ctx.adminClient
      .from('weekly_reports')
      .select('*, profiles(name)')
      .eq('week_start', ctx.week)
      .is('deleted_at', null)
      .order('category')
    if (ctx.memberIds) query = query.in('user_id', ctx.memberIds)
    else if (ctx.member) query = query.eq('user_id', ctx.member)

    const { data: raw, error } = await query as { data: ReportWithProfile[] | null; error: unknown }
    if (error) return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
    if (!raw || raw.length === 0) {
      return NextResponse.json({ error: '해당 주차 데이터가 없습니다' }, { status: 404 })
    }

    const srcHash = reportsSourceHash(raw)
    const saved = await loadSaved(ctx)

    // 원본 변경이 없고 저장본이 있으면 Gemini 재호출 없이 저장본(편집분 포함) 반환.
    if (!force && saved && saved.sourceHash === srcHash && saved.body.length > 0) {
      return NextResponse.json({ reports: saved.body, saved: true, reused: true, updatedAt: saved.updatedAt })
    }

    const weekStart = raw[0]?.week_start ?? ctx.week

    // 컨텍스트 주입(엔진 B와 동일 SSOT):
    //  ① 전체 스코프면 지난주 취합본 구분 목록으로 구분 통일  ② 기존 편집본은 주제 기준 병합·보존
    let prevCategories: string[] = []
    if (!ctx.member && !ctx.memberIds) {
      const { data: prevSnaps, error: prevErr } = await ctx.adminClient
        .from('dept_weekly_reports').select('body').eq('week_start', prevWeekStart(ctx.week)) as { data: { body: unknown }[] | null; error: unknown }
      if (prevErr) console.error('[preview] 지난주 취합본 구분 조회 실패:', prevErr)
      else prevCategories = categoriesFromBodies((prevSnaps ?? []).map((s) => s.body))
    }
    const existingBody = (saved?.body ?? [])
      .map((b) => ({ category: b.category, performance: b.performance, plan: b.plan, issues: b.issues }))
      .filter((b) => b.category)

    let mergeCtx: MergeContext | undefined
    if (prevCategories.length > 0 || existingBody.length > 0) {
      mergeCtx = {
        ...(prevCategories.length > 0 ? { prevCategories } : {}),
        ...(existingBody.length > 0 ? { existingBody } : {}),
      }
    }

    const forMerge = raw.map((r2) => ({
      userName: r2.profiles?.name ?? '알 수 없음',
      category: r2.category,
      performance: r2.performance,
      plan: r2.plan,
      issues: r2.issues,
    }))

    const merged = await mergeAndRefineByCategory(forMerge, apiKey, model, ctx.user.id, mergeCtx)

    const reports: PreviewRow[] = merged.map((m) => ({
      userName: '',
      orgName,
      category: m.category,
      performance: m.performance,
      plan: m.plan,
      issues: m.issues,
      weekStart,
    }))

    const { error: upErr } = await ctx.adminClient.from('org_weekly_reports').upsert(
      { scope_key: ctx.scopeKey, week_start: ctx.week, body: reports, source_hash: srcHash, edited_by: ctx.user.id },
      { onConflict: 'scope_key,week_start' },
    )
    if (upErr) {
      console.error('[preview POST] upsert', upErr)
      return NextResponse.json({ error: '저장 실패' }, { status: 500 })
    }

    return NextResponse.json({ reports, saved: true, updatedAt: new Date().toISOString() })
  } catch (err: unknown) {
    console.error('[preview POST]', err)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

/** PUT — 편집된 취합본 저장(body UPSERT). source_hash는 미포함 → 기존값 보존(생성 스냅샷 유지). */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { week?: string; member?: string; members?: string; reports?: unknown }
    const r = await resolveScope(body.week ?? null, body.member ?? null, body.members ?? null)
    if ('error' in r) return r.error
    const ctx = r.ctx
    const reports = sanitizeReports(body.reports)
    if (!reports) return NextResponse.json({ error: 'reports 형식/크기 오류' }, { status: 400 })

    const { error: upErr } = await ctx.adminClient.from('org_weekly_reports').upsert(
      { scope_key: ctx.scopeKey, week_start: ctx.week, body: reports, edited_by: ctx.user.id },
      { onConflict: 'scope_key,week_start' },
    )
    if (upErr) {
      console.error('[preview PUT] upsert', upErr)
      return NextResponse.json({ error: '저장 실패' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[preview PUT]', err)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
