import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DraftItem } from '@/lib/weekly-report/draft-types'
import {
  clampText,
  generateForWeek,
  isValidWeekStart,
  loadItems,
  MAX_CATEGORY_LEN,
  MAX_CONTENT_LEN,
  MAX_ITEMS,
  MAX_SOURCE_REF_BYTES,
} from '@/lib/weekly-report/draft-server'

const VALID_SECTIONS = new Set(['performance', 'plan', 'issues'])

export async function GET(req: NextRequest) {
  const week = req.nextUrl.searchParams.get('week')
  if (!week || !isValidWeekStart(week)) {
    return NextResponse.json({ error: 'week 파라미터는 월요일(YYYY-MM-DD)이어야 합니다' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // 1) 저장본 있으면 그대로 로드(멱등 — AI 재호출 없음)
  const existing = await loadItems(supabase, user.id, week)
  if (existing === null) return NextResponse.json({ error: '초안 조회 실패' }, { status: 500 })
  if (existing.length > 0) return NextResponse.json({ items: existing, generated: false })

  // 2) 이미 생성 기록이 있으면(0건 초안 포함) 재생성 안 함 — 반복 Gemini 호출/비용 차단
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: genRow } = await (supabase.from('weekly_report_draft_gen') as any)
    .select('user_id').eq('user_id', user.id).eq('week_start', week).maybeSingle()
  if (genRow) return NextResponse.json({ items: [], generated: false })

  // 3) 생성 클레임 — 동시 첫진입 레이스 시 한쪽만 생성(중복 토큰/행 방지)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: claimErr } = await (supabase.from('weekly_report_draft_gen') as any)
    .insert({ user_id: user.id, week_start: week })
  if (claimErr) {
    // 이미 다른 요청이 생성 중 — 그쪽 결과를 로드해 반환(레이스 루저)
    const items = await loadItems(supabase, user.id, week)
    return NextResponse.json({ items: items ?? [], generated: false })
  }

  // 4) 클레임 획득 → 생성. 실패 시 클레임 회수(다음 진입 재시도 보장)
  try {
    const items = await generateForWeek(supabase, user.id, week)
    return NextResponse.json({ items, generated: true })
  } catch (err) {
    console.error('[api/weekly-report/draft GET] 생성 실패', err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weekly_report_draft_gen') as any)
      .delete().eq('user_id', user.id).eq('week_start', week)
    return NextResponse.json({ error: '초안 생성 중 오류가 발생했습니다' }, { status: 500 }) // 원문은 로그만(키 누출 방지)
  }
}

export async function PUT(req: NextRequest) {
  const week = req.nextUrl.searchParams.get('week')
  if (!week || !isValidWeekStart(week)) {
    return NextResponse.json({ error: 'week 파라미터는 월요일(YYYY-MM-DD)이어야 합니다' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { items?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items 배열이 필요합니다' }, { status: 400 })
  }
  if (body.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `항목은 최대 ${MAX_ITEMS}개까지` }, { status: 400 })
  }

  // 입력 검증 + 상한 절단(저장형 DoS 방지). section은 화이트리스트 강제 — 위반 시 400(묵음 강등 금지).
  const items: DraftItem[] = []
  for (let i = 0; i < body.items.length; i++) {
    const o = (typeof body.items[i] === 'object' && body.items[i] !== null ? body.items[i] : {}) as Record<string, unknown>
    if (typeof o.section !== 'string' || !VALID_SECTIONS.has(o.section)) {
      return NextResponse.json({ error: `잘못된 section 값 (항목 ${i})` }, { status: 400 })
    }
    let sourceRef: DraftItem['sourceRef'] = null
    if (o.sourceRef && typeof o.sourceRef === 'object') {
      const sr = JSON.stringify(o.sourceRef)
      if (sr.length <= MAX_SOURCE_REF_BYTES) sourceRef = o.sourceRef as DraftItem['sourceRef']
    }
    items.push({
      category: clampText(o.category, MAX_CATEGORY_LEN),
      section: o.section as DraftItem['section'],
      content: clampText(o.content, MAX_CONTENT_LEN),
      origin: o.origin === 'auto' ? 'auto' : 'manual',
      confidence: typeof o.confidence === 'number' ? o.confidence : null,
      isIncluded: o.isIncluded !== false,
      sourceRef,
      sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : i,
    })
  }

  // 1) 작업영역(items) 교체 저장 — 단일 트랜잭션 RPC(delete+insert 부분실패 방지)
  const itemRows = items.map((it, i) => ({
    category: it.category,
    section: it.section,
    content: it.content,
    origin: it.origin,
    confidence: it.confidence,
    is_included: it.isIncluded,
    source_ref: it.sourceRef ?? null,
    sort_order: typeof it.sortOrder === 'number' ? it.sortOrder : i,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemErr } = await (supabase as any).rpc('replace_weekly_report_items', {
    p_week_start: week,
    p_items: itemRows,
  })
  if (itemErr) {
    console.error('[api/weekly-report/draft PUT] replace_weekly_report_items 실패', itemErr)
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }

  // 2) 확정본(weekly_reports)에는 여기서 절대 쓰지 않는다 (단일 Writer 원칙 — 마이그144/유실0).
  //    과거: 포함 항목을 replace_weekly_report로 직렬화해 확정본을 덮었으나, 고인/부분 초안이
  //    사용자 수동작성 확정본을 무경고로 clobber하는 유실 경로였다(이도현 06-29 사고).
  //    확정본에 쓰는 유일 경로 = 사용자 폼 저장(actions.upsertWeeklyReport). 초안은 작업영역만 보관하고
  //    "폼에 반영"(클라이언트 state)→사용자 검토→저장으로 반영된다.
  return NextResponse.json({ ok: true, count: items.length })
}
