// GET /api/pricing/gpu/gcube — gcube 사이트 상품과 우리 모델 연결 목록
//
// 화면 /pricing/gpu 의 연결 창과 teamda gpu gcube list 가 이 창구 하나를 쓴다
// 읽기는 사용자 클라이언트(RLS, 로그인한 사람 읽기)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { listGcubeListings } from '@/lib/gpu/gcube-store'

export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    return NextResponse.json({ listings: await listGcubeListings(supabase) })
  } catch (err) {
    console.error('[pricing/gpu/gcube]', err)
    return NextResponse.json({ error: '불러오기에 실패했습니다' }, { status: 500 })
  }
}
