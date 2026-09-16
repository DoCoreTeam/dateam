import { guardedGeminiText } from './ai/guarded-gemini.ts'
import type { AiLedger } from './ai/guarded-call.ts'
import { logTokenUsage } from '@/lib/token-logger'


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
  userId: string | null | undefined,
  ledger: AiLedger,
  /**
   * 이름 목록과 지난주 구분을 **한 덩어리로 받는다.**
   *
   * 둘 다 `string[]` 이라 자리를 바꿔 넘겨도 타입 검사가 통과한다. 실제로 이 변경에서
   * 라우트가 지난주 구분을 이름 자리에 넘겼고 tsc 는 아무 말도 안 했다 —
   * 그러면 구분 이름이 사람 이름으로 가려져 프롬프트에서 사라진다.
   * 이름을 붙여 받으면 그 실수를 못 한다.
   */
  opts: { knownNames?: readonly string[]; prevWeekCategories?: string[] } = {},
): Promise<WeeklyRowOutput[]> {
  const knownNames = opts.knownNames ?? []
  const prevWeekCategories = opts.prevWeekCategories
  if (tasks.length === 0) return []

  // 지난주 구분(섹션) 목록 — 구분이 매주 달라지지 않도록 가능하면 지난주 명칭 재사용(있을 때만)
  const prevCatBlock =
    prevWeekCategories && prevWeekCategories.length > 0
      ? `\n\n## [지난주 구분 목록] (구분 일관성 기준)\n${JSON.stringify(prevWeekCategories)}\n- 같은 의미의 업무는 위 지난주 구분 명칭을 그대로 재사용하라. 지난주에 없던 새 업무만 새 구분을 만들어라.`
      : ''

  const systemPrompt = `${styleGuide}
${prevCatBlock}
---
위 스타일 가이드에 따라 아래 일일업무 목록을 주간보고 형식으로 변환하라.
일일업무 데이터는 JSON 배열로 제공된다.
출력: 순수 JSON 배열만. 설명이나 마크다운 코드블록 없이.`

  const userMessage = `일일업무 목록:\n${JSON.stringify(tasks, null, 2)}`

  // 주간보고는 일일업무를 모아 보낸다. 일일업무에 있던 것이 그대로 다시 나간다
  const out = await guardedGeminiText({
    prompt: `${systemPrompt}\n\n${userMessage}`,
    apiKey, model,
    surface: 'weekly-report/generate', purpose: 'weekly_from_daily',
    ledger, actorId: userId ?? null, temperature: 0.2,
    // 주간보고는 일일업무를 모아 보내므로 일일에 있던 이름이 그대로 다시 나간다
    knownNames,
  })
  const text = out.text
  if (!text) throw new Error('Gemini 응답이 비어 있습니다')

  logTokenUsage({
    userId: userId ?? null,
    feature: 'weekly-report-refine',
    model,
    promptTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    totalTokens: out.inputTokens + out.outputTokens,
  })

  let parsed: unknown
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해 주세요.')
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
