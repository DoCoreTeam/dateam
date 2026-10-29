// lib/ai-chat/providers/claude-thinking.ts — 모델이 받는 생각 설정 (순수 함수)
//
// adaptive 는 4.6 부터다. haiku 4.5 와 그 이전 모델에 보내면 400
// 「adaptive thinking is not supported on this model」로 요청 전체가 죽는다.
// 실측 2026-10-29: CI 이슈 수집이 Gemini 에서 Claude 로 넘어가 이 400 으로 9-01부터 366번 연속 실패했다.
//
// 옛 모델에는 budget_tokens 를 주는 대신 생각을 안 싣는다. 대체 경로로 들어온 모델이라
// 생각보다 답이 오는 것이 먼저이고, budget_tokens 는 max_tokens 와 맞물려 또 하나의 400 자리가 된다.

/** 이름에 세대가 없는 최신 계열. 전부 adaptive 를 받는다 */
const ALWAYS_ADAPTIVE = /^claude-(fable|mythos)-/

/** claude-{계열}-{주}[-{부}] — 부 번호는 한두 자리만 본다 (뒤의 날짜 꼬리와 구별) */
const VERSIONED = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-|$)/

const ADAPTIVE_FROM = { major: 4, minor: 6 }

export function supportsAdaptiveThinking(model: string): boolean {
  const id = model.trim().toLowerCase()
  if (ALWAYS_ADAPTIVE.test(id)) return true
  const m = VERSIONED.exec(id)
  if (!m) return false // claude-3-5-sonnet 같은 옛 이름표, 모르는 이름
  const major = Number(m[1])
  const minor = m[2] === undefined ? 0 : Number(m[2])
  if (major !== ADAPTIVE_FROM.major) return major > ADAPTIVE_FROM.major
  return minor >= ADAPTIVE_FROM.minor
}

export type ClaudeThinkingParam = { type: 'adaptive'; display: 'summarized' }

/** 요청에 펼쳐 넣을 조각. 안 받는 모델이면 빈 객체 */
export function thinkingFor(model: string): { thinking?: ClaudeThinkingParam } {
  return supportsAdaptiveThinking(model)
    ? { thinking: { type: 'adaptive', display: 'summarized' } }
    : {}
}
