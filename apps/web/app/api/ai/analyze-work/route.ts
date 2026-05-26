import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const ANALYZE_SYSTEM_PROMPT = `당신은 업무 로그 파서입니다. 사용자의 자유형 텍스트에서 업무 항목을 추출합니다.

## 출력 형식
각 업무 항목을 독립된 JSON 객체로, 한 줄에 하나씩 출력하세요 (NDJSON).
배열 없이, 마크다운 없이, 순수 JSON 줄만 출력하세요.

## 각 항목 구조
{"title":"업무 제목","status":"done|doing|planned|blocker|note","scheduledDate":"YYYY-MM-DD 또는 null","scheduledTime":"HH:MM 또는 null","priority":"urgent|high|normal|low","accountName":"거래처명 또는 null","contactName":"담당자명 또는 null","confidence":0.0~1.0}

## 추출 규칙
1. 하나의 텍스트에 여러 업무가 있으면 각각 분리
2. 상태 판단:
   - 과거형/완료 표현 → done
   - 현재 진행 중 → doing
   - 미래/예정/할 것 → planned
   - 막힘/문제/이슈 → blocker
   - 단순 메모 → note
3. 날짜 파싱 (기준: {TODAY}):
   - "오늘" → {TODAY}
   - "내일" → {TOMORROW}
   - "다음주 월요일" → 다음 주 월요일 날짜
   - 날짜 없으면 null
4. 우선순위:
   - "긴급", "urgent", "빠른" → urgent
   - "중요", "중요한" → high
   - 그 외 → normal
5. 거래처/담당자: 아래 목록과 매칭하되, 확신 없으면 null
   거래처 목록: {ACCOUNTS}
   담당자 목록: {CONTACTS}
6. confidence: 해당 항목 추출에 대한 확신도 (0.0~1.0)`

interface ParsedWorkItem {
  title: string
  status: 'done' | 'doing' | 'planned' | 'blocker' | 'note'
  scheduledDate: string | null
  scheduledTime: string | null
  priority: 'urgent' | 'high' | 'normal' | 'low'
  accountName: string | null
  contactName: string | null
  confidence: number
  accountId?: string | null
  contactId?: string | null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { text?: unknown; date?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const date = typeof body.date === 'string' ? body.date : new Date().toISOString().split('T')[0]

  if (!text) return NextResponse.json({ error: '텍스트가 없습니다' }, { status: 400 })

  // Fetch API config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (createAdminClient() as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()

  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다 (관리자에게 문의)' }, { status: 500 })
  }

  // Fetch accounts & contacts for context
  const [{ data: accounts }, { data: contacts }] = await Promise.all([
    (supabase.from('accounts') as any).select('id, name').eq('user_id', user.id).limit(200),
    (supabase.from('contacts') as any).select('id, name').eq('user_id', user.id).limit(200),
  ])

  const accountList = (accounts ?? []) as { id: string; name: string }[]
  const contactList = (contacts ?? []) as { id: string; name: string }[]

  const tomorrow = new Date(date + 'T00:00:00')
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const systemPrompt = ANALYZE_SYSTEM_PROMPT
    .replace('{TODAY}', date)
    .replace('{TODAY}', date)
    .replace('{TOMORROW}', tomorrowStr)
    .replace('{ACCOUNTS}', accountList.map(a => a.name).join(', ') || '없음')
    .replace('{CONTACTS}', contactList.map(c => c.name).join(', ') || '없음')

  const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`

  let geminiRes: Response
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n입력:\n${text}` }] }],
        generationConfig: { temperature: 0.1 },
      }),
    })
  } catch {
    return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
  }

  if (!geminiRes.ok) {
    return NextResponse.json({ error: `AI API 오류 (${geminiRes.status})` }, { status: 502 })
  }

  // Stream Gemini SSE → collect full text → parse NDJSON → stream items to client
  const encoder = new TextEncoder()
  let fullText = ''
  let promptTokens = 0
  let outputTokens = 0
  let totalTokens = 0

  const stream = new ReadableStream({
    async start(controller) {
      const reader = geminiRes.body?.getReader()
      if (!reader) { controller.close(); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue
          try {
            const chunk = JSON.parse(jsonStr) as {
              candidates?: { content?: { parts?: { text?: string }[] } }[]
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
            }
            const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
            fullText += chunkText
            if (chunk.usageMetadata) {
              promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens
              outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens
              totalTokens = chunk.usageMetadata.totalTokenCount ?? totalTokens
            }

            // Try to emit completed NDJSON lines
            const ndjsonLines = fullText.split('\n')
            // Keep last potentially incomplete line in fullText
            fullText = ndjsonLines.pop() ?? ''

            for (const ndjsonLine of ndjsonLines) {
              const trimmed = ndjsonLine.trim()
              if (!trimmed) continue
              try {
                const item = JSON.parse(trimmed) as ParsedWorkItem

                // Resolve account/contact IDs from names
                if (item.accountName) {
                  const match = accountList.find(a => a.name === item.accountName)
                  item.accountId = match?.id ?? null
                } else {
                  item.accountId = null
                }
                if (item.contactName) {
                  const match = contactList.find(c => c.name === item.contactName)
                  item.contactId = match?.id ?? null
                } else {
                  item.contactId = null
                }

                // Emit SSE event to client
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`))
              } catch {
                // incomplete JSON, skip
              }
            }
          } catch {
            // skip unparseable chunk
          }
        }
      }

      // Process any remaining text
      if (fullText.trim()) {
        try {
          const item = JSON.parse(fullText.trim()) as ParsedWorkItem
          if (item.accountName) {
            const match = accountList.find(a => a.name === item.accountName)
            item.accountId = match?.id ?? null
          } else {
            item.accountId = null
          }
          if (item.contactName) {
            const match = contactList.find(c => c.name === item.contactName)
            item.contactId = match?.id ?? null
          } else {
            item.contactId = null
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`))
        } catch {
          // ignore
        }
      }

      // Token logging (fire-and-forget)
      logTokenUsage({
        userId: user.id,
        feature: 'daily-ai-save',
        model,
        promptTokens,
        outputTokens,
        totalTokens,
      })

      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
