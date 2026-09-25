/**
 * 설정 화면이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다. 설정 묶음 이름은
 * 설정 화면·관리자 화면·나중의 변경 이력이 모두 같은 말로 불러야 한다.
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다)
 */

import type { TradingSettingGroup, UsedFrom } from './registry.ts'

/** 묶음 이름과 순서. 설정 화면의 절이 이 순서로 선다 */
export const TRADING_GROUP_LABEL: Record<TradingSettingGroup, string> = {
  basic: '기본',
  instrument: '상품과 세션',
  decision: '판단',
  collect: '수집',
  broker: '증권사 연결',
  risk: '일일 한도',
  replay: '체결 재현',
}

/**
 * 언제부터 이 값을 실제로 읽는가.
 *
 * 화면이 이것을 밝히는 이유: 지금 아무도 안 읽는 값이 목록에 섞여 있으면
 * 관리자는 그 값을 바꾸고 **뭔가 달라질 것으로 기대한다.** 안 달라진다.
 */
export const TRADING_USED_FROM_LABEL: Record<UsedFrom, string> = {
  '1-A': '지금 씁니다',
  '1-B': '검증 단계부터',
  '1-C': '알림 단계부터',
}

/** 빈 값을 빈칸으로 두지 않는다 — 안 정한 것과 못 읽은 것이 화면에서 같아 보인다 */
export function formatTradingSettingValue(value: unknown): string {
  if (value === '' || value === null || value === undefined) return '지정 안 됨'
  if (typeof value === 'number') return value.toLocaleString('ko-KR')
  if (typeof value === 'boolean') return value ? '켬' : '끔'
  return String(value)
}
