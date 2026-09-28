/**
 * 관문 화면이 쓰는 말 — 화면 파일 안에 두지 않는다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다)
 */

import type { CriterionStatus } from './criteria.ts'
import { NOT_MEASURED, NOT_MEASURED_SENTENCE } from '../../terms/index.ts'
import { TRADING_NAV } from '../nav/groups.ts'

export const GATE_STATUS_LABEL: Record<CriterionStatus, string> = {
  pass: '통과',
  fail: '미달',
  // 「미달」과 다른 상태다. 나쁜 것이 아니라 아직 모르는 것이다
  insufficient: NOT_MEASURED,
}

/** 상태별 색 토큰. 「측정 전」은 붉지 않다 — 붉으면 나쁜 것으로 읽힌다 */
export const GATE_STATUS_COLOR: Record<CriterionStatus, string> = {
  pass: 'var(--text)',
  fail: 'var(--nb-danger)',
  insufficient: 'var(--text-muted)',
}

/**
 * 검증 화면이 쓰는 문장. 화면 파일 안에 두면 같은 말이 화면마다 갈라진다
 * (플랜 완료 정의: 사용자 노출 문자열은 lib 의 라벨 상수에 둠).
 */
export const VALIDATION_PAGE_DESCRIPTION =
  `관문을 다 지나야 알림을 켤 수 있습니다. 「${NOT_MEASURED}」인 항목은 표본이 더 쌓여야 합니다`

/** 미달이 하나도 없고 안 잰 것만 남았을 때의 머리글 */
export const GATE_HEADLINE_NOT_MEASURED = `${NOT_MEASURED_SENTENCE}. 표본이 더 모여야 합니다`

/** 세 상태가 무엇을 뜻하는지 — 「측정 전」이 미달로 읽히지 않게 */
export const GATE_HELP =
  `여덟 줄을 전부 넘어야 알림 단계로 넘어갑니다. 「${NOT_MEASURED}」은 미달이 아니라 표본이 모자란 것입니다`

/**
 * 안내가 가리키는 화면으로 가는 길 — **말한 곳에는 갈 수 있어야 한다**
 *
 * 실측 2026-09-28: 검증 화면이 「자료 화면에서 모인 봉을 볼 수 있습니다」를 **아홉 번**
 * 말하는데 그 화면에 링크가 **0개**였다. 읽은 사람은 사이드바에서 스스로 찾아가야 했다.
 * 가라고 말해 놓고 길을 안 주면 그 문장은 안내가 아니라 훈수다.
 *
 * 주소를 여기 적지 않고 **사이드바 배치에서 찾는다.** 두 곳에 적으면 메뉴를 옮긴 날
 * 안내만 옛 주소를 가리키고, 그것은 아무도 안 깨진 것처럼 보인다.
 */
export function howHref(how: string | undefined | null): string | null {
  if (!how) return null
  for (const item of TRADING_NAV) {
    // 「자료 화면에서」처럼 화면 이름 뒤에 「화면」이 붙은 자리만 길로 본다
    if (how.includes(`${item.label} 화면`)) return item.href
  }
  return null
}
