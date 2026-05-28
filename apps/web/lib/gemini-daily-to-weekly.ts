import { logTokenUsage } from '@/lib/token-logger'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface DailyTaskInput {
  content: string
  entry_type: string
  log_date: string
  is_resolved: boolean
  priority: string
}

export interface WeeklyRowOutput {
  category: string
  performance: string
  plan: string
  issues: string
}

export async function generateWeeklyFromDailyTasks(
  tasks: DailyTaskInput[],
  styleGuide: string,
  apiKey: string,
  model: string,
  userId?: string | null
): Promise<WeeklyRowOutput[]> {
  if (tasks.length === 0) return []

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`

  const systemPrompt = `${styleGuide}

---
위 스타일 가이드에 따라 아래 일일업무 목록을 주간보고 형식으로 변환하라.
일일업무 데이터는 JSON 배열로 제공된다.
출력: 순수 JSON 배열만. 설명이나 마크다운 코드블록 없이.`

  const userMessage = `일일업무 목록:\n${JSON.stringify(tasks, null, 2)}`

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n${userMessage}` }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${res.statusText}`)

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  logTokenUsage({
    userId: userId ?? null,
    feature: 'weekly-report-refine',
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Gemini 응답 JSON 파싱 실패')
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Gemini 응답 형식이 올바르지 않습니다')
  }

  return (parsed as unknown[])
    .map((item) => {
      const r = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
      return {
        category: typeof r.category === 'string' ? r.category : '',
        performance: typeof r.performance === 'string' ? r.performance : '',
        plan: typeof r.plan === 'string' ? r.plan : '',
        issues: typeof r.issues === 'string' ? r.issues : '',
      }
    })
    .filter((r) => r.category !== '')
}
