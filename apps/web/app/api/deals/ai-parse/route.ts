import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import type { AiFeature } from '@/types/database'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const ACTIVITY_PARSE_PROMPT = `당신은 B2B 영업 활동 기록 전문가입니다. 아래 영업 활동 메모를 간결하고 핵심적인 CRM 로그로 정리해주세요.

정리 규칙:
1. 핵심 내용만 남기고 불필요한 수식어 제거
2. 날짜, 담당자, 주요 논의사항, 다음 액션을 명확히
3. 200자 이내로 요약
4. 원본에 없는 내용 추가 금지

반환: {"summary": "정리된 내용"} JSON만`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { deal_id: string; raw_text: string }
  if (!body.raw_text?.trim()) return NextResponse.json({ error: '내용 없음' }, { status: 400 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsRes = await (adminClient as any).from('org_content').select('value').eq('key', 'META').single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (settingsRes.data?.value as any) ?? {}
  const apiKey: string = meta.gemini_api_key ?? process.env.GEMINI_API_KEY ?? ''
  const model: string = meta.gemini_model ?? 'gemini-2.0-flash'

  if (!apiKey) return NextResponse.json({ error: 'Gemini API 키 미설정' }, { status: 500 })

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${ACTIVITY_PARSE_PROMPT}\n\n메모:\n${body.raw_text}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    cache: 'no-store',
  })

  if (!res.ok) return NextResponse.json({ error: 'Gemini API 오류' }, { status: 500 })
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return NextResponse.json({ error: 'Gemini 응답 없음' }, { status: 500 })

  logTokenUsage({
    userId: user.id,
    feature: 'deal-activity-parse' as AiFeature,
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  })

  try {
    const parsed = JSON.parse(text) as { summary?: string }
    return NextResponse.json({ summary: parsed.summary ?? body.raw_text })
  } catch {
    return NextResponse.json({ summary: body.raw_text })
  }
}
