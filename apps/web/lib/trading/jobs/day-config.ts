import 'server-only'

/**
 * 거래일 시작 시 굳히는 것 — **하루에 한 번만 정한다** (명세 §14.4)
 *
 * ## 왜 필요한가
 *
 * 두 가지를 동시에 푼다.
 *
 * ① **배포도 전략을 바꾼다.** 장중에 `lib/trading/**` 이 바뀌면 그날 판단이 앞뒤로 달라지고,
 *    나중에 그 하루를 하나의 성적으로 셀 수 없다. 거래일 시작에 값을 굳혀 두고 비교한다.
 * ② **종목 정보를 매분 받지 않는다.** `syncContracts` 는 92KB 짜리 마스터를 내려받는다.
 *    분마다 부르면 하루 1,440번이다 — 남의 다운로드 서버에 할 짓이 아니고, 그만큼 느려진다.
 *    명세 §6.3 도 「매 거래일 장 시작 전에」라고 적는다.
 *
 * 그래서 그날 처음 도는 실행만 마스터를 받고, 나머지는 굳혀 둔 값을 읽는다.
 */

import { createAdminClient } from '@/lib/supabase/server'

export interface DayConfig {
  tradeDate: string
  tradingLogicVersion: string | null
  settingsVersion: number | null
  frontContractCode: string
  frozenAt: string
}

/** 그날 굳혀 둔 값. 없으면 null — 그때가 그날 처음 도는 실행이다 */
export async function loadDayConfig(tradeDate: string): Promise<DayConfig | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_day_config')
    .select('trade_date, trading_logic_version, settings_version, front_contract_code, frozen_at')
    .eq('trade_date', tradeDate)
    .maybeSingle()
  if (error) throw new Error(`거래일 설정을 읽지 못했습니다: ${error.message}`)
  if (!data) return null
  return {
    tradeDate: data.trade_date,
    tradingLogicVersion: data.trading_logic_version ?? null,
    settingsVersion: data.settings_version ?? null,
    frontContractCode: data.front_contract_code,
    frozenAt: data.frozen_at,
  }
}

export interface FreezeInput {
  tradeDate: string
  tradingLogicVersion: string
  settingsVersion: number
  frontContractCode: string
}

/**
 * 그날 값을 굳힌다.
 *
 * 이미 굳어 있으면 **안 덮는다.** 덮으면 장중 배포가 그날의 기준을 조용히 갈아치우고,
 * 그것을 잡으려고 만든 장치가 그것을 숨기는 장치가 된다.
 *
 * @returns 굳어 있는 값(내가 굳혔든 남이 굳혔든)
 */
export async function freezeDayConfig(input: FreezeInput): Promise<DayConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_day_config').insert({
    trade_date: input.tradeDate,
    trading_logic_version: input.tradingLogicVersion,
    settings_version: input.settingsVersion,
    front_contract_code: input.frontContractCode,
  })
  // 유일 키에 걸렸으면 같은 분의 다른 실행이 먼저 굳힌 것이다. 오류가 아니라 경주다
  if (error && !/duplicate key/i.test(error.message) && error.code !== '23505') {
    throw new Error(`거래일 설정을 굳히지 못했습니다: ${error.message}`)
  }
  const frozen = await loadDayConfig(input.tradeDate)
  if (!frozen) throw new Error('거래일 설정을 굳혔는데 다시 읽지 못했습니다')
  return frozen
}

/**
 * 장중에 판단 코드가 바뀌었나 (§14.4 SG-12 의 재료).
 *
 * 바뀌었다고 여기서 막지는 않는다 — 1-A 는 신호를 안 내므로 막을 것이 없다.
 * 대신 **그날을 「구성 변경일」로 갈라 셀 수 있게** 사실만 돌려준다.
 */
export function logicChangedToday(frozen: DayConfig, current: string | null): boolean {
  if (!frozen.tradingLogicVersion || !current) return false
  return frozen.tradingLogicVersion !== current
}
