/**
 * 5축 추출 스키마 (dacrm 구현명세 §3.2-5, 통합기획서 §3.6)
 *
 * 미팅에서 뽑아내는 다섯 가지. 이름이 아니라 **질문**으로 기억하는 게 맞다 —
 *
 *   WHO   누가 관여하나 · 누가 결정하고 누가 반대하나
 *   WHAT  무엇을 파나 · 얼마짜리인가
 *   WHERE 지금 어디까지 왔나 · 다음 관문은 무엇인가
 *   RISK  무엇이 이 딜을 죽일 수 있나 (그리고 무엇이 살리나)
 *   NEXT  그래서 내가 다음에 뭘 해야 하나
 *
 * **근거가 없으면 그 값은 무효다**(명세 262행). AI 가 그럴듯한 말을 지어내는 것은
 * 값이 틀리는 것보다 나쁘다 — 틀린 값은 고칠 수 있지만, 지어낸 근거는 사람을 속인다.
 * 그래서 `segmentIds` 를 필수로 두고, 전사 어느 대목에서 읽었는지 못 대면 버린다.
 *
 * **금액은 추측하지 않는다.** "한 3억쯤 되지 않을까요"는 금액이 아니다.
 * 명시적으로 말한 것만 담고, 아니면 null 이다(명세 주석 "언급 없으면 null, 추측 금지").
 */

import { z } from 'zod'

/** 근거 — 전사 구간과 그때 실제로 나온 말 */
export const Evidence = z.object({
  /** 근거 전사 구간. 하나도 없으면 그 값은 무효다 */
  segmentIds: z.array(z.string()).min(1),
  quote: z.string().max(200),
})
export type Evidence = z.infer<typeof Evidence>

/** 딜에서 이 사람이 하는 역할 — CrmDealContactRole 과 같아야 한다 */
export const AxisRole = z.enum(['CHAMPION', 'DECISION_MAKER', 'PRACTITIONER', 'BLOCKER', 'OTHER'])

/** 신호의 종류 — 무엇이 이 딜을 흔드나 */
export const RiskKind = z.enum(['BUDGET', 'TIMELINE', 'COMPETITOR', 'CHURN', 'STAKEHOLDER', 'OTHER'])

/** 좋은 신호인가 나쁜 신호인가 — 좋은 것도 적어야 "왜 잘 되고 있나"를 안다 */
export const RiskPolarity = z.enum(['POSITIVE', 'NEGATIVE'])

const confidence = z.number().min(0).max(1)

export const FiveAxisOutput = z.object({
  /** 관계 — 누가 관여하나 */
  who: z.array(z.object({
    name: z.string(),
    companyName: z.string().nullable(),
    title: z.string().nullable(),
    role: AxisRole.nullable(),
    // 못 읽었으면 null. 형식이 깨진 값을 넣느니 비우는 편이 낫다
    email: z.string().email().nullable().catch(null),
    confidence,
    evidence: Evidence,
  })),

  /** 기회 — 무엇을 얼마에 파나 */
  what: z.array(z.object({
    dealName: z.string(),
    productOrScope: z.string().nullable(),
    /** 언급 없으면 null. **추측 금지** — 지어낸 금액이 파이프라인 합계에 들어가면 사업 판단이 흔들린다 */
    amountMinor: z.number().int().nullable(),
    currency: z.enum(['KRW', 'USD']).nullable(),
    confidence,
    evidence: Evidence,
  })),

  /** 진행 — 지금 어디까지 왔나. 미팅 하나에 단계는 하나다 */
  where: z.object({
    suggestedStageName: z.string().nullable(),
    reason: z.string().nullable(),
    nextMilestone: z.string().nullable(),
    confidence,
    evidence: Evidence,
  }).nullable(),

  /** 신호 — 이 딜을 흔드는 것들 */
  risk: z.array(z.object({
    kind: RiskKind,
    polarity: RiskPolarity,
    description: z.string().max(300),
    confidence,
    evidence: Evidence,
  })),

  /** 행동 — 그래서 다음에 뭘 하나 */
  next: z.array(z.object({
    title: z.string().max(120),
    /** YYYY-MM-DD. 못 읽었으면 null — 없는 기한을 만들면 그 할 일은 거짓으로 밀린다 */
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
    /** "우리 측" | "고객 측" | 이름 */
    assigneeHint: z.string().nullable(),
    emailDraftGist: z.string().nullable(),
    confidence,
    evidence: Evidence,
  })),
})

export type FiveAxisOutput = z.infer<typeof FiveAxisOutput>

/** 모델이 코드펜스로 감싸 오는 일이 잦다 — 파싱 전에 벗긴다 */
function stripFence(text: string): string {
  const t = text.trim()
  if (!t.startsWith('```')) return t
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
}

/**
 * 모델 응답을 5축으로 읽는다.
 *
 * **부분 실패를 허용하지 않는다.** 다섯 축 중 하나가 깨졌는데 나머지를 저장하면,
 * 사용자는 그 미팅에서 "리스크가 없었다"고 읽는다 — 실제로는 못 읽은 것인데.
 * 파싱이 깨지면 러너가 한 번 더 묻는다(runner 의 재시도).
 */
export function parseFiveAxis(text: string): FiveAxisOutput {
  const parsed = JSON.parse(stripFence(text))
  return FiveAxisOutput.parse(parsed)
}

/**
 * 근거 없는 항목을 걸러낸다.
 *
 * 스키마가 `segmentIds.min(1)` 로 막지만, 모델이 **존재하지 않는 구간 id** 를 지어낼 수 있다.
 * 실재하는 id 만 남기고, 하나도 안 남으면 그 항목을 버린다 —
 * "근거가 있다고 했는데 열어 보니 없는" 것이 가장 나쁘다.
 */
export function dropUngrounded(out: FiveAxisOutput, validSegmentIds: Set<string>): FiveAxisOutput {
  const ok = (e: Evidence) => e.segmentIds.some((id) => validSegmentIds.has(id))
  return {
    who: out.who.filter((x) => ok(x.evidence)),
    what: out.what.filter((x) => ok(x.evidence)),
    where: out.where && ok(out.where.evidence) ? out.where : null,
    risk: out.risk.filter((x) => ok(x.evidence)),
    next: out.next.filter((x) => ok(x.evidence)),
  }
}

/** 축별 항목 수 — 화면이 "이 미팅에서 5가지를 찾았어요"라고 말할 수 있어야 한다 */
export function countAxes(out: FiveAxisOutput): Record<string, number> {
  return {
    who: out.who.length,
    what: out.what.length,
    where: out.where ? 1 : 0,
    risk: out.risk.length,
    next: out.next.length,
  }
}
