import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { refineWeeklyReport, type WeeklyRow } from '@/lib/gemini-refine'

const isEmpty = (s: string) =>
  !s || s === '<p></p>' || s === '<p><br></p>' || s.trim() === '' || s === '-'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { rows?: unknown; prevCategories?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const { rows, prevCategories } = body

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '보고서 내용이 없습니다' }, { status: 400 })
  }

  const validRows: WeeklyRow[] = rows.map((row) => {
    const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
    return {
      category: typeof r.category === 'string' ? r.category : '',
      performance: typeof r.performance === 'string' ? r.performance : '',
      plan: typeof r.plan === 'string' ? r.plan : '',
      issues: typeof r.issues === 'string' ? r.issues : '',
    }
  })

  const hasContent = validRows.some(
    (r) => !isEmpty(r.performance) || !isEmpty(r.plan) || !isEmpty(r.issues)
  )
  if (!hasContent) {
    return NextResponse.json({ error: '내용을 먼저 작성해 주세요' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (createAdminClient() as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()

  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model =
    typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI 키가 설정되지 않았습니다 (관리자에게 문의)' },
      { status: 500 }
    )
  }

  try {
    const refined = await refineWeeklyReport(validRows, apiKey, model, user.id)

    // New categories (not in prev week) bubble to top
    const prevCats = Array.isArray(prevCategories) ? (prevCategories as string[]) : []
    const newRows = refined.filter((r) => !prevCats.includes(r.category))
    const oldRows = refined.filter((r) => prevCats.includes(r.category))

    return NextResponse.json({ rows: [...newRows, ...oldRows] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '정비 중 오류가 발생했습니다'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
