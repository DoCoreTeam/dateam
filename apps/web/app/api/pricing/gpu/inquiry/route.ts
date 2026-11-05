// GET  /api/pricing/gpu/inquiry?product_id=&lang= — 그 상품이 든 모델의 가장 싼 공급사, 담당자 메일 전화, 홈페이지, 문의 글
//      lang 은 ko 또는 en, 안 주면 공급사 나라로 (한국이면 ko, 그 밖과 모름은 en), 두 언어 글은 drafts 에 다 있다
// POST /api/pricing/gpu/inquiry — 문의한 사실을 이력(inquiry_sent)에 남긴다, body: { product_id, vendor, channel }
//
// 메일은 서버가 보내지 않는다 (화면이 메일 앱을 열거나 글을 복사한다), 계산과 글은 lib/gpu/inquiry.ts
// 화면 /pricing/gpu 의 문의하기와 teamda gpu inquiry get, gpu inquiry create 가 이 창구 하나를 쓴다

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { isInquiryLang, isUuid, parseInquiryRecord, type InquiryRecordIn } from '@/lib/gpu/inquiry'
import { getInquiry, recordInquiry } from '@/lib/gpu/inquiry-store'

const NOT_FOUND: Record<string, string> = {
  no_product: '그 상품이 든 모델이 없습니다',
  no_vendor: '이 모델에는 문의할 공급사 값이 없습니다',
}

export async function GET(req: Request) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const params = new URL(req.url).searchParams
  const productId = params.get('product_id')
  const lang = params.get('lang')
  if (!isUuid(productId)) return NextResponse.json({ error: 'product_id 는 상품 uuid 입니다' }, { status: 400 })
  if (lang !== null && !isInquiryLang(lang)) return NextResponse.json({ error: 'lang 은 ko 또는 en 입니다' }, { status: 400 })
  try {
    const result = await getInquiry(await createClient(), productId, lang)
    if (!result.ok) return NextResponse.json({ error: NOT_FOUND[result.code], code: result.code }, { status: result.status })
    return NextResponse.json(result.inquiry)
  } catch (err) {
    console.error('[pricing/gpu/inquiry GET]', err)
    return NextResponse.json({ error: '불러오기에 실패했습니다' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const body = (await req.json().catch(() => null)) as InquiryRecordIn | null
  const parsed = parseInquiryRecord(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const result = await recordInquiry(await createClient(), createAdminClient(), auth.user.email ?? auth.user.id, parsed.value)
    if (!result.ok) return NextResponse.json({ error: NOT_FOUND.no_product, code: 'no_product' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[pricing/gpu/inquiry POST]', err)
    return NextResponse.json({ error: '기록하지 못했습니다' }, { status: 500 })
  }
}
