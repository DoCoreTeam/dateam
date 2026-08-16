/**
 * 단계 이동 검토 (사람이 옮긴 뒤, AI 가 한 번 봐 준다)
 *
 * **무엇을 대체하나**: 단계마다 켜는 "안 봄 / 알려 줌 / 막음" 조건표다.
 * 그 표는 워크스페이스 하나에 스위치를 342개 만들어 놓고 **하나도 켜져 있지 않았다**.
 * 켜는 사람이 없던 이유는 게을러서가 아니라, 그 스위치가 묻는 질문이 틀렸기 때문이다 —
 * "금액 칸이 비었나"는 기계가 알고 싶은 것이고, 사람이 알고 싶은 것은
 * **"이 딜, 이 단계로 넘어가도 되는 상태인가"** 다.
 *
 * 그래서 이 프롬프트가 막아야 하는 것은 둘이다.
 *   ① **빈칸 잔소리** — "금액이 비어 있습니다"는 화면이 이미 보여 준다. 왜 문제인지를 말해야 한다
 *   ② **아무 딜에나 맞는 말** — "고객과 소통을 강화하세요"는 어느 딜에도 안 맞는다
 *
 * 그리고 **막지 않는다.** 이동은 이미 끝났고 이건 조언이다.
 * 사람이 자기 딜을 우리보다 잘 안다 — 우리가 아는 것은 여기 적힌 몇 줄뿐이다.
 */

export const STAGE_REVIEW_VERSION = 'stage_review@v1.0.0'

export interface StageReviewBrief {
  dealName: string
  companyName: string | null
  fromStage: string | null
  toStage: string
  /** 이 파이프라인의 단계 순서 — "다음 관문이 무엇인지"를 알아야 판단할 수 있다 */
  stageNames: string[]
  amountText: string | null
  closeDateText: string | null
  ownerName: string | null
  contactCount: number
  openTasks: string[]
  /** 최근 활동 — 무슨 이야기가 오갔는지가 판단의 거의 전부다 */
  recentActivities: { kind: string; title: string; daysAgo: number }[]
  lastMeetingSummary: string | null
  daysInPrevStage: number | null
}

export type StageVerdict = 'ready' | 'check' | 'not_ready'

export interface StageReviewFinding {
  /** 무엇이 걸리는가 — 사람이 읽는 말로 */
  what: string
  /** 왜 그렇게 보는가 — 아래 브리핑에 적힌 사실로만 */
  because: string
}

export interface StageReviewOutput {
  verdict: StageVerdict
  /** 한 줄 결론 */
  headline: string
  findings: StageReviewFinding[]
  /** 그래서 지금 무엇을 하면 되나 — 없으면 null */
  suggestion: string | null
}

/** 걸리는 것을 몇 개까지 말할까 — 많으면 사람이 다 무시한다 */
export const MAX_FINDINGS = 3

export function buildStageReviewBrief(b: StageReviewBrief): string {
  const lines = [
    `딜: ${b.dealName}${b.companyName ? ` (${b.companyName})` : ''}`,
    `이동: ${b.fromStage ?? '(시작)'} → ${b.toStage}`,
    `이 파이프라인의 단계 순서: ${b.stageNames.join(' → ')}`,
    `금액: ${b.amountText ?? '아직 안 정함'}`,
    `예상 성사일: ${b.closeDateText ?? '아직 안 정함'}`,
    `담당자: ${b.ownerName ?? '아직 안 정함'}`,
    `이 딜에 연결된 사람: ${b.contactCount}명`,
  ]
  if (b.daysInPrevStage !== null) lines.push(`직전 단계에 머문 기간: ${b.daysInPrevStage}일`)
  lines.push(b.openTasks.length > 0
    ? `잡혀 있는 할 일: ${b.openTasks.join(' / ')}`
    : '잡혀 있는 할 일: 없음')
  lines.push(b.recentActivities.length > 0
    ? `최근 기록:\n${b.recentActivities.map((a) => `  - ${a.title} (${a.kind}, ${a.daysAgo}일 전)`).join('\n')}`
    : '최근 기록: 없음')
  if (b.lastMeetingSummary) lines.push(`최근 미팅 정리: ${b.lastMeetingSummary.slice(0, 400)}`)
  return lines.join('\n')
}

