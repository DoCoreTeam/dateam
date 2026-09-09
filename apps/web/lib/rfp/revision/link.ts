/**
 * 정정공고 잇기 (설계서 F11)
 *
 * ## 앞 차수를 지우지 않는다
 *
 * 정정공고가 뜨면 「금액이 5억에서 6억으로 바뀌었다」를 보여 줘야 한다.
 * 앞 차수를 지우고 새로 만들면 **무엇이 바뀌었는지 영영 말할 수 없고**,
 * 지난 리포트를 근거로 쓴 제안서도 설명이 안 된다.
 *
 * ## 차수는 공고번호 안에서만 뜻이 있다
 *
 * 다른 공고의 2차와 이 공고의 2차는 아무 관계가 없다. 그래서 (공고번호, 차수) 가 짝이다.
 */

export interface Revision {
  caseId: string
  noticeNo: string
  round: number
  isLatest: boolean
  createdAt: string
}

export type LinkProblem = 'same_round' | 'lower_round' | 'different_notice'

export interface LinkResult {
  /** 앞 차수 케이스 — 새 케이스의 supersedes 가 여기를 가리킨다 */
  supersedes: Revision | null
  /** 더 이상 최신이 아닌 케이스들 */
  demote: string[]
  problems: LinkProblem[]
}

/**
 * 새 차수를 기존 차수들에 잇는다.
 *
 * 같은 차수를 다시 넣으면 막는다 — 같은 차수가 둘이면
 * 「무엇이 최신인가」에 답할 수 없다.
 */
export function linkRevision(
  incoming: { noticeNo: string; round: number; caseId: string },
  existing: readonly Revision[],
): LinkResult {
  const problems: LinkProblem[] = []
  const sameNotice = existing.filter((r) => r.noticeNo === incoming.noticeNo)

  if (existing.some((r) => r.noticeNo !== incoming.noticeNo)) {
    problems.push('different_notice')
  }
  if (sameNotice.some((r) => r.round === incoming.round)) {
    problems.push('same_round')
    return { supersedes: null, demote: [], problems }
  }

  const older = sameNotice.filter((r) => r.round < incoming.round)
  if (older.length === 0 && sameNotice.length > 0) {
    // 앞 차수보다 낮은 차수가 들어왔다 — 늦게 도착한 옛 공고다
    problems.push('lower_round')
    return { supersedes: null, demote: [], problems }
  }

  const previous = older.sort((a, b) => b.round - a.round)[0] ?? null
  return {
    supersedes: previous,
    // 앞 차수들은 최신 표시만 뗀다. 지우지 않는다
    demote: sameNotice.filter((r) => r.isLatest).map((r) => r.caseId),
    problems,
  }
}

/** 이 공고의 최신 차수 */
export function latestOf(revisions: readonly Revision[], noticeNo: string): Revision | null {
  const same = revisions.filter((r) => r.noticeNo === noticeNo)
  if (same.length === 0) return null
  return same.reduce((a, b) => (b.round > a.round ? b : a))
}

/** 차수 사슬 — 화면이 「1차 → 2차 → 3차」로 그린다 */
export function chainOf(revisions: readonly Revision[], noticeNo: string): Revision[] {
  return revisions
    .filter((r) => r.noticeNo === noticeNo)
    .sort((a, b) => a.round - b.round)
}
