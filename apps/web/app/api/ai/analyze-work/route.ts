import { NextRequest, NextResponse } from 'next/server'
import { matchByName, promptNames } from '@/lib/crm/link/name-match'
import type { Candidate } from '@/lib/crm/link/name-match'
import { loadCrmCandidates } from '@/lib/crm/link/candidates'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { recordDailyOutcome, maybeSelfTuneDaily } from '@/lib/daily-prompt-governance'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini-model'

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
  targetEndDate: string | null
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
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : DEFAULT_GEMINI_MODEL

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

  /**
   * 후보는 **구 CRM + 영업 CRM 둘 다** 본다.
   *
   * 예전에는 `accounts`(구 CRM)만 봤다. 그래서 영업 CRM 에 회사를 넣어 두고
   * 일일업무에 그 이름을 적어도 두 기록이 영원히 안 만났다.
   * 이관이 진행 중이라 한동안 양쪽에 나뉘어 있으므로, 합쳐서 보고 CRM 을 정본으로 삼는다.
   *
   * CRM 조회가 실패해도 일일업무 분석은 계속돼야 한다 — 곁들이는 일이 본 일을 막으면 안 된다.
   */
  const crmCandidates = await loadCrmCandidates()

  const accountList: Candidate[] = [
    ...crmCandidates.companies,
    ...((accounts ?? []) as { id: string; name: string }[]).map((a) => ({ ...a, source: 'legacy' as const })),
  ]
  const contactList: Candidate[] = [
    ...crmCandidates.people,
    ...((contacts ?? []) as { id: string; name: string }[]).map((c) => ({ ...c, source: 'legacy' as const })),
  ]

  // 그날 이미 등록된 항목(제목·분류) — 중복·오분류 방지 맥락으로 프롬프트에 주입
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingToday } = await (supabase.from('daily_logs') as any)
    .select('content, entry_type')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .eq('log_date', date)
    .eq('is_onboarding', false)  // onboarding: AI 프롬프트 입력(중복맥락) — 실습 행 제외
    .limit(100)
  const existingList = (existingToday ?? []) as { content: string; entry_type: string }[]
  const existingTodayText = existingList.length > 0
    ? existingList.map((r) => `- [${r.entry_type ?? 'note'}] ${(r.content ?? '').slice(0, 80)}`).join('\n')
    : '없음 (오늘 첫 입력)'

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
    .replace('{EXISTING_TODAY}', existingTodayText)
    .replace('{TODAY}', date)
    .replace('{TODAY}', date)
    .replace('{TOMORROW}', tomorrowStr)
    .replace('{ACCOUNTS}', promptNames(accountList))
    .replace('{CONTACTS}', promptNames(contactList))

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
  // D-2 품질신호용: 추출 항목(status·confidence) 누적
  const collectedItems: { status?: string; confidence?: number }[] = []
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
                collectedItems.push({ status: item.status, confidence: item.confidence })

                // 표기가 흔들려도 찾는다(㈜·공백·대소문자). 여럿이면 안 붙인다 — 틀린 회사보다 낫다
                item.accountId = matchByName(item.accountName, accountList).matched?.id ?? null
                item.contactId = matchByName(item.contactName, contactList).matched?.id ?? null

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
          collectedItems.push({ status: item.status, confidence: item.confidence })
          if (item.accountName) {
item.accountId = matchByName(item.accountName, accountList).matched?.id ?? null
            item.contactId = matchByName(item.contactName, contactList).matched?.id ?? null
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

      // D-2/D-8 자가학습: 사용 직후 결정적 품질신호 적재 + 누적 degraded 시 자가조정(롤백/합성).
      //   응답 스트림은 이미 닫혔으므로 사용자 지연 없음. 실패는 비치명.
      try {
        const nowIso = new Date().toISOString()
        await recordDailyOutcome(adminClient, { version: promptResult.version, input: text, items: collectedItems, userId: user.id, nowIso })
        await maybeSelfTuneDaily(adminClient, { apiKey, model, sampleInput: text, nowIso })
      } catch (e) {
        console.warn('[analyze-work] 자가학습 신호 처리 실패', e)
      }
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
