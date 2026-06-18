import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Release } from '@/lib/changelog/types'

// GET /api/changelog — 게시된 업데이트 내역(버전 클릭 모달용). 멤버 읽기. 미게시는 RLS+필터로 비노출.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('app_releases')
    .select('version, released_at, title, changes, type')
    .eq('is_published', true)
    .order('released_at', { ascending: false, nullsFirst: false })
    .order('version', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[api/changelog] error:', error.message)
    return NextResponse.json({ error: '업데이트 내역을 불러오지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json({ releases: (data ?? []) as Release[] })
}
