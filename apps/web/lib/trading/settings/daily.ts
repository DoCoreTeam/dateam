/**
 * 매일 보는 값 — **먼저 꺼내 놓는다**
 *
 * ## 왜 필요했나
 *
 * 설정 92개가 한 줄로 평평하게 놓여 있었다. 매일 여는 값과 일 년에 한 번 여는 값이
 * 같은 무게라, 무엇부터 봐야 하는지를 읽는 사람이 혼자 정해야 했다
 * (사용자 지적 2026-09-27 「여기 있는 설정들 다 뭔지 모르겠어」).
 *
 * ## 숨기는 것이 아니다
 *
 * 앞으로 꺼낸 값도 원래 묶음에 그대로 남는다. 같은 값이 두 자리에 보이는 것이
 * 값이 두 개인 것보다 낫다 — 묶음에서 사라지면 「안전 게이트를 다 봤다」고 믿은 사람이
 * 못 본 값이 생긴다.
 *
 * 그리고 접힌 묶음에는 **기본값과 다른 개수**를 적는다. 접었다고 사실이 사라지지 않는다.
 */

import { TRADING_SETTINGS, type TradingSettingValue } from './registry.ts'

/**
 * 매일 보는 여덟.
 *
 * 고른 기준은 「하루에 한 번이라도 볼 이유가 있나」다. 돈이 걸린 것, 켜고 끄는 것,
 * 그리고 지금 무엇으로 판단하는지. 나머지는 정해 두고 안 건드리는 값이다.
 */
export const DAILY_LABEL = '매일 보는 것'

export const DAILY_KEYS: readonly string[] = [
  'notify_enabled',
  'daily_target_krw',
  'daily_loss_limit_krw',
  'signal_max_per_day',
  'jev_provider',
  'jev_model',
  'instrument_root',
  'kis_env',
]

/** 등재된 키만 남긴다. 이름을 바꾼 날 조용히 빈 자리가 되지 않게 */
export function dailySettings(): typeof TRADING_SETTINGS[number][] {
  return DAILY_KEYS
    .map((key) => TRADING_SETTINGS.find((s) => s.key === key))
    .filter((s): s is typeof TRADING_SETTINGS[number] => s !== undefined)
}

/**
 * 이 묶음에서 기본값과 다른 값이 몇 개인가.
 *
 * 접힌 머리에 이 수를 적는다. 「안전 게이트 8개 중 2개가 기본값과 다릅니다」가 보이면
 * 펴 보지 않아도 무엇이 남아 있는지 안다.
 */
export function changedCount(
  keys: readonly string[],
  values: Readonly<Record<string, TradingSettingValue>>,
): number {
  let n = 0
  for (const key of keys) {
    const spec = TRADING_SETTINGS.find((s) => s.key === key)
    if (!spec) continue
    const now = values[key]
    // 값이 아직 없으면 기본값을 쓰는 것이다. 다른 것이 아니다
    if (now === undefined || now === null) continue
    if (JSON.stringify(now) !== JSON.stringify(spec.defaultValue)) n += 1
  }
  return n
}

/** 접힌 머리에 붙는 표. 「몇 개가 기본값과 다른가」를 한 조각으로 */
export function SETTING_CHANGED(n: number): string {
  return `${n}개 바꿈`
}

export const SETTING_CHANGED_TITLE = '기본값과 다른 값의 개수입니다'
