// 캘린더 시각 표시 SSOT — 모든 캘린더 표면(월 셀·상세 패널·미니캘린더)이 import.
// 원시 UTC slice(11,16) 금지: ISO 문자열을 KST(Asia/Seoul) 기준 HH:MM으로 일원화.
// (사고: 셀=ev.start_at.slice(11,16)=01:00 vs 패널=로컬변환 10:00 으로 9시간 어긋남)

const KST_TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** ISO 문자열 → KST HH:MM. 파싱 불가 시 빈 문자열. */
export function formatKstTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // ko-KR 24h는 자정을 "24:00"으로 줄 수 있어 "00:00"으로 보정
  return KST_TIME_FORMATTER.format(d).replace(/^24:/, '00:')
}

const KST_MD_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
})

/** "YYYY-MM-DD" 또는 ISO → "M/D" (마감/작성 일자 라벨용). 파싱 불가 시 빈 문자열. */
export function formatMonthDay(dateOrIso: string): string {
  // 날짜만 들어오면 로컬 자정으로 고정해 TZ 경계 흔들림 방지
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso) ? `${dateOrIso}T00:00:00` : dateOrIso
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const parts = KST_MD_FORMATTER.formatToParts(d)
  const m = parts.find((p) => p.type === 'month')?.value ?? ''
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  return m && day ? `${m}/${day}` : ''
}
