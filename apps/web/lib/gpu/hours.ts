// 시간 환산 계수 SSOT — 월/주/일/년 → 시간.
//   기준: "월 = 720시간(30일 × 24h)" — intake 입력파일 자체 규약이자 golden 정답(J37, normalize-money.test T4).
//   왜 SSOT: 720(코드 산술) vs 730(AI 프롬프트·catalog-map·golden 일부)이 이원화돼 같은 월단가가 경로에 따라
//   ±1.4% 다른 시간단가가 되던 사고(v0.7.351) 해소. 전 경로가 이 파일만 import — 리터럴(720/730/8760/168) 재등장 금지.
export const HOURS_PER_MINUTE = 1 / 60
export const HOURS_PER_HOUR = 1
export const HOURS_PER_DAY = 24
export const HOURS_PER_WEEK = 168
export const HOURS_PER_MONTH = 720
export const HOURS_PER_YEAR = 8760

export type HourPeriod = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

/** 기간 → 시간 계수. (minute·week 포함 — 시간제/주단위 요금 지원) */
export const HOURS_PER_PERIOD: Record<HourPeriod, number> = {
  minute: HOURS_PER_MINUTE,
  hour: HOURS_PER_HOUR,
  day: HOURS_PER_DAY,
  week: HOURS_PER_WEEK,
  month: HOURS_PER_MONTH,
  year: HOURS_PER_YEAR,
}
