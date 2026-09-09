/**
 * 마감 — 기간을 닫는 일 (순수)
 *
 * **왜 필요한가**(사용자 지시): *"월말 스냅샷은 너무 당연한거 아냐, 마감이라는 개념이
 * 있어야지 시스템이 날짜기준으로 마감을 먼저 하고 사용자가 수정 할 수 있게 말이야"*
 *
 * 딜은 계속 움직인다. 그래서 「9월 수주」를 10월에 다시 조회하면 **다른 숫자**가 나온다 —
 * 투자사에 보고한 숫자와 지금 화면의 숫자가 다르면, 어느 쪽이 맞는지 아무도 모른다.
 * 마감은 그 시점의 숫자를 **박아 두는 일**이다.
 *
 * 세 단계다. 되돌릴 수 있는 것과 없는 것을 가른다:
 *   가마감 — 시스템이 다음 달 1일에 계산해 둔다. 딜을 고치면 다시 계산된다
 *   검토 중 — 사람이 보는 중. 아직 다시 계산된다
 *   확정  — 잠긴다. 이후 수정은 **수정본으로 새로** 만든다(덮어쓰지 않는다)
 *
 * 순수하다 — DB 도 화면도 모른다.
 */

import type { CloseStateKey } from '../../terms/report.ts'
import { periodRange, periodLabel, type Period } from './target.ts'

export type { CloseStateKey }

/** 상태가 갈 수 있는 곳 — 여기 없는 이동은 막는다 */
const NEXT: Record<CloseStateKey, CloseStateKey[]> = {
  draft: ['reviewing'],
  reviewing: ['draft', 'confirmed'],
  // 확정은 끝이다. 되돌리려면 **수정본을 새로 만든다** — 되돌리기는 기록을 지운다
  confirmed: [],
}

export function canMove(from: CloseStateKey, to: CloseStateKey): boolean {
  return NEXT[from]?.includes(to) ?? false
}

/** 이 상태에서 숫자가 아직 다시 계산되나 */
export function isLive(state: CloseStateKey): boolean {
  return state !== 'confirmed'
}

/**
 * 이 기간을 마감할 수 있나.
 *
 * **끝나지 않은 기간은 못 닫는다.** 9월 중에 9월을 확정하면 남은 날의 수주가
 * 영원히 빠진다 — 그건 마감이 아니라 손실이다.
 */
export function isClosable(period: Period, todayKey: string): boolean {
  const { to } = periodRange(period)
  return to < todayKey
}

/** 왜 못 닫는지 — 버튼을 흐리게만 하면 사람은 이유를 모른다 */
export function closeBlockedReason(period: Period, todayKey: string): string | null {
  if (isClosable(period, todayKey)) return null
  const { to } = periodRange(period)
  return `${periodLabel(period)}은 ${to} 에 끝납니다. 끝나야 마감할 수 있어요`
}

export interface CloseRecord {
  /** 기간 열쇠 — `formatPeriodKey` 와 같은 모양 */
  periodKey: string
  state: CloseStateKey
  /** 확정 시점에 박아 둔 숫자. 지표 키 → 값(문자열) */
  snapshot: Record<string, string>
  /** 확정 시점의 통화별 금액까지 남긴다 — 합쳐 버리면 되돌릴 수 없다 */
  byCurrency?: Record<string, Record<string, string>>
  confirmedAt?: string
  confirmedBy?: string | null
  note?: string
  /** 몇 번째 수정본인가. 확정 뒤 고치면 1씩 는다 — 덮어쓰지 않는다 */
  revision: number
}

export const CLOSE_SETTING_KEY = 'report.closes'
/** 기록 상한 — 넘으면 오래된 것부터 지운다. 무한히 쌓이면 설정 한 줄이 통째로 무거워진다 */
export const MAX_CLOSES = 120

