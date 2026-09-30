/**
 * 적중 상태 낱말 — 표의 CHECK 제약과 한 벌
 *
 * ## 왜 상수로 두나
 *
 * 코드가 글자를 손으로 적으면 표에 없는 값을 쓸 수 있고, supabase-js 는 제약 위반을
 * **던지지 않고 돌려준다.** 그래서 틀린 값은 오류가 아니라 「아무 일도 안 일어남」으로 보인다.
 *
 * 실측 2026-09-30: `markAdopted` 가 `'adopted'` 를 쓰는데 제약은 `new·opened·dismissed` 뿐이라
 * 케이스를 만들어도 적중이 목록에 그대로 남았다. 51행이 전부 `new` 였다.
 *
 * 그래서 낱말을 한자리에 두고, 표의 제약과 같은지를 시험이 센다.
 */

export const HIT_STATUS = {
  /** 찾았고 아직 아무것도 안 정했다 */
  new: 'new',
  /** 사람이 열어 봤다 */
  opened: 'opened',
  /** 상관없다고 빼 두었다 — 되돌릴 수 있다 */
  dismissed: 'dismissed',
  /** 케이스가 됐다 — 이 적중은 할 일이 끝났다 */
  adopted: 'adopted',
} as const

export type HitStatus = (typeof HIT_STATUS)[keyof typeof HIT_STATUS]

export const HIT_STATUSES: readonly HitStatus[] = Object.values(HIT_STATUS)

/** 목록에 기본으로 보이는 상태 — 아직 정하지 않은 것만 */
export const DEFAULT_LIST_STATUS: HitStatus = HIT_STATUS.new

/** 사람이 바꿀 수 있는 상태. 케이스로 만드는 것은 담기 경로가 따로 정한다 */
export const USER_SETTABLE: readonly HitStatus[] = [HIT_STATUS.new, HIT_STATUS.dismissed]

export function isHitStatus(v: unknown): v is HitStatus {
  return typeof v === 'string' && (HIT_STATUSES as readonly string[]).includes(v)
}

/**
 * 목록에서 볼 상태를 정한다.
 *
 * 모르는 값이면 기본값으로 떨어진다 — 주소창에 아무 글자나 넣었다고 빈 목록을 보여 주면
 * 사용자는 「공고가 없다」로 읽는다.
 */
export function listStatusOf(raw: unknown): HitStatus {
  return isHitStatus(raw) ? raw : DEFAULT_LIST_STATUS
}

/** 사람이 바꿔 달라고 한 상태가 받아도 되는 것인가 */
export function isUserSettable(v: unknown): v is HitStatus {
  return isHitStatus(v) && (USER_SETTABLE as readonly string[]).includes(v)
}
