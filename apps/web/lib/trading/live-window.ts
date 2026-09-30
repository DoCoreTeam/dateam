/**
 * 지금 다시 읽을 때인가 — **닫힌 장을 30초마다 두드리지 않는다**
 *
 * ## 무엇이 고장이었나 (실측 2026-09-28 오후 7시42분)
 *
 * 현황 화면이 「27초 뒤 다시 읽습니다」를 밤새 세고 있었다. 정규장은 15:45 에 끝났고
 * 봉은 15:35 이 마지막인데, 화면은 그 뒤로도 30초마다 서버를 두드리며
 * **똑같은 값을 다시 그렸다.** 사람이 보기에는 「계속 뭔가 오고 있다」로 읽히고,
 * 서버 쪽에서는 아무도 안 보는 화면을 위해 밤새 도는 셈이다.
 *
 * ## 「멈춤」은 고장이 아니라 사실이다
 *
 * 멈추기만 하고 말을 안 하면 그 화면은 **죽은 화면과 구별되지 않는다.**
 * 그래서 멈출 때는 왜 멈췄고 다음에 언제 열리는지를 같이 낸다.
 *
 * ## 달력을 안 본다
 *
 * 세션 달력은 그날 줄이 있어야 답한다. 그런데 이 판정이 필요한 때는 바로 **장 밖**이고,
 * 장 밖에는 그날 줄이 없을 수도 있다(실측: 9/21~9/25 가 통째로 비어 있었다).
 * 요일과 시각은 달력 없이 아는 것이므로 그것만으로 답하고, 공휴일은 못 가른다 —
 * 공휴일에 몇 번 더 두드리는 쪽이, 장이 선 날 화면이 멈추는 쪽보다 덜 나쁘다.
 */

import { REGULAR_TIMES, NIGHT_TIMES, isWeekendInSeoul } from './calendar/session.ts'

export type ClosedReason = 'weekend' | 'after_close' | 'before_open'

export interface LiveWindow {
  /** 다시 읽어야 하나 */
  live: boolean
  /** 안 읽는다면 왜. 읽는 중이면 null */
  reason: ClosedReason | null
  /** 다음에 열리는 때 (서울 벽시계 `HH:MM`). 읽는 중이면 null */
  nextOpenAt: string | null
}

function seoulDateKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
}

/** 서울 벽시계 분 단위. `08:45` → 525 */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function seoulMinutes(at: Date): number {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
  return toMinutes(s)
}

/**
 * 지금이 장중인가. **정규장과 야간장을 둘 다 본다** —
 * 정규장만 보면 밤 8시에 봉이 오는데 화면이 멈춘다.
 *
 * 개장 전 단일가(08:30)부터 살아 있는 것으로 본다. 그때부터 값이 움직이고,
 * 사람은 그 값을 보려고 화면을 연다.
 */
export function liveWindowAt(at: Date): LiveWindow {
  const weekend = isWeekendInSeoul(seoulDateKey(at))
  const minutes = seoulMinutes(at)
  const nightStart = toMinutes(NIGHT_TIMES.start)
  const nightEnd = toMinutes(NIGHT_TIMES.end)
  // 자정을 넘으므로 「크다 그리고 작다」로 쓰면 하루도 안 맞는다
  const inNight = minutes >= nightStart || minutes < nightEnd
  const inRegular = minutes >= toMinutes(REGULAR_TIMES.openAuctionStart)
    && minutes < toMinutes(REGULAR_TIMES.closeAuctionEnd)

  if (weekend) {
    /*
      토요일 새벽은 금요일 밤에 시작한 야간장이 이어지는 중이다 —
      요일만 보고 자르면 살아 있는 장에서 화면이 멈춘다.
    */
    if (inNight && minutes < nightEnd) return { live: true, reason: null, nextOpenAt: null }
    return { live: false, reason: 'weekend', nextOpenAt: REGULAR_TIMES.openAuctionStart }
  }
  if (inRegular || inNight) return { live: true, reason: null, nextOpenAt: null }
  // 정규장이 끝났고 야간장은 아직인 저녁, 또는 새벽에 야간장이 끝난 뒤
  return minutes >= toMinutes(REGULAR_TIMES.closeAuctionEnd)
    ? { live: false, reason: 'after_close', nextOpenAt: NIGHT_TIMES.start }
    : { live: false, reason: 'before_open', nextOpenAt: REGULAR_TIMES.openAuctionStart }
}

/** 멈춘 자리에 적을 말. 화면이 고르지 않는다 */
export const CLOSED_REASON_LABEL: Record<ClosedReason, string> = {
  weekend: '장이 안 서는 날이라 다시 읽지 않습니다',
  after_close: '장이 끝나 다시 읽지 않습니다',
  before_open: '아직 장이 열리기 전이라 다시 읽지 않습니다',
}

export function nextOpenLine(nextOpenAt: string): string {
  return `${nextOpenAt} 에 다시 읽기 시작합니다`
}

/**
 * 봉이 늦었나 — **도착한 시각으로 잰다**
 *
 * 사용자 지적 2026-09-30: 「이거 실시간으로 왜 안움직여?」. 그때 화면은
 * 「마지막 1분봉 오후 01:22 · 133초 전」이라고 적고 있었고, 그 값은 **정상이었다**.
 *
 * 실측 2026-09-30: 1분봉은 시작 + 64초쯤에 저장된다(13:26봉 → 13:27:04).
 * 그런데 화면은 봉이 **시작한** 시각부터 세고 있었다. 그래서 아무 문제가 없어도
 * 64초 밑으로는 절대 안 내려갔고, 다시 읽는 간격까지 더해 늘 100초 넘게 떠 있었다.
 * 「정상인데 늘 늦어 보이는 숫자」는 고장 신호로도 못 쓴다 — 매번 그러니까.
 *
 * 도착 시각으로 재면 정상 범위가 0~60초다. 그 밖으로 나가면 진짜로 안 오고 있는 것이다.
 */
export const BAR_LATE_SECONDS = 90

export interface BarFreshness {
  /** 몇 초 전에 도착했나. 잴 수 없으면 null */
  ageSeconds: number | null
  /** 늦었나. 잴 수 없으면 false — 모르는 것을 고장이라고 하지 않는다 */
  late: boolean
}

/**
 * 마지막 봉이 도착한 지 몇 초인가.
 *
 * 장이 닫혀 있으면 **안 잰다** — 봉이 안 오는 것이 정상인 시간에 초를 세면
 * 멀쩡한 상태가 고장으로 읽힌다.
 */
export function barFreshness(input: {
  availableAt: string | null
  now: Date
  live: boolean
}): BarFreshness {
  const { availableAt, now, live } = input
  if (!live || !availableAt) return { ageSeconds: null, late: false }
  const at = Date.parse(availableAt)
  if (!Number.isFinite(at)) return { ageSeconds: null, late: false }
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - at) / 1000))
  return { ageSeconds, late: ageSeconds > BAR_LATE_SECONDS }
}
