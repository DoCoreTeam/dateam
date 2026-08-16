/**
 * 미팅 5축 추출 프롬프트 (dacrm 구현명세 §3.2-5)
 *
 * 이 프롬프트가 막아야 하는 것은 **그럴듯한 거짓말**이다.
 * 영업 미팅 전사는 애매한 말로 가득하다 — "예산은 좀 봐야죠", "긍정적으로 검토하겠습니다".
 * 모델은 이런 말에서 숫자와 결론을 만들어내려 한다. 그게 CRM 에 들어가면
 * 사람은 그걸 사실로 읽고 사업 판단을 한다.
 *
 * 그래서 세 가지를 못 박는다.
 *   ① **근거 없으면 쓰지 마라** — 전사 구간 id 를 못 대면 그 항목은 없는 것이다
 *   ② **금액은 말한 것만** — "한 3억쯤"은 금액이 아니다
 *   ③ **모르면 null** — 빈칸을 채우는 것보다 비워 두는 게 낫다
 */

export const MEETING_EXTRACT_VERSION = 'meeting_extract@v1.2.0'

export interface MeetingContext {
  /** 이 회의가 열린 날 (KST, YYYY-MM-DD) — "8월 25일까지"의 연도를 여기서 읽는다 */
  meetingDate?: string

  /** 연결된 회사의 지금 값 — 이미 아는 것을 또 제안하지 않게 */
  company?: { name: string; domain?: string | null; industry?: string | null; region?: string | null } | null
  /** 연결된 딜의 지금 값 */
  deal?: { name: string; stageName?: string | null; amountMinor?: string | null; currency?: string | null } | null
  /** 이 파이프라인에 어떤 단계가 있나 — 없는 단계 이름을 지어내지 않게 */
  stageNames?: string[]
  /** 우리 쪽 사람 이름 — 이들을 고객사 인물로 제안하면 CRM 이 오염된다 */
  ourNames?: string[]
}

/** 전사 한 조각 — id 가 근거가 된다 */
export interface Segment {
  id: string
  speaker: string | null
  text: string
}

function contextBlock(ctx: MeetingContext): string {
  const lines: string[] = []
  if (ctx.meetingDate) lines.push(`이 회의가 열린 날: ${ctx.meetingDate} (KST)`)
  if (ctx.company) {
    lines.push(`회사: ${ctx.company.name}` +
      [ctx.company.domain && `도메인 ${ctx.company.domain}`,
       ctx.company.industry && `산업 ${ctx.company.industry}`,
       ctx.company.region && `지역 ${ctx.company.region}`]
        .filter(Boolean).map((s) => ` · ${s}`).join(''))
  }
  if (ctx.deal) {
    lines.push(`딜: ${ctx.deal.name}` +
      [ctx.deal.stageName && `단계 ${ctx.deal.stageName}`,
       ctx.deal.amountMinor && `금액 ${ctx.deal.amountMinor} ${ctx.deal.currency ?? ''}`]
        .filter(Boolean).map((s) => ` · ${s}`).join(''))
  }
  if (ctx.stageNames?.length) {
    lines.push(`이 파이프라인의 단계: ${ctx.stageNames.join(' → ')}`)
  }
  if (ctx.ourNames?.length) {
    lines.push(`우리 쪽 사람(고객이 아니다): ${ctx.ourNames.join(', ')}`)
  }
  return lines.length > 0
    ? lines.join('\n')
    : '(연결된 회사·딜 없음 — 전사에서 읽어낸 것만 쓰세요)'
}

