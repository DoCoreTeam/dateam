// GET /api/pricing/gpu/board — GPU 한 장 화면, 모델마다 공급사 값 전부와 판매가
//
// 줄 = 모델명 + 장당 메모리, 금액 = 원화 1장 1시간 (계산은 lib/gpu/board.ts)
// 화면 /pricing/gpu 와 teamda gpu board list 가 이 창구 하나를 쓴다

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { getGpuBoard } from '@/lib/gpu/board-data'

export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    return NextResponse.json(await getGpuBoard(supabase))
  } catch (err) {
    console.error('[pricing/gpu/board]', err)
    return NextResponse.json({ error: '불러오기에 실패했습니다' }, { status: 500 })
  }
}
