/**
 * Lockbox 정책 — **한 번만 연다** (명세 §13.3 · §15.3)
 *
 * ## 왜 한 번인가
 *
 * 최종 검증 구간을 여러 번 보면 그 구간도 결국 개발 구간이 된다. 「이번엔 안 좋으니
 * 조건을 조금 고쳐서 다시」를 세 번만 해도 그 성적은 이미 그 자료에 맞춰진 것이고,
 * 마지막 확인이라는 뜻을 잃는다.
 *
 * ## 왜 사람만 여나 (§15.3)
 *
 * 「Lockbox 열기와 관문 통과 선언」은 AI 가 절대 못 바꾸는 목록에 있다.
 * 열기는 되돌릴 수 없는 결정이다 — 한 번 보면 안 본 것으로 만들 수 없다.
 */

export type Actor = { kind: 'human'; userId: string } | { kind: 'ai'; agent: string }

export interface LockboxRecord {
  name: string
  windowFrom: string
  windowTo: string
  openedAt: string
  openedBy: string
  reason: string
}

export type LockboxDecision =
  | { allowed: true }
  | { allowed: false; reason: string; userMessage: string }

/**
 * 열어도 되나.
 *
 * @param existing 이미 연 기록. 있으면 **언제 열었는지**를 사유에 담는다 —
 *   「이미 열렸습니다」만으로는 누가 언제 왜 열었는지 찾으러 가야 한다
 */
export function canOpenLockbox(
  actor: Actor,
  existing: LockboxRecord | null,
  reason: string,
): LockboxDecision {
  if (actor.kind !== 'human') {
    return {
      allowed: false,
      reason: `not_human:${actor.agent}`,
      userMessage: '최종 검증 구간은 사람만 열 수 있습니다. 되돌릴 수 없는 결정이기 때문입니다',
    }
  }
  if (reason.trim().length < 5) {
    return {
      allowed: false,
      reason: 'reason_too_short',
      userMessage: '무엇을 확인하려고 여는지 적어 주세요. 한 번만 열 수 있습니다',
    }
  }
  if (existing) {
    return {
      allowed: false,
      reason: `already_opened:${existing.openedAt}`,
      userMessage: `최종 검증 구간은 ${existing.openedAt} 에 이미 열렸습니다. `
        + `한 번만 열 수 있고, 그 결과가 마지막 확인입니다`,
    }
  }
  return { allowed: true }
}

/**
 * Lockbox 자료를 읽어도 되나.
 *
 * **열기 전에는 못 읽는다.** 읽을 수 있게 두면 「살짝만 보고」가 가능해지고,
 * 그 순간 한 번만 연다는 규칙은 말뿐이 된다.
 */
export function canReadLockbox(existing: LockboxRecord | null): LockboxDecision {
  if (!existing) {
    return {
      allowed: false,
      reason: 'not_opened',
      userMessage: '최종 검증 구간은 아직 열리지 않았습니다. 열기 전에는 볼 수 없습니다',
    }
  }
  return { allowed: true }
}

/** 열린 뒤에도 구간은 안 바뀐다. 바뀌면 다른 자료를 마지막 확인으로 쓰는 것이다 */
export function windowMatches(existing: LockboxRecord, from: string, to: string): boolean {
  return existing.windowFrom === from && existing.windowTo === to
}
