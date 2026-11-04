// POST /api/pricing/gpu/gcube/fetch — gcube 사이트 판매가를 지금 가져온다 (관리자)
//
// 사이트 페이지 안 데이터를 ser 로 받아 덮어쓴다 (lib/gpu/gcube-store.ts)
// 화면의 「gcube 판매가 가져오기」 단추와 teamda gpu gcube fetch 가 이 창구 하나를 쓴다

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { fetchGcubeListings } from '@/lib/gpu/gcube-store'

export const maxDuration = 60

const FETCH_ERRORS = {
  site_unreachable: { status: 502, error: 'gcube 사이트에 닿지 못했습니다' },
  site_changed: { status: 502, error: 'gcube 사이트에서 가격 데이터를 찾지 못했습니다' },
} as const

export async function POST() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  try {
    const result = await fetchGcubeListings(createAdminClient(), auth.user.email ?? auth.user.id)
    if (typeof result === 'string') {
      const e = FETCH_ERRORS[result]
      return NextResponse.json({ error: e.error, code: result }, { status: e.status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[pricing/gpu/gcube/fetch]', err)
    return NextResponse.json({ error: '가져오지 못했습니다' }, { status: 500 })
  }
}