export function buildMeetingExtractPrompt(segments: Segment[], ctx: MeetingContext): string {
  const transcript = segments
    .map((s) => `[${s.id}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}`)
    .join('\n')

  return `너는 영업 미팅 기록을 읽고 CRM 에 넣을 사실만 뽑아내는 사람이다.

## 반드시 지킬 것

1. **근거 없이는 아무것도 쓰지 마라.**
   모든 항목에 \`evidence.segmentIds\` 를 넣는다. 그 값을 읽어낸 전사 구간의 [id] 다.
   지어낸 id 를 쓰면 그 항목은 통째로 버려진다. 근거를 못 대겠으면 그 항목을 아예 넣지 마라.

2. **금액은 말한 것만 쓴다.**
   "한 3억쯤 되지 않을까요", "예산은 좀 봐야죠" 같은 말은 금액이 아니다 → \`amountMinor: null\`.
   "3억으로 품의 올렸습니다"처럼 확정적으로 말했을 때만 숫자를 쓴다.
   KRW 는 원 단위 정수다(3억 → 300000000).

3. **모르면 null 이다.** 빈칸을 채우려고 그럴듯한 말을 만들지 마라.
   틀린 값은 고칠 수 있지만, 사람은 CRM 에 적힌 것을 사실로 읽는다.

4. **단계는 아래 목록에 있는 이름만** 쓴다. 없으면 \`suggestedStageName: null\`.

5. **우리 쪽 사람은 \`who\` 에 넣지 마라.**
   아래 "우리 쪽 사람" 목록에 있는 이름은 우리 영업 담당이지 고객이 아니다.
   이들을 넣으면 우리 직원이 고객사 연락처로 등록된다.

6. **날짜는 회의 날짜를 기준으로 읽는다.**
   "8월 25일까지"처럼 연도를 안 말했으면 **회의가 열린 해**를 쓴다(회의 날짜는 아래에 있다).
   회의 날짜보다 앞선 날짜가 나오면 그 다음 해다. 연·월·일 중 하나라도 못 정하면 \`dueDate: null\`.
   지난 연도를 적으면 그 할 일은 이미 지난 일로 보여 아무도 하지 않는다.

## 이미 아는 것 (이것과 같은 값은 다시 제안하지 마라)

${contextBlock(ctx)}

## 다섯 가지를 뽑는다

- **who** — 누가 나왔나. 이름·회사·직함, 그리고 이 딜에서의 역할.
  역할: CHAMPION(우리 편) · DECISION_MAKER(결정권자) · PRACTITIONER(실무자) · BLOCKER(반대) · OTHER
  **반대하는 사람을 빠뜨리지 마라** — 딜이 막히는 진짜 이유가 거기 있을 때가 많다.

- **what** — 무엇을 파는 이야기인가. 제품·범위·금액.

- **where** — 지금 어디까지 왔나. 다음 관문은 무엇인가. 하나만 고른다.

- **risk** — 이 딜을 흔드는 것. 나쁜 것뿐 아니라 **좋은 신호도** 적는다(polarity).
  종류: BUDGET(예산) · TIMELINE(일정) · COMPETITOR(경쟁) · CHURN(이탈) · STAKEHOLDER(이해관계자) · OTHER

- **next** — 그래서 다음에 무엇을 해야 하나. 기한이 나왔으면 YYYY-MM-DD 로.
  누가 할 일인지(\`assigneeHint\`)도 적는다: "우리 측" | "고객 측" | 사람 이름.

## 전사

${transcript}

## 출력

아래 JSON 만 출력한다. 설명·인사말·코드펜스 없이 JSON 만.

{
  "who": [{ "name": "", "companyName": null, "title": null, "role": null, "email": null, "confidence": 0.0, "evidence": { "segmentIds": [""], "quote": "" } }],
  "what": [{ "dealName": "", "productOrScope": null, "amountMinor": null, "currency": null, "confidence": 0.0, "evidence": { "segmentIds": [""], "quote": "" } }],
  "where": { "suggestedStageName": null, "reason": null, "nextMilestone": null, "confidence": 0.0, "evidence": { "segmentIds": [""], "quote": "" } },
  "risk": [{ "kind": "BUDGET", "polarity": "NEGATIVE", "description": "", "confidence": 0.0, "evidence": { "segmentIds": [""], "quote": "" } }],
  "next": [{ "title": "", "dueDate": null, "assigneeHint": null, "emailDraftGist": null, "confidence": 0.0, "evidence": { "segmentIds": [""], "quote": "" } }]
}

찾은 것이 없는 축은 빈 배열([])로, where 는 null 로 둔다. 억지로 채우지 마라.`
}
