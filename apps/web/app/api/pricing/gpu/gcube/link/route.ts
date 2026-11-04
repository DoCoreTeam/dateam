// PATCH /api/pricing/gpu/gcube/link — gcube 상품과 우리 모델을 잇거나 푼다 (관리자)
//
// body: { links: [{ ser: number, product_id: string | null }] }  product_id 가 null 이면 해제
// 모델 하나에 상품 하나, 이미 다른 상품에 이어진 모델은 409
// 화면의 연결 창과 teamda gpu gcube link 가 이 창구 하나를 쓴다

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { linkGcubeListings, MAX_LINKS_PER_CALL } from '@/lib/gpu/gcube-store'

const bodySchema = z.object({
  links: z.array(z.object({
    ser: z.number().int().positive(),
    product_id: z.string().uuid().nullable(),
  })).min(1).max(MAX_LINKS_PER_CALL),
})

const LINK_ERRORS = {
  not_found: { status: 404, error: '없는 gcube 상품이 있습니다' },
  product_taken: { status: 409, error: '이미 다른 gcube 상품에 이어진 모델입니다' },
  product_missing: { status: 400, error: '없는 모델입니다' },
} as const

export async function PATCH(req: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: `links 는 ser 와 product_id 를 가진 1~${MAX_LINKS_PER_CALL}개입니다` }, { status: 400 })
  }
  try {
    const result = await linkGcubeListings(createAdminClient(), auth.user.email ?? auth.user.id, auth.user.id, parsed.data.links)
    if (typeof result === 'string') {
      const e = LINK_ERRORS[result]
      return NextResponse.json({ error: e.error, code: result }, { status: e.status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[pricing/gpu/gcube/link]', err)
    return NextResponse.json({ error: '저장하지 못했습니다' }, { status: 500 })
  }
}