export class CloseError extends Error {
  // strip-only 모드는 «생성자 매개변수 속성»을 못 읽는다 — 필드를 따로 선언한다
  readonly field?: string
  constructor(message: string, field?: string) {
    super(message)
    this.name = 'CloseError'
    this.field = field
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const STATES: CloseStateKey[] = ['draft', 'reviewing', 'confirmed']

export function validateClose(raw: unknown): CloseRecord {
  if (!isRecord(raw)) throw new CloseError('마감 기록이 아닙니다.')
  const periodKey = String(raw.periodKey ?? '').trim()
  if (!periodKey) throw new CloseError('어느 기간인지 없습니다.', 'periodKey')
  const state = String(raw.state ?? '') as CloseStateKey
  if (!STATES.includes(state)) throw new CloseError('모르는 마감 상태입니다.', 'state')

  const snapshot: Record<string, string> = {}
  if (isRecord(raw.snapshot)) {
    for (const [k, v] of Object.entries(raw.snapshot)) {
      if (typeof v === 'string' && /^-?\d+$/.test(v)) snapshot[k] = v
    }
  }
  const rev = Number(raw.revision ?? 0)
  return {
    periodKey,
    state,
    snapshot,
    byCurrency: isRecord(raw.byCurrency) ? (raw.byCurrency as CloseRecord['byCurrency']) : undefined,
    confirmedAt: typeof raw.confirmedAt === 'string' ? raw.confirmedAt : undefined,
    confirmedBy: typeof raw.confirmedBy === 'string' ? raw.confirmedBy : null,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : undefined,
    revision: Number.isInteger(rev) && rev >= 0 ? rev : 0,
  }
}

export function validateCloses(raw: unknown): CloseRecord[] {
  if (!Array.isArray(raw)) throw new CloseError('마감 목록이 아닙니다.')
  if (raw.length > MAX_CLOSES) throw new CloseError(`마감 기록은 ${MAX_CLOSES}개까지입니다.`)
  const out = raw.map(validateClose)
  const seen = new Set<string>()
  for (const c of out) {
    if (seen.has(c.periodKey)) throw new CloseError('같은 기간의 마감이 두 번 있습니다.', 'periodKey')
    seen.add(c.periodKey)
  }
  return out
}

export function findClose(closes: readonly CloseRecord[], periodKey: string): CloseRecord | null {
  return closes.find((c) => c.periodKey === periodKey) ?? null
}

/**
 * 상태를 옮긴다.
 *
 * **확정을 덮어쓰지 않는다.** 확정된 기간을 다시 확정하면 `revision` 이 오르고
 * 새 숫자가 박힌다 — 예전 숫자는 그 자리에 없어지지만, 몇 번째 판인지는 남는다.
 */
export function moveClose(
  current: CloseRecord | null,
  to: CloseStateKey,
  next: { snapshot: Record<string, string>; byCurrency?: CloseRecord['byCurrency']; at: string; by: string | null; periodKey: string },
): CloseRecord {
  const from: CloseStateKey = current?.state ?? 'draft'
  if (current && !canMove(from, to)) {
    if (!(from === 'confirmed' && to === 'confirmed')) {
      throw new CloseError(`${from} 에서 ${to} 로는 옮길 수 없습니다.`, 'state')
    }
  }
  const revision = to === 'confirmed' && current?.state === 'confirmed'
    ? (current.revision ?? 0) + 1
    : (current?.revision ?? 0)
  return {
    periodKey: next.periodKey,
    state: to,
    // 확정할 때만 숫자를 박는다 — 그 전에는 계속 살아 있는 값이다
    snapshot: to === 'confirmed' ? next.snapshot : (current?.snapshot ?? {}),
    byCurrency: to === 'confirmed' ? next.byCurrency : current?.byCurrency,
    confirmedAt: to === 'confirmed' ? next.at : current?.confirmedAt,
    confirmedBy: to === 'confirmed' ? next.by : current?.confirmedBy,
    note: current?.note,
    revision,
  }
}
