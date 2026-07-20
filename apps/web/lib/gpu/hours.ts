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

/**
 * 기간 → **개월** 계수 — 정액 반복요금(flat·base_fee) 전용.
 *   왜 별도 SSOT: 정기 구독료의 연↔월은 달력(1년=12개월)이지 시간비가 아니다.
 *   HOURS_PER_YEAR/HOURS_PER_MONTH = 8760/720 = 12.167로 환산하면 年額 요금에 +1.4% 오차가 붙는다
 *   (월=30일 규약과 연=365일이 태생적으로 불일치하기 때문). 사용량 요금(usage)은 실제 가동시간이
 *   기준이므로 그대로 HOURS_PER_PERIOD를 쓴다 — 두 축을 섞지 말 것.
 *   월 미만 주기는 월=30일 규약과 일관되게 시간계수에서 파생.
 */
export const MONTHS_PER_PERIOD: Record<HourPeriod, number> = {
  minute: HOURS_PER_MONTH / HOURS_PER_MINUTE,
  hour: HOURS_PER_MONTH / HOURS_PER_HOUR,
  day: HOURS_PER_MONTH / HOURS_PER_DAY,
  week: HOURS_PER_MONTH / HOURS_PER_WEEK,
  month: 1,
  year: 1 / 12,
}
