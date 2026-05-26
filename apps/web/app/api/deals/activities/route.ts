import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { probabilityForStage } from '@/lib/crm'
import type { AiFeature } from '@/types/database'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

type ActivityExtract = {
  summary?: string
  todos?: { title: string; due_date?: string | null }[]
  events?: { title: string; date?: string | null }[]
  next_action?: string | null
  next_action_date?: string | null
  suggested_stage?: string | null
}

const EXTRACT_PROMPT = `당신은 B2B 영업 활동 기록에서 실행 항목을 추출하는 CRM 비서입니다.
아래 메모를 JSON으로만 반환하세요.
필드:
- summary: 200자 이내 요약
- todos: [{title, due_date}] due_date는 YYYY-MM-DD로 알 수 있을 때만
- events: [{title, date}] date는 YYYY-MM-DD로 알 수 있을 때만
- next_action, next_action_date
- suggested_stage: 신규/검증/컨택/PoC/제안/협상/수주/실패 중 명확할 때만
원문에 없는 내용을 만들지 마세요.`

async function extractActivity(
  adm: any,
  userId: string,
  content: string,
): Promise<ActivityExtract | null> {
  const settingsRes = await adm.from('org_content').select('value').eq('key', 'META').single()
  const meta = settingsRes.data?.value ?? {}
  const apiKey: string = meta.gemini_api_key ?? process.env.GEMINI_API_KEY ?? ''
  const model: string = meta.gemini_model ?? 'gemini-2.0-flash'
  if (!apiKey) return null

  const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${EXTRACT_PROMPT}\n\n메모:\n${content}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  logTokenUsage({
    userId,
    feature: 'deal-activity-parse' as AiFeature,
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  })
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return null
  try {
    return JSON.parse(text) as ActivityExtract
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { deal_id: string; type: string; content: string }
  if (!body.deal_id || !body.content?.trim()) {
    return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any
  const { data, error } = await adm
    .from('deal_activities')
    .insert({ deal_id: body.deal_id, user_id: user.id, type: body.type, content: body.content })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    const extracted = await extractActivity(adm, user.id, body.content)
    if (extracted) {
      await adm.from('deal_activities').update({
        ai_parsed: true,
        ai_extracted: true,
        content: extracted.summary || body.content,
        extracted_todos: extracted.todos ?? [],
        extracted_events: extracted.events ?? [],
        suggested_stage: extracted.suggested_stage ?? null,
      }).eq('id', data.id)

      const dealPatch: Record<string, unknown> = {}
      if (extracted.next_action) dealPatch.next_action = extracted.next_action
      if (extracted.next_action_date) dealPatch.next_action_date = extracted.next_action_date
      if (extracted.suggested_stage) {
        dealPatch.stage = extracted.suggested_stage
        dealPatch.probability = probabilityForStage(extracted.suggested_stage)
      }
      if (Object.keys(dealPatch).length > 0) {
        await adm.from('deals').update(dealPatch).eq('id', body.deal_id)
      }

      const logs = [
        ...(extracted.todos ?? []).filter(t => t.title && t.due_date).map(t => ({
          user_id: user.id,
          log_date: t.due_date,
          content: `[영업 할 일] ${t.title}`,
          entry_type: 'planned',
        })),
        ...(extracted.events ?? []).filter(ev => ev.title && ev.date).map(ev => ({
          user_id: user.id,
          log_date: ev.date,
          content: `[영업 일정] ${ev.title}`,
          entry_type: 'planned',
        })),
      ]
      if (logs.length > 0) await adm.from('daily_logs').insert(logs)
    }
  } catch (err) {
    console.error('[deal activity extract]', err)
  }

  return NextResponse.json(data, { status: 201 })
}
