// lib/ci/window.ts — 조회 기간(일) 정규화 SSOT
//
// 왜 필요한가 (실브라우저 실측, v0.7.489):
//   `Number(sp.windowDays ?? 28) || 28`은 숫자면 무엇이든 통과시킨다.
//     · `windowDays=-5`  → 화면이 "-5일 기준, 표본 0건"이라고 말한다(미래를 조회한 셈)
//     · `windowDays=999999` → `Date.now() - 999999일`이 표현 범위를 벗어나
//       기간 조건이 아무것도 못 잡아 **"표본 0건"**이 된다.
//       사용자는 "전부 보려고 크게 넣었는데 데이터가 사라졌다"고 읽는다. 조용한 거짓말이다.
//
// 조건 파싱이 세 곳(트렌드 화면·떡상 API·어시스턴트)에 복붙돼 있어 한 곳만 고치면
// 나머지가 같은 값을 다르게 읽는다. 그래서 함수 하나로 모은다.

/** 기본 창. 화면 선택지(7·28·90)의 가운데 값이자 지금까지의 기본값. */
export const DEFAULT_WINDOW_DAYS = 28

/** 하루보다 짧은 창은 의미가 없다. */
export const MIN_WINDOW_DAYS = 1

/**
 * 상한. 2년이면 이 제품이 다루는 어떤 분석보다 길다.
 * 상한을 두는 이유는 성능이 아니라 **날짜 계산이 깨지지 않게** 하기 위해서다.
 */
export const MAX_WINDOW_DAYS = 730

/**
 * 조회 기간을 안전한 값으로 만든다.
 *
 * 숫자가 아니면 기본값으로, 범위를 벗어나면 **잘라낸다**(버리지 않는다) —
 * 사용자가 크게 넣은 의도는 "많이 보고 싶다"이지 "아무것도 보지 말라"가 아니다.
 */
export function normalizeWindowDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_DAYS
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.floor(n)))
}
