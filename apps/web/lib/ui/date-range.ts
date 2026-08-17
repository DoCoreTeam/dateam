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

/**
 * 상한 — 오늘로부터 10년. 6자리 연도는 이 상한을 넘으므로 무효가 된다.
 *
 * 날짜로 세지 않는다. 3650일은 윤일 때문에 10년보다 **2~3일 짧아**
 * 문서에 적힌 '오늘+10년'과 화면의 max 가 어긋난다(실측 지적: 2036-08-14 vs 2036-08-17).
 * 연도만 더하면 윤년과 무관하게 정확히 10년이다.
 */
const MAX_AHEAD_YEARS = 10

/** 오늘(KST) 'YYYY-MM-DD'. 화면의 기본값 계산은 이걸 쓴다. */
export function today(): string {
  return kstTodayKey()
}

/** 오늘(KST)로부터 n일 뒤 'YYYY-MM-DD'. 유효기간·마감 기본값용. */
export function todayPlus(days: number): string {
  return addKstDays(kstTodayKey(), days)
}

/** 상한 기본값 — 오늘 + 10년(같은 월·일). */
export function dateMax(): string {
  const [y, rest] = splitYear(kstTodayKey())
  return `${y + MAX_AHEAD_YEARS}${rest}`
}

/** 'YYYY-MM-DD' → [연도, '-MM-DD']. 윤일 계산 없이 연도만 옮기기 위해. */
function splitYear(key: string): [number, string] {
  return [Number(key.slice(0, 4)), key.slice(4)]
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

/**
 * 이 값을 부모 상태에 실을 것인가.
 *
 * **빈 값에는 두 가지 뜻이 있고, 정반대로 다뤄야 한다.**
 * 브라우저 날짜 칸은 연·월·일이 다 차기 전에는 무엇을 하고 있든 빈 문자열을 준다.
 *
 * | 상황 | 실으면 | 안 실으면 |
 * |---|---|---|
 * | 연도를 이어 치는 중 | **이미 있던 날짜가 통째로 날아간다** | 정상 |
 * | Backspace 로 지우는 중 | 정상 | **'마감 없음'으로 되돌릴 방법이 사라진다** |
 *
 * 둘 다 실측 100% 재현된 사고다. 값만으로도, `badInput` 만으로도 가를 수 없다 —
 * Backspace 는 세그먼트를 하나씩 지우므로 **지우는 도중에도** 나머지 칸이 남아 `badInput` 이 참이다.
 * 실제 구분점은 **직전에 지우기 키를 눌렀는가**뿐이라 호출부가 그것을 넘겨준다.
 */
export function shouldCommit(
  next: string,
  o: { deleting: boolean; badInput: boolean; min: string; max: string },
): boolean {
  if (next === '' && !o.deleting && o.badInput) return false // 아직 치는 중
  return isInRange(next, o.min, o.max)
}
