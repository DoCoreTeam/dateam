import { namesFromDirectory } from '@/lib/ai/known-names'
import { guardedGeminiText } from '@/lib/ai/guarded-gemini'
import { createAiLedger } from '@/lib/ai/ledger'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import type { AiFeature } from '@/types/database'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini-model'


const ACTIVITY_PARSE_PROMPT = `당신은 B2B 영업 활동 기록 전문가입니다. 아래 영업 활동 메모를 간결하고 핵심적인 CRM 로그로 정리해주세요.

정리 규칙:
1. 핵심 내용만 남기고 불필요한 수식어 제거
2. 날짜, 담당자, 주요 논의사항, 다음 액션을 명확히
3. 200자 이내로 요약
4. 원본에 없는 내용 추가 금지

반환: {"summary": "정리된 내용"} JSON만`

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const body = await req.json() as { deal_id: string; raw_text: string }
  if (!body.raw_text?.trim()) return NextResponse.json({ error: '내용 없음' }, { status: 400 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsRes = await (adminClient as any).from('org_content').select('value').eq('key', 'META').single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (settingsRes.data?.value as any) ?? {}
  const apiKey: string = meta.gemini_api_key ?? process.env.GEMINI_API_KEY ?? ''
  const model: string = meta.gemini_model ?? DEFAULT_GEMINI_MODEL

  if (!apiKey) return NextResponse.json({ error: 'Gemini API 키 미설정' }, { status: 500 })

  // 딜 메모에는 사람 이름과 통화 내용이 섞인다. 가림과 기록을 지나 나간다
  let out
  try {
    out = await guardedGeminiText({
      prompt: `${ACTIVITY_PARSE_PROMPT}\n\n메모:\n${body.raw_text}`,
      apiKey, model, surface: 'deals/ai-parse', purpose: 'deal_activity_parse',
      ledger: createAiLedger(adminClient as never), actorId: auth.user.id,
      // 딜 메모는 이미 아는 사람을 이야기한다. 주소록 이름을 주면 그대로 가려진다
      knownNames: await namesFromDirectory(adminClient as never),
    })
  } catch {
    return NextResponse.json({ error: 'Gemini API 오류' }, { status: 500 })
  }
  const text = out.text
  if (!text) return NextResponse.json({ error: 'Gemini 응답 없음' }, { status: 500 })

  logTokenUsage({
    userId: auth.user.id,
    feature: 'deal-activity-parse' as AiFeature,
    model,
    promptTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    totalTokens: out.inputTokens + out.outputTokens,
  })

  try {
    const parsed = JSON.parse(text) as { summary?: string }
    return NextResponse.json({ summary: parsed.summary ?? body.raw_text })
  } catch {
    return NextResponse.json({ summary: body.raw_text })
  }
}
