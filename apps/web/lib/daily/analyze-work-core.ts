// 일일업무 재분석용 1회(비스트리밍) AI 추출 — /api/ai/analyze-work 라우트와 동일 DB 프롬프트(SSOT) 재사용.
// 라우트는 스트리밍(신규 입력 실시간 UX), 이 함수는 수정 시 '해당 항목만 재분석'(비스트리밍)에 쓴다.

import { createAdminClient } from '@/lib/supabase/server'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const PROMPT_KEY = 'daily.analyze-work'

export interface WorkItemCore {
  title: string
  status: 'done' | 'doing' | 'planned' | 'blocker' | 'note'
  targetDate: string | null
  targetEndDate: string | null
  targetDateCertainty: 'exact' | 'inferred' | 'none'
  scheduledTime: string | null
  priority: 'urgent' | 'high' | 'normal' | 'low'
  confidence: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** 텍스트 1건을 DB 프롬프트로 1회 추출(비스트리밍). date 기준으로 상대날짜/기간(targetEndDate)·시간 파싱. */
export async function analyzeWorkOnce(text: string, date: string): Promise<WorkItemCore[]> {
  const admin = createAdminClient() as AdminClient
  const [{ data: promptRow }, { data: metaRow }] = await Promise.all([
    admin.from('ai_prompts').select('content').eq('prompt_key', PROMPT_KEY).eq('active', true).single(),
    admin.from('org_content').select('value').eq('key', 'META').single(),
  ])
  if (!promptRow?.content) throw new Error('AI 프롬프트가 설정되지 않았습니다')
  const meta = (metaRow?.value ?? {}) as Record<string, unknown>
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'
  if (!apiKey) throw new Error('Gemini 키가 설정되지 않았습니다')

  const tomorrow = new Date(date + 'T00:00:00')
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const systemPrompt = (promptRow.content as string)
    .replace('{EXISTING_TODAY}', '없음 (수정 재분석)')
    .replace('{TODAY}', date)
    .replace('{TODAY}', date)
    .replace('{TOMORROW}', tomorrowStr)
    .replace('{ACCOUNTS}', '없음')
    .replace('{CONTACTS}', '없음')

  const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n입력:\n${text}` }] }],
      generationConfig: { temperature: 0.1 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini API 오류 (${res.status})`)
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const full = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

  const items: WorkItemCore[] = []
  for (const line of full.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('```')) continue
    try {
      items.push(JSON.parse(t) as WorkItemCore)
    } catch {
      // 불완전 JSON 스킵
    }
  }
  return items
}
