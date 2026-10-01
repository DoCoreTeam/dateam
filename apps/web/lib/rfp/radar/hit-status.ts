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

/**
 * 한 번에 바꿀 수 있는 최대 건수.
 *
 * 상한이 없으면 화면이 「전체 선택」으로 수천 건을 한 요청에 실어 보내고, 그 요청은
 * 타임아웃으로 죽는다. 죽으면 **일부만 바뀐 채로** 끝나고 사용자는 무엇이 바뀌었는지 모른다.
 * 상한이 있으면 적어도 「몇 개까지」를 말해 줄 수 있다.
 */
export const MAX_BULK = 100

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BulkCheck {
  ok: boolean
  ids: string[]
  /** 왜 안 되는지 — 화면이 그대로 보여 준다 */
  reason: 'empty' | 'too_many' | 'bad_status' | null
}

/**
 * 한 번에 바꾸기 요청을 검사한다.
 *
 * uuid 가 아닌 것은 **버리지 않고 걸러 센다** — 조용히 버리면 열 개를 선택했는데 여덟 개만
 * 바뀌고 화면은 열 개가 바뀐 것처럼 보인다.
 */
export function checkBulk(rawIds: unknown, rawStatus: unknown): BulkCheck {
  if (!isUserSettable(rawStatus)) return { ok: false, ids: [], reason: 'bad_status' }

  const list = Array.isArray(rawIds) ? rawIds : []
  const ids = Array.from(new Set(list.filter((v): v is string => typeof v === 'string' && UUID.test(v))))

  if (ids.length === 0) return { ok: false, ids: [], reason: 'empty' }
  if (ids.length > MAX_BULK) return { ok: false, ids, reason: 'too_many' }
  return { ok: true, ids, reason: null }
}
