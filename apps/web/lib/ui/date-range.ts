// 날짜 입력의 허용 범위 — `components/ui/DateField`가 쓰는 순수 로직 (SSOT)
//
// **왜 범위를 우리가 정하나**: raw `<input type="date">`는 연도 칸의 자릿수를 막지 않는다.
// 날짜를 연속으로 타이핑하면 `202609`년이 그대로 유효한 값으로 받아들여지고,
// 저장되면 정렬·범위필터·만료판정이 전부 어긋난다.
// 브라우저가 안 막는다는 것은 우리가 막아야 한다는 뜻이지 안 막아도 된다는 뜻이 아니다.
//
// **'오늘'은 항상 KST다.** 여기서 `new Date().toISOString().slice(0,10)`을 쓰면
// 오전 9시 이전에 어제가 찍힌다 — 계산은 전부 `lib/datetime/kst.ts`를 거친다.
//
// 컴포넌트(.tsx)가 아니라 여기 두는 이유: node:test가 JSX를 못 읽어서
// 이 로직이 컴포넌트 안에 있으면 가드가 검증할 수 없다.

import { addKstDays, kstTodayKey } from '../datetime/kst.ts'

/** 하한 — 이보다 과거는 오타로 본다(회사 설립 이전 날짜를 실수로 저장할 이유가 없다). */
export const DATE_MIN = '2000-01-01'

/** 상한까지의 여유 — 오늘 + 10년. 6자리 연도는 이 상한을 넘으므로 무효가 된다. */
const MAX_AHEAD_DAYS = 3650

/** 오늘(KST) 'YYYY-MM-DD'. 화면의 기본값 계산은 이걸 쓴다. */
export function today(): string {
  return kstTodayKey()
}

/** 오늘(KST)로부터 n일 뒤 'YYYY-MM-DD'. 유효기간·마감 기본값용. */
export function todayPlus(days: number): string {
  return addKstDays(kstTodayKey(), days)
}

/** 상한 기본값 — 오늘 + 10년. */
export function dateMax(): string {
  return addKstDays(kstTodayKey(), MAX_AHEAD_DAYS)
}

/**
 * 범위 안의 'YYYY-MM-DD'인가. 빈 문자열(미지정)은 허용한다.
 *
 * `min`/`max` 속성만으로는 부족하다 — 그건 폼 제출을 막을 뿐이고,
 * 우리 화면은 대부분 JS로 저장하므로 범위 밖 값도 `onChange`로 그냥 흘러든다.
 * 그래서 여기서 한 번 더 걸러 **상태에 들어가지 못하게** 한다.
 */
export function isInRange(value: string, min: string, max: string): boolean {
  if (value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false // 5자리 이상 연도는 여기서 걸린다
  return value >= min && value <= max // 'YYYY-MM-DD'는 사전순 비교 = 시간순 비교
}
