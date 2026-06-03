import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { mergeAndRefineByCategory } from '@/lib/gemini-refine'
import type { WeeklyReport } from '@/types/database'

type ReportWithProfile = WeeklyReport & { profiles: { name: string } | null }

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single() as unknown as { data: { role: string } | null }

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const week = req.nextUrl.searchParams.get('week')
    const member = req.nextUrl.searchParams.get('member')
    const membersCsv = req.nextUrl.searchParams.get('members') // 부서 필터 멤버 user_id csv
    const memberIds = membersCsv ? membersCsv.split(',').filter(Boolean) : null

    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ error: 'week 파라미터가 필요합니다' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createAdminClient() as any

    const { data: metaData } = await adminClient
      .from('org_content')
      .select('value')
      .eq('key', 'META')
      .single()

    const meta = (metaData?.value as Record<string, unknown>) ?? {}
    const apiKey = meta.gemini_api_key as string | undefined
    const model = (meta.gemini_model as string | undefined) ?? 'gemini-1.5-flash'
    const orgName = (meta.org as string | undefined) || (meta.title as string | undefined) || ''

    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 400 })
    }

    let query = adminClient
      .from('weekly_reports')
      .select('*, profiles(name)')
      .eq('week_start', week)
      .is('deleted_at', null)
      .order('category')

    if (memberIds) query = query.in('user_id', memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000'])
    else if (member) query = query.eq('user_id', member)

    const { data: raw, error } = await query as { data: ReportWithProfile[] | null; error: unknown }

    if (error) return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
    if (!raw || raw.length === 0) {
      return NextResponse.json({ error: '해당 주차 데이터가 없습니다' }, { status: 404 })
    }

    const forMerge = raw.map((r) => ({
      userName: r.profiles?.name ?? '알 수 없음',
      category: r.category,
      performance: r.performance,
      plan: r.plan,
      issues: r.issues,
    }))

    const weekStart = raw[0]?.week_start ?? new Date().toISOString().slice(0, 10)

    const merged = await mergeAndRefineByCategory(forMerge, apiKey, model, user.id)

    const reports = merged.map((r) => ({
      userName: '',
      orgName,
      category: r.category,
      performance: r.performance,
      plan: r.plan,
      issues: r.issues,
      weekStart,
    }))

    return NextResponse.json({ reports })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '서버 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
