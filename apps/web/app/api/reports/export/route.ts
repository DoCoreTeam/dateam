import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildDocx } from '@/lib/docx-builder'
import { Packer } from 'docx'
import type { WeeklyReport } from '@/types/database'

type ReportWithProfile = WeeklyReport & { profiles: { name: string } | null }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: 'week 파라미터가 필요합니다' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (adminClient as any)
    .from('weekly_reports')
    .select('*, profiles(name)')
    .eq('week_start', week)
    .is('deleted_at', null)
    .order('category')

  if (member) query = query.eq('user_id', member)

  const { data: reports, error } = await query as { data: ReportWithProfile[] | null; error: unknown }

  if (error) return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  if (!reports || reports.length === 0) {
    return NextResponse.json({ error: '해당 주차 데이터가 없습니다' }, { status: 404 })
  }

  const rows = reports.map((r) => ({
    userName: r.profiles?.name ?? '알 수 없음',
    category: r.category,
    performance: r.performance,
    plan: r.plan,
    issues: r.issues,
    weekStart: r.week_start,
  }))

  const { doc, filename } = buildDocx(rows)
  const buffer = await Packer.toBuffer(doc)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
