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

// 초까지 — 로그·감사처럼 **몇 초에 났는지가 곧 사실**인 화면 전용
const SECOND_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

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

/**
 * 'YYYY-MM-DD'(KST 날짜키)에 n일을 더한 KST 날짜키.
 * UTC 절단(toISOString().slice) 금지 정책의 SSOT — 정오 앵커 후 항상 KST로 되돌린다.
 */
export function addKstDays(dateKey: string, n: number): string {
  if (!DATE_RE.test(dateKey)) return dateKey
  const ms = new Date(`${dateKey}T12:00:00${KST_OFFSET}`).getTime() // 정오 앵커(자정 경계 안전)
  if (Number.isNaN(ms)) return dateKey
  return kstDateKey(new Date(ms + n * 86_400_000).toISOString())
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

/**
 * 문서용 KST 전체 표기 — '2026년 8월 12일 14시 20분'.
 * 밖으로 나가는 산출물(회의록·보고서)은 축약형(2026-08-12 14:20)이 아니라 이 형식을 쓴다.
 * 00:00이면 날짜만('2026년 8월 12일') — 시각 미지정을 자정으로 단정해 보이지 않게.
 */
export function formatKstDateTimeKorean(iso: string): string {
  const p = kstParts(iso)
  if (!p) return ''
  const date = `${p.year}년 ${p.month}월 ${p.day}일`
  if (p.hour === 0 && p.minute === 0) return date
  return `${date} ${p.hour}시 ${String(p.minute).padStart(2, '0')}분`
}

/**
 * ISO → KST 'YYYY-MM-DD HH:MM:SS'. **분 단위로 잘라 쓰면 안 되는 화면** 전용.
 *
 * 왜 따로 두나: `formatKstDateTimeShort`는 '8/24 14:15'까지만 준다 — 일정·카드 라벨에는 맞지만
 * 로그에서는 틀린 표기다. 같은 분 안에서 여러 번 난 실패가 **같은 시각으로 보이고**,
 * 연도가 없어 어제 것인지 작년 것인지 구분되지 않는다.
 * (사용자 지적 2026-08-24: "시간이 완전 핵심인데 시간이 정확한 시간으로 안 나오네")
 */
export function formatKstDateTimeExact(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${DATE_FMT.format(d)} ${SECOND_FMT.format(d).replace(/^24:/, '00:')}`
}

/** ISO → KST 'HH:MM:SS'. 같은 날 안에서 앞뒤를 비교할 때 날짜를 반복하지 않는다. */
export function formatKstTimeExact(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return SECOND_FMT.format(d).replace(/^24:/, '00:')
}

/**
 * '지금으로부터 얼마나 전인가' — 로그에서 절대시각만큼 중요한 사실이다.
 * 관리자가 목록을 보고 가장 먼저 판단하는 것은 "이거 아직도 나고 있나"이고,
 * 그 답은 절대시각이 아니라 **경과**가 준다.
 */
export function formatKstAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (sec < 0) return '방금'
  if (sec < 60) return '방금'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}일 전`
  const month = Math.floor(day / 30)
  return month < 12 ? `${month}달 전` : `${Math.floor(month / 12)}년 전`
}

/** 월/일 + 선택적 시각 KST 라벨('6/17' 또는 '6/17 14:00'). 00:00이면 시각 생략. */
export function formatKstDateTimeShort(iso: string): string {
  const p = kstParts(iso)
  if (!p) return ''
  const base = `${p.month}/${p.day}`
  if (p.hour === 0 && p.minute === 0) return base
  return `${base} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}
