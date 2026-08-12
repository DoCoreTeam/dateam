// lib/ci/alerts/rules.ts — 떡상 알림 판정 SSOT (설계서 §8.1)
//
// "관심 채널의 새 게시물이 평소 대비 3배(기본값, 조정 가능)를 넘기면 알림.
//  매일 접속할 이유의 1번"
//
// DB를 임포트하지 않는다. 순수 판정만 담아 단위 테스트가 붙는다.
// 알림을 보낼지 말지를 화면·잡·API가 각자 판단하면 기준이 갈라진다 — 여기 하나만 본다.

/** 방해 금지 시간 (설정 `alert.quiet_hours`의 값 모양) */
export interface QuietHours {
  enabled: boolean
  /** 'HH:MM' 벽시계 */
  start: string
  /** 'HH:MM' 벽시계 */
  end: string
}

/**
 * 한 번의 재훑기에서 만들 알림 상한.
 * 채널 하나를 처음 통째로 수집하면 떡상 후보가 수십 건 쏟아진다.
 * 상한이 없으면 첫 사용자가 알림 60개를 맞고 알림함을 영영 안 연다.
 */
export const ALERT_MAX_PER_PASS = 20

/**
 * 알림 대상으로 볼 수집 시점의 상한(일).
 * 배수는 형제가 들어온 뒤에야 서기 때문에 과거 콘텐츠도 뒤늦게 자격을 얻는다.
 * 그렇다고 반년 전에 담아둔 것까지 "지금 떡상했다"고 알리면 거짓말이 된다.
 */
export const ALERT_LOOKBACK_DAYS = 14

/** 알림 기준 배수의 하한. 설정에서 이보다 낮출 수 없다(레지스트리와 같은 값). */
export const ALERT_MIN_THRESHOLD = 1.5

/** 'HH:MM' → 분. 형식이 틀리면 null. */
export function parseHhmm(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * 지금이 방해 금지 시간인가.
 * 22:00~08:00처럼 자정을 넘는 구간이 기본값이라 단순 비교로는 틀린다.
 *
 * 방해 금지 중에는 알림을 **만들지 않는다**. 재훑기가 주기적으로 돌기 때문에
 * 시간이 지나면 같은 후보를 다시 집어 그때 전달한다 — 설정의 "모아두었다가 이후에 전달"이
 * 별도 보류 큐 없이 성립한다(중복은 dedup 유니크 인덱스가 막는다).
 */
export function isQuietAt(quiet: QuietHours | null | undefined, hhmm: string): boolean {
  if (!quiet?.enabled) return false
  const now = parseHhmm(hhmm)
  const start = parseHhmm(quiet.start)
  const end = parseHhmm(quiet.end)
  if (now === null || start === null || end === null) return false
  if (start === end) return false                    // 길이 0 구간은 방해 금지가 아니다
  if (start < end) return now >= start && now < end  // 같은 날 안에서 끝남
  return now >= start || now < end                   // 자정을 넘김
}

export interface AlertCandidate {
  /** 평소 대비 배수 — 근거가 부족하면 null */
  outlierIndex: number | null
  /** 배수를 낸 비교군 크기 */
  baselineN: number
  /** 수집 시각(ISO). 오래된 것은 "지금 떡상"이 아니다 */
  collectedAt: string
}

/**
 * 이 콘텐츠가 알림 자격을 갖췄는가.
 * 배수만 보고 알리면, 비교군 3건짜리 신생 채널이 매번 "떡상"으로 울린다.
 */
export function qualifiesForAlert(
  candidate: AlertCandidate,
  threshold: number,
  minBaseline: number,
  now: Date = new Date(),
): boolean {
  const { outlierIndex, baselineN, collectedAt } = candidate
  if (outlierIndex === null || !Number.isFinite(outlierIndex)) return false
  if (baselineN < minBaseline) return false
  if (outlierIndex < Math.max(threshold, ALERT_MIN_THRESHOLD)) return false

  const t = Date.parse(collectedAt)
  if (!Number.isFinite(t)) return false
  const ageDays = (now.getTime() - t) / 86_400_000
  return ageDays <= ALERT_LOOKBACK_DAYS
}

/**
 * 알림 문구. 숫자를 그대로 쓰되 근거를 함께 말한다 —
 * "떡상"만 있고 몇 배인지 없으면 사용자가 알림을 신뢰하지 않는다.
 */
export function alertTitle(channelName: string | null, outlierIndex: number): string {
  const times = outlierIndex >= 10 ? Math.round(outlierIndex) : Math.round(outlierIndex * 10) / 10
  return channelName
    ? `${channelName} — 평소 대비 ${times}배`
    : `평소 대비 ${times}배`
}

export function alertBody(title: string | null, baselineN: number): string {
  const head = title?.trim() ? title.trim() : '제목 없음'
  return `${head} · 같은 채널 ${baselineN}건과 비교한 결과입니다`
}
