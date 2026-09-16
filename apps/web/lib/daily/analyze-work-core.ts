// 일일업무 재분석용 1회(비스트리밍) AI 추출 — /api/ai/analyze-work 라우트와 동일 DB 프롬프트(SSOT) 재사용.
// 라우트는 스트리밍(신규 입력 실시간 UX), 이 함수는 수정 시 '해당 항목만 재분석'(비스트리밍)에 쓴다.

import { namesFromDirectory } from '../ai/known-names.ts'
import { guardedGeminiText } from '../ai/guarded-gemini.ts'
import { createAiLedger } from '../ai/ledger.ts'
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_GEMINI_MODEL } from '../ai/gemini-model.ts'

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
export async function analyzeWorkOnce(
  text: string, date: string, actorId?: string | null,
): Promise<WorkItemCore[]> {
  const admin = createAdminClient() as AdminClient
  const ledger = createAiLedger(admin as never)
  const [{ data: promptRow }, { data: metaRow }] = await Promise.all([
    admin.from('ai_prompts').select('content').eq('prompt_key', PROMPT_KEY).eq('active', true).single(),
    admin.from('org_content').select('value').eq('key', 'META').single(),
  ])
  if (!promptRow?.content) throw new Error('AI 프롬프트가 설정되지 않았습니다')
  const meta = (metaRow?.value ?? {}) as Record<string, unknown>
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : DEFAULT_GEMINI_MODEL
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

  // 일일업무에는 누가 누구와 무엇을 했는지가 그대로 있다
  const out = await guardedGeminiText({
    prompt: `${systemPrompt}\n\n입력:\n${text}`,
    apiKey, model, surface: 'daily/analyze-work', purpose: 'daily_work_split',
    ledger, actorId: actorId ?? null,
    // 일일업무에는 누가 누구와 무엇을 했는지가 그대로 있다
    knownNames: await namesFromDirectory(admin as never),
    // 이 길은 줄마다 JSON 을 내보내는 모양이라 응답 형식을 강제하지 않는다
    json: false,
  })
  const full = out.text

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
