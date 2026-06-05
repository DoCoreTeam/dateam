import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { saveCompetitorPrices, type CompetitorPriceItem } from '@/lib/gpu/competitor-import'
import { dedupCompetitor } from '@/lib/gpu/dedup'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// POST /api/pricing/gpu/market/import — AI 추출 경쟁가 미리보기를 사용자가 '반영' 클릭 시 실제 저장
//  body: { items: CompetitorPriceItem[], source_url?: string|null }
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: { items?: unknown; source_url?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  // 공용 dedup(lib/gpu/dedup) — 반영 직전 중복 제거. 추출 단계와 동일 키 = 단일 구현 재사용. (50건 상한 일관성)
  const items = dedupCompetitor(Array.isArray(body.items) ? (body.items as CompetitorPriceItem[]) : []).slice(0, 50)
  if (items.length === 0) return NextResponse.json({ error: '반영할 가격이 없습니다' }, { status: 400 })
  const sourceUrl = typeof body.source_url === 'string' ? body.source_url : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saved = await saveCompetitorPrices(createAdminClient() as any, items, sourceUrl)
  if (saved.length === 0) return NextResponse.json({ error: '유효한 경쟁가가 없습니다' }, { status: 422 })
  revalidateGpu()
  return NextResponse.json({ saved, count: saved.length })
}
