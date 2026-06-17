import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { logId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
  }

  const logId = typeof body.logId === 'string' ? body.logId.trim() : null
  if (!logId) return NextResponse.json({ error: 'logId 필요' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: childLog } = await (supabase.from('daily_logs') as any)
    .select('id, content, parent_log_id, flow_reason')
    .eq('id', logId)
    .eq('user_id', user.id)
    .eq('is_onboarding', false)  // onboarding: AI 파생관계 설명 입력 — 실습 행은 분석 대상 제외
    .single()

  if (!childLog) return NextResponse.json({ error: '로그를 찾을 수 없습니다' }, { status: 404 })

  // 이미 생성된 경우 바로 반환
  if (childLog.flow_reason) return NextResponse.json({ flow_reason: childLog.flow_reason })

  // 부모 없으면 null
  if (!childLog.parent_log_id) return NextResponse.json({ flow_reason: null })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parentLog } = await (supabase.from('daily_logs') as any)
    .select('id, content')
    .eq('id', childLog.parent_log_id)
    .eq('is_onboarding', false)  // onboarding: AI 파생관계 설명 입력 — 실습 행 제외
    .single()

  if (!parentLog) return NextResponse.json({ flow_reason: null })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (adminClient as any)
    .from('org_content').select('value').eq('key', 'META').single()

  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })

  const prompt = `다음 두 업무의 파생 관계를 한 문장(25자 이내)으로 설명해주세요.
부모 업무: ${parentLog.content}
자식 업무: ${childLog.content}

답변 형식: "~에서 파생" 또는 "~를 위해" 등 간결하게.
한 문장만 출력하세요.`

  let geminiRes: Response
  try {
    geminiRes = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    )
  } catch {
    return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
  }

  if (!geminiRes.ok) {
    return NextResponse.json({ error: `AI API 오류 (${geminiRes.status})` }, { status: 502 })
  }

  const geminiData = await geminiRes.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const flowReason = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null

  if (flowReason) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('daily_logs') as any)
      .update({ flow_reason: flowReason })
      .eq('id', logId)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ flow_reason: flowReason })
}
