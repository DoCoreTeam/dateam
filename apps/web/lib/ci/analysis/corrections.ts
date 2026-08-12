// lib/ci/analysis/corrections.ts — 정정 학습 루프 (설계서 §11.4)
//
// "사용자 정정이 소용없음 → 정정 데이터를 버림"이 1차 실패 진단에 적힌 결함이었다.
// ci_corrections에 쌓기만 하고 아무도 읽지 않으면 정확히 그 상태다.
//
// 이 모듈이 하는 일은 둘.
//  (1) 정정 사례를 분류 프롬프트의 예시로 만든다 — 같은 실수를 두 번 하지 않게.
//  (2) 반복 정정을 규칙 승격 후보로 올린다 — 매번 AI를 부르지 말고 규칙으로 굳히게.
//
// 순수 함수만 둔다. DB 조회는 loadTopicCorrections 하나로 격리한다.

/** 프롬프트에 넣을 정정 예시 상한. 많이 넣을수록 비싸고, 오래된 것은 오히려 방해가 된다. */
export const CORRECTION_EXAMPLE_MAX = 8

/** 규칙 승격을 제안할 최소 반복 횟수. 한두 번은 우연일 수 있다. */
export const RULE_PROMOTION_MIN_REPEAT = 3

export interface CorrectionRecord {
  /** 정정 대상 콘텐츠의 제목 — 예시의 본문이 된다 */
  title: string | null
  /** AI·규칙이 붙였던 주제 */
  fromTopicId: string | null
  /** 사용자가 고쳐 넣은 주제 */
  toTopicId: string | null
  createdAt: string
}

/**
 * 분류 프롬프트에 붙일 정정 예시.
 *
 * "무엇을 무엇으로 고쳤다"만 보여주고 이유를 지어내지 않는다 —
 * 사용자는 이유를 남기지 않았고, 없는 근거를 AI에게 사실처럼 주면 학습이 아니라 오염이다.
 */
export function buildCorrectionExamples(
  records: readonly CorrectionRecord[],
  topicNameById: Readonly<Record<string, string>>,
  max: number = CORRECTION_EXAMPLE_MAX,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const r of records) {
    if (out.length >= max) break
    const title = r.title?.trim()
    if (!title) continue                       // 제목 없는 예시는 배울 것이 없다
    if (!r.toTopicId) continue                 // "주제 없음"으로 되돌린 것은 예시로 쓰지 않는다

    const to = topicNameById[r.toTopicId]
    if (!to) continue                          // 삭제된 주제는 예시가 아니라 혼선이다

    const key = `${title}→${to}`
    if (seen.has(key)) continue
    seen.add(key)

    const from = r.fromTopicId ? topicNameById[r.fromTopicId] : null
    out.push(from
      ? `- "${title.slice(0, 80)}" → ${to} (${from}(으)로 잘못 분류했던 것)`
      : `- "${title.slice(0, 80)}" → ${to}`)
  }

  return out
}

export interface RulePromotion {
  topicId: string
  topicName: string
  /** 이 주제로 몇 번 고쳐졌는가 */
  repeats: number
  /** 사람에게 보여줄 제안 문장 */
  suggestion: string
}

/**
 * 반복 정정 → 규칙 승격 제안.
 * 확정은 사람이 한다. 자동으로 규칙을 만들면 오분류가 규칙으로 굳어 되돌리기 어렵다.
 */
export function suggestRulePromotions(
  records: readonly CorrectionRecord[],
  topicNameById: Readonly<Record<string, string>>,
  minRepeat: number = RULE_PROMOTION_MIN_REPEAT,
): RulePromotion[] {
  const counts = new Map<string, number>()
  for (const r of records) {
    if (!r.toTopicId) continue
    counts.set(r.toTopicId, (counts.get(r.toTopicId) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .filter(([topicId, n]) => n >= minRepeat && topicNameById[topicId])
    .sort((a, b) => b[1] - a[1])
    .map(([topicId, repeats]) => ({
      topicId,
      topicName: topicNameById[topicId],
      repeats,
      suggestion:
        `"${topicNameById[topicId]}"으로 ${repeats}번 고치셨어요. `
        + '이 주제의 포함 키워드를 추가하면 다음부터 자동으로 분류됩니다',
    }))
}
