import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logTokenUsage } from '@/lib/token-logger'
import { enrichCompany, type CompanyEnrichInput } from '@/lib/gpu/company-enrich'

// POST /api/pricing/gpu/company-enrich — 회사 정보 AI 자동채움(제안)
//   body { name, website?, kind: 'supplier'|'competitor' }
//   → { result: {description,country,type,location,website,pricing_url} }
//   §5-3: 제안만 반환. 저장은 클라이언트가 폼에서 사용자 확인 후 수행(DB 자동 쓰기 없음).
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '회사명이 필요합니다' }, { status: 400 })
  const kind = body.kind === 'supplier' ? 'supplier' : 'competitor'
  const website = typeof body.website === 'string' && body.website.trim() ? body.website.trim() : null

  // Gemini 설정 (org_content META)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data: metaRow } = await db.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'
  if (!apiKey) return NextResponse.json({ error: 'AI가 설정되지 않았습니다(관리자에 문의)' }, { status: 503 })

  const input: CompanyEnrichInput = { name, website, kind }
  try {
    const { result, usage } = await enrichCompany(input, apiKey, model)
    logTokenUsage({
      userId: auth.user.id, feature: 'gpu-company-enrich', model,
      promptTokens: usage.promptTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
    })
    return NextResponse.json({ result })
  } catch (err) {
    console.error('[gpu/company-enrich]', err)
    return NextResponse.json({ error: 'AI 정보 조회에 실패했습니다' }, { status: 502 })
  }
}
