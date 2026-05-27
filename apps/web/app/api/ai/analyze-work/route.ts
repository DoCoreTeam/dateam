import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const PROMPT_KEY = 'daily.analyze-work'

// 취약점 2 방어: 하드코딩 대신 DB에서 프롬프트 로드
async function loadPrompt(adminClient: ReturnType<typeof createAdminClient>): Promise<{ content: string; version: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('ai_prompts')
    .select('content, version')
    .eq('prompt_key', PROMPT_KEY)
    .eq('active', true)
    .single()

  if (!data) return null
  return { content: data.content as string, version: data.version as string }
}

interface ParsedWorkItem {
  title: string
  status: 'done' | 'doing' | 'planned' | 'blocker' | 'note'
  targetDate: string | null
  targetDateCertainty: 'exact' | 'inferred' | 'none'
  scheduledTime: string | null
  priority: 'urgent' | 'high' | 'normal' | 'low'
  tags: string[]
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

  const adminClient = createAdminClient()

  // Fetch API config & prompt in parallel
  const [metaResult, promptResult] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminClient as any).from('org_content').select('value').eq('key', 'META').single(),
    loadPrompt(adminClient),
  ])

  if (!promptResult) {
    return NextResponse.json({ error: 'AI 프롬프트가 설정되지 않았습니다' }, { status: 500 })
  }

  const meta = (metaResult.data?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다 (관리자에게 문의)' }, { status: 500 })
  }

  // Fetch accounts & contacts for context
  const [{ data: accounts }, { data: contacts }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('accounts') as any).select('id, name').eq('user_id', user.id).limit(200),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('contacts') as any).select('id, name').eq('user_id', user.id).limit(200),
  ])

  const accountList = (accounts ?? []) as { id: string; name: string }[]
  const contactList = (contacts ?? []) as { id: string; name: string }[]

  const tomorrow = new Date(date + 'T00:00:00')
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  // origin_group 생성 (취약점 2 방어: 트랜잭션으로 group 먼저 생성)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: originGroup } = await (supabase.from('daily_log_origin_groups') as any)
    .insert({ user_id: user.id, original_input: text })
    .select('id')
    .single()

  const originGroupId: string | null = originGroup?.id ?? null

  const systemPrompt = promptResult.content
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

            const ndjsonLines = fullText.split('\n')
            fullText = ndjsonLines.pop() ?? ''

            for (const ndjsonLine of ndjsonLines) {
              const trimmed = ndjsonLine.trim()
              if (!trimmed) continue
              try {
                const item = JSON.parse(trimmed) as ParsedWorkItem

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

                // origin_group_id와 prompt 버전 정보를 클라이언트로 전달
                const enriched = {
                  ...item,
                  originGroupId: originGroupId,
                  promptVersion: promptResult.version,
                  originalInput: text,
                  // 하위 호환: scheduledDate 필드 유지
                  scheduledDate: item.targetDate,
                }

                controller.enqueue(encoder.encode(`data: ${JSON.stringify(enriched)}\n\n`))
              } catch {
                // incomplete JSON
              }
            }
          } catch {
            // skip unparseable chunk
          }
        }
      }

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
          const enriched = {
            ...item,
            originGroupId: originGroupId,
            promptVersion: promptResult.version,
            originalInput: text,
            scheduledDate: item.targetDate,
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(enriched)}\n\n`))
        } catch {
          // ignore
        }
      }

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