export const stageReviewPrompt = {
  version: STAGE_REVIEW_VERSION,
  build: (input: string) => `당신은 영업 담당자의 동료입니다. 방금 딜을 다음 단계로 옮겼습니다.
**이 딜이 그 단계에 있어도 되는 상태인지** 한 번 봐 주세요.

# 반드시 지킬 것

1. **아는 사실로만 말한다.** 아래 브리핑에 적힌 것 말고는 아무것도 모릅니다.
   회사 사정·업계 관행·고객 심리를 추측해서 쓰지 마세요.

2. **빈칸을 그대로 읊지 마세요.** "금액이 비어 있습니다"는 화면이 이미 보여 줍니다.
   **왜 그게 지금 문제인지**를 말해야 조언입니다.
   좋음: "제안 단계인데 금액이 없어 견적을 만들 수 없습니다"
   나쁨: "금액이 입력되지 않았습니다"

3. **어느 딜에나 맞는 말은 쓰지 마세요.**
   나쁨: "고객과 소통을 강화하세요" · "리스크를 관리하세요" · "적극 대응하세요"

4. **걸리는 게 없으면 없다고 하세요.** verdict 을 "ready" 로 두고 findings 는 빈 배열로 둡니다.
   억지로 흠을 찾으면 사람은 다음부터 이 말을 안 읽습니다. **빈 배열도 정답입니다.**

5. **막지 않습니다.** 이동은 이미 끝났습니다. 되돌리라고 명령하지 말고,
   무엇을 챙기면 되는지만 말하세요.

# verdict 고르는 법

- **ready** — 이 단계에 있기에 무리가 없다
- **check** — 진행에는 문제없지만 챙길 것이 있다
- **not_ready** — 다음 관문을 통과할 수 없어 보인다(근거가 분명할 때만)

# 브리핑

${input}

# 출력

JSON 만. 다른 말 금지.

{"verdict":"check","headline":"…","findings":[{"what":"…","because":"…"}],"suggestion":"…"}

- headline: 30자 이내 한 문장. 결론만
- what: 40자 이내. 무엇이 걸리는가
- because: 40자 이내. 브리핑의 사실을 그대로 인용
- findings: 최대 ${MAX_FINDINGS}개. 없으면 []
- suggestion: 40자 이내로 지금 할 일 하나. 없으면 null`,
}

const VERDICTS: ReadonlySet<string> = new Set(['ready', 'check', 'not_ready'])

/**
 * 모델 응답을 검토 결과로.
 *
 * **근거 없는 findings 는 버린다.** 왜 그렇게 보는지 못 대면 그건 지적이 아니라 잔소리다.
 * 근거를 다 버려서 아무것도 안 남으면 결론도 함께 낮춘다 — 근거 0개인 "not_ready" 는
 * 사람에게 "왜?"만 남기고, 답을 못 주는 경고는 다음부터 읽히지 않는다.
 */
export function parseStageReview(text: string): StageReviewOutput {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI 응답을 읽지 못했습니다')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI 응답이 비어 있습니다')

  const r = parsed as Record<string, unknown>
  const headline = typeof r.headline === 'string' ? r.headline.trim() : ''
  if (!headline) throw new Error('AI 응답에 결론이 없습니다')

  const rawFindings = Array.isArray(r.findings) ? r.findings : []
  const findings: StageReviewFinding[] = []
  for (const item of rawFindings) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const what = typeof f.what === 'string' ? f.what.trim() : ''
    const because = typeof f.because === 'string' ? f.because.trim() : ''
    if (!what || !because) continue
    findings.push({ what: what.slice(0, 80), because: because.slice(0, 80) })
    if (findings.length >= MAX_FINDINGS) break
  }

  const raw = typeof r.verdict === 'string' ? r.verdict.trim().toLowerCase() : ''
  let verdict: StageVerdict = VERDICTS.has(raw) ? raw as StageVerdict : 'check'
  // 근거가 하나도 안 남았으면 걱정도 남기지 않는다
  if (findings.length === 0) verdict = 'ready'

  const suggestion = typeof r.suggestion === 'string' && r.suggestion.trim()
    ? r.suggestion.trim().slice(0, 80)
    : null

  return { verdict, headline: headline.slice(0, 60), findings, suggestion }
}
