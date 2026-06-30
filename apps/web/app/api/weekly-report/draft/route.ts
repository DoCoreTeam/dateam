import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { itemsToWeeklyRows } from '@/lib/weekly-report/serialize'
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

  // 2) 확정본 동기화 — 포함 항목을 weekly_reports로 직렬화(기존 뷰·취합 호환).
  //    빈 직렬화면 replace_weekly_report 스킵 → 기존 확정본을 비우지 않음(명시 초기화는 별도 경로).
  const serializedRows = itemsToWeeklyRows(items)
  if (serializedRows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase as any).rpc('replace_weekly_report', {
      p_week_start: week,
      p_rows: serializedRows,
    })
    if (rpcErr) {
      console.error('[api/weekly-report/draft PUT] replace_weekly_report 실패', rpcErr)
      return NextResponse.json({ error: '확정본 동기화 실패' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, count: items.length, synced: serializedRows.length })
}
