// DATETIME 정합성 SSOT — 모든 KST↔UTC 변환의 단일 출처.
//
// 정책(절대 불변):
//  1. DB(timestamptz)에는 **항상 UTC 절대시각**으로 저장한다.
//  2. 폼 입력(사용자가 고른 KST 벽시계)은 WRITE 시 반드시 `+09:00` 앵커를 붙여
//     절대시각으로 변환한다 → timestamptz가 UTC로 정확히 적재한다.
//  3. 표시·달력 그룹핑·범위 필터는 **항상 KST로 변환**한다.
//
// 금지(이 사고의 근본원인 — v0.7.273 이전 캘린더 +9h 버그):
//  - `${date}T${time}:00` 처럼 **오프셋 없는 naive 문자열**을 DB에 저장 (UTC로 오해석 → +9h)
//  - `iso.slice(11,16)` raw slice 로 시각 표시 (서버=UTC 그대로 노출)
//  - `new Date(iso).getHours()` / `.getDate()` 로 서버에서 날짜·시각 산출 (서버TZ=UTC 의존)
//  - `new Date().toISOString().slice(0,10)` 로 "오늘 날짜" 산출 (KST 자정 전후 1일 오차)
//  이런 처리는 전부 아래 함수로 대체한다.

export const KST_OFFSET = '+09:00'

const KST_TZ = 'Asia/Seoul'
// en-GB(24h) → 'HH:MM' / 자정은 '00'으로 안전(ko-KR은 '24:00'을 주므로 회피)
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: KST_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
// en-CA → 'YYYY-MM-DD'
const DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: KST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const HAS_TZ_RE = /[zZ]$|[+-]\d{2}:\d{2}$/

/** KST 벽시계(date='YYYY-MM-DD', time='HH:MM')를 절대시각 ISO(+09:00 앵커)로. timestamptz에 넣으면 UTC로 정확히 적재된다. */
export function kstWallToIso(date: string, time: string): string {
  if (!DATE_RE.test(date)) throw new Error(`kstWallToIso: 잘못된 날짜 '${date}'`)
  if (!TIME_RE.test(time)) throw new Error(`kstWallToIso: 잘못된 시각 '${time}'`)
  return `${date}T${time}:00${KST_OFFSET}`
}

/** 종일/날짜만 입력을 KST 자정 앵커 ISO로. (그룹핑은 kstDateKey가 다시 KST로 되돌리므로 날짜가 보존된다) */
export function kstDateOnlyToIso(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`kstDateOnlyToIso: 잘못된 날짜 '${date}'`)
  return `${date}T00:00:00${KST_OFFSET}`
}

/**
 * naive 벽시계 문자열('YYYY-MM-DDTHH:MM[:SS]')을 KST로 간주해 +09:00 ISO로 정규화.
 * 이미 시간대(Z/±hh:mm)가 있으면 그대로 둔다. (Gemini 추천 등 외부가 만든 naive 문자열 수문장)
 */
export function normalizeKstWallString(s: string): string {
  if (!s || HAS_TZ_RE.test(s)) return s
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s)
  if (!m) return s
  return `${m[1]}T${m[2]}:00${KST_OFFSET}`
}

/** ISO → KST 'HH:MM'. 파싱 불가 시 ''. */
export function formatKstTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return TIME_FMT.format(d).replace(/^24:/, '00:')
}

/** ISO(또는 'YYYY-MM-DD') → KST 기준 'YYYY-MM-DD'. 달력 그룹핑·범위 키 전용. */
export function kstDateKey(iso: string): string {
  if (DATE_RE.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return DATE_FMT.format(d)
}

/** ISO → KST 분해 {year,month,day,hour,minute}. 라벨 조립용(getHours/getDate 직접 사용 금지). */
export function kstParts(iso: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const [y, mo, da] = DATE_FMT.format(d).split('-').map(Number)
  const [hh, mm] = TIME_FMT.format(d).replace(/^24:/, '00:').split(':').map(Number)
  return { year: y, month: mo, day: da, hour: hh, minute: mm }
}

/** KST '오늘' 'YYYY-MM-DD'. 서버/클라 무관 동일 결과(toISOString().slice(0,10) 대체). */
export function kstTodayKey(now: Date = new Date()): string {
  return DATE_FMT.format(now)
}

/** KST 날짜 범위(start,end='YYYY-MM-DD')를 UTC 절대시각 경계 ISO로. DB timestamptz 범위필터 전용. */
export function kstRangeToUtc(start: string, end: string): { fromIso: string; toIso: string } {
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) throw new Error(`kstRangeToUtc: 잘못된 범위 '${start}'~'${end}'`)
  return {
    fromIso: new Date(`${start}T00:00:00${KST_OFFSET}`).toISOString(),
    toIso: new Date(`${end}T23:59:59.999${KST_OFFSET}`).toISOString(),
  }
}

/** 월/일 + 선택적 시각 KST 라벨('6/17' 또는 '6/17 14:00'). 00:00이면 시각 생략. */
export function formatKstDateTimeShort(iso: string): string {
  const p = kstParts(iso)
  if (!p) return ''
  const base = `${p.month}/${p.day}`
  if (p.hour === 0 && p.minute === 0) return base
  return `${base} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
