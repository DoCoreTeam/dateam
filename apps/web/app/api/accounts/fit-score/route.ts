import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { scoreFit } from '@/lib/gemini-lead'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini-model'

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const body = await req.json() as { name: string; industry?: string; segment?: string; size?: string; region?: string }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsRes = await (adminClient as any).from('org_content').select('value').eq('key', 'META').single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (settingsRes.data?.value as any) ?? {}
  const apiKey: string = meta.gemini_api_key ?? process.env.GEMINI_API_KEY ?? ''
  const model: string = meta.gemini_model ?? DEFAULT_GEMINI_MODEL

  if (!apiKey) return NextResponse.json({ error: 'Gemini API 키 미설정' }, { status: 500 })

  try {
    const result = await scoreFit(body, apiKey, model, auth.user.id)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '오류' }, { status: 500 })
  }
}
