// 캘린더 시각 표시 — datetime SSOT(lib/datetime/kst.ts)로 일원화.
// formatKstTime 은 SSOT 재노출(중복 구현 제거). 기존 import 경로 호환 유지.
export { formatKstTime } from '@/lib/datetime/kst'

import { kstParts } from '@/lib/datetime/kst'

/** 'YYYY-MM-DD' 또는 ISO → KST 'M/D' (마감/작성 일자 라벨용). 파싱 불가 시 빈 문자열. */
export function formatMonthDay(dateOrIso: string): string {
  // 날짜만 들어오면 KST 자정으로 고정해 TZ 경계 흔들림 방지
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso) ? `${dateOrIso}T00:00:00+09:00` : dateOrIso
  const p = kstParts(raw)
  return p ? `${p.month}/${p.day}` : ''
}
