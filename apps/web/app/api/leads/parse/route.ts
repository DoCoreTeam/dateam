import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseLeadInput, scoreFit } from '@/lib/gemini-lead'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { raw_input?: string; source?: string }
  const rawInput = body.raw_input ?? ''
  const source = body.source ?? 'prompt'

  if (!rawInput.trim()) {
    return NextResponse.json({ error: '입력 내용이 없습니다' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const settingsRes = await adm.from('org_content').select('value').eq('key', 'META').single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (settingsRes.data?.value as any) ?? {}
  const apiKey: string = meta.gemini_api_key ?? process.env.GEMINI_API_KEY ?? ''
  const model: string = meta.gemini_model ?? 'gemini-2.0-flash'

  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 500 })
  }

  try {
    const parsed = await parseLeadInput(rawInput, apiKey, model)

    const fitResult = parsed.company_name
      ? await scoreFit({
          name: parsed.company_name ?? '',
          industry: parsed.industry ?? null,
          segment: parsed.segment ?? null,
          size: parsed.size ?? null,
          region: parsed.region ?? null,
        }, apiKey, model)
      : null

    const fitScore = fitResult?.fit_score ?? parsed.fit_score ?? null
    if (fitResult) {
      parsed.fit_score = fitScore ?? undefined
      parsed.fit_reason = fitResult.fit_reason
    }

    const { data: intake, error } = await adm.from('lead_intakes').insert({
      user_id: user.id,
      source,
      raw_input: rawInput,
      status: 'completed',
      parsed_data: parsed,
      fit_score: fitScore,
    }).select().single()

    if (error) throw error

    return NextResponse.json({ success: true, intake, parsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
