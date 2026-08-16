/**
 * 다음 최선 행동 제안 (dacrm 통합기획서 FR-05 "딜 인텔리전스: 다음 최선 행동 제안")
 *
 * **이 프롬프트가 막아야 하는 것**: 그럴듯한 조언.
 *
 * "고객사에 연락해 보세요" · "관계를 강화하세요" 같은 말은 어느 딜에나 맞고
 * 그래서 아무 딜에도 안 맞는다. 그런 제안이 할 일 목록에 쌓이면
 * 사람은 **그 목록 전체를 안 믿게 된다** — AI 제안이 죽는 방식이 늘 이것이다.
 *
 * 그래서 셋을 못 박는다.
 *   ① **우리가 아는 사실만** — 마지막 활동·머문 날짜·단계·금액. 없는 사실은 지어내지 않는다
 *   ② **행동은 하나, 오늘 할 수 있는 크기로** — "전략을 재검토" 말고 "김부장에게 견적 확인 전화"
 *   ③ **근거를 대라** — 왜 지금 이걸 하는지 못 대면 그 제안은 버린다
 *
 * 그리고 **아무 제안도 안 하는 것이 정답일 때가 있다.** 어제 미팅한 딜에
 * "연락해 보세요"는 방해다. 모델에게 빈 배열을 낼 자유를 준다.
 */

export const NEXT_BEST_ACTION_VERSION = 'next_best_action@v1.0.0'

export interface DealBrief {
  dealId: string
  name: string
  companyName: string | null
  stageName: string
  /** 지금 단계에 며칠째 있나 */
  daysInStage: number | null
  amountText: string | null
  /** 마지막으로 무슨 일이 있었나 — 없으면 null */
  lastActivity: { kind: string; title: string; daysAgo: number } | null
  /** 가장 최근 미팅에서 정리된 것 */
  lastMeetingSummary: string | null
  /** 이미 잡혀 있는 할 일 — 같은 것을 또 제안하지 않게 */
  openTasks: string[]
}

export interface NextBestActionSuggestion {
  dealId: string
  /** 할 일 제목 — 오늘 바로 할 수 있는 크기 */
  action: string
  /** 왜 지금 이것인가 — 우리가 아는 사실로 */
  because: string
  /** 며칠 안에 하면 되나 */
  dueInDays: number
}

/** 한 번에 다루는 딜 수 — 많이 넣으면 모델이 뭉뚱그린다 */
export const MAX_DEALS_PER_RUN = 8

function brief(d: DealBrief): string {
  const lines = [
    `- id: ${d.dealId}`,
    `  딜: ${d.name}${d.companyName ? ` (${d.companyName})` : ''}`,
    `  단계: ${d.stageName}${d.daysInStage !== null ? ` · ${d.daysInStage}일째` : ''}`,
  ]
  if (d.amountText) lines.push(`  금액: ${d.amountText}`)
  lines.push(d.lastActivity
    ? `  마지막 활동: ${d.lastActivity.title} (${d.lastActivity.daysAgo}일 전)`
    : '  마지막 활동: 기록 없음')
  if (d.lastMeetingSummary) lines.push(`  최근 미팅 정리: ${d.lastMeetingSummary.slice(0, 300)}`)
  lines.push(d.openTasks.length > 0
    ? `  이미 잡힌 할 일: ${d.openTasks.join(' / ')}`
    : '  이미 잡힌 할 일: 없음')
  return lines.join('\n')
}

export const nextBestActionPrompt = {
  version: NEXT_BEST_ACTION_VERSION,
  build: (input: string) => `당신은 영업 담당자의 동료입니다. 아래 딜들을 보고 **다음에 할 일**을 제안하세요.

# 반드시 지킬 것

1. **아는 사실로만 말한다.** 아래 적힌 것 말고는 아무것도 모릅니다.
   회사 사정·업계 동향·고객 심리를 추측해서 쓰지 마세요.
2. **행동은 오늘 할 수 있는 크기로.**
   좋음: "김부장에게 견적 회신 확인 전화"
   나쁨: "고객 관계를 강화한다" · "전략을 재검토한다" · "적극적으로 대응한다"
3. **왜 지금인지 근거를 대세요.** 근거는 위에 적힌 사실이어야 합니다
   ("28일째 제안 단계", "마지막 활동이 21일 전").
4. **이미 잡힌 할 일과 같은 것은 제안하지 마세요.** 중복은 목록만 어지럽힙니다.
5. **제안할 게 없으면 그 딜은 빼세요.** 며칠 전에 움직인 딜에 억지 제안을 붙이면
   사람은 이 기능 전체를 무시하게 됩니다. **빈 배열도 정답입니다.**

# 딜 목록

${input}

# 출력

JSON 만. 다른 말 금지.

{"suggestions":[{"dealId":"…","action":"…","because":"…","dueInDays":3}]}

- action: 40자 이내, 동사로 끝나는 한 문장
- because: 40자 이내, 위 사실을 그대로 인용
- dueInDays: 1~14 사이 정수`,
}

export function buildDealBriefs(deals: DealBrief[]): string {
  return deals.slice(0, MAX_DEALS_PER_RUN).map(brief).join('\n\n')
}

/**
 * 모델 응답을 제안으로.
 *
 * **모르는 딜 id 는 버린다.** 모델이 id 를 지어내면 그 제안은 어느 딜에도 못 붙는다 —
 * 붙일 곳 없는 제안을 화면에 띄우면 사람이 눌렀을 때 아무 일도 안 일어난다.
 */
export function parseNextBestActions(text: string, knownIds: string[]): NextBestActionSuggestion[] {
  const known = new Set(knownIds)
  // 모델은 코드펜스를 자주 붙인다
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI 응답을 읽지 못했습니다')
  }

  const raw = (parsed as { suggestions?: unknown })?.suggestions
  if (!Array.isArray(raw)) throw new Error('AI 응답에 제안 목록이 없습니다')

  const out: NextBestActionSuggestion[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>

    const dealId = typeof r.dealId === 'string' ? r.dealId : ''
    const action = typeof r.action === 'string' ? r.action.trim() : ''
    const because = typeof r.because === 'string' ? r.because.trim() : ''

    // 지어낸 id · 빈 행동 · 근거 없음은 전부 버린다
    if (!known.has(dealId) || !action || !because) continue
    // 한 딜에 하나만 — 여러 개면 사람이 무엇부터 할지 또 골라야 한다
    if (seen.has(dealId)) continue

    const n = Number(r.dueInDays)
    const dueInDays = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 14) : 3

    seen.add(dealId)
    out.push({ dealId, action: action.slice(0, 80), because: because.slice(0, 80), dueInDays })
  }

  return out
}
