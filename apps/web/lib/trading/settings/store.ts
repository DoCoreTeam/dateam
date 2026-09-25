import 'server-only'

/**
 * 설정 읽기와 쓰기 — **덮어쓰지 않고 판을 쌓는다**
 *
 * ## 왜 갱신이 아니라 추가인가 (명세 M7 · §15.2)
 *
 * 값을 덮어쓰면 「그날 무엇으로 판단했나」가 사라진다. 어제 판단이 왜 그랬는지 물었을 때
 * 오늘 값으로 대답하게 되고, 그 대답은 틀렸는지조차 알 수 없다.
 * 그래서 `trading_settings` 는 `(key, version)` 이 유일 키이고 줄이 쌓인다.
 *
 * ## 왜 거래일을 인자로 받나
 *
 * 전략 변경은 **다음 거래일부터**다. 지금 값을 물으면 「오늘 기준 값」인지
 * 「가장 마지막에 저장한 값」인지 갈린다 — 갈리면 장중에 바꾼 값이 그날 판단에 섞인다.
 * 그래서 묻는 쪽이 항상 기준 날짜를 댄다. 기준 없는 조회 함수는 두지 않는다.
 *
 * ## 서비스롤을 쓰는 이유
 *
 * `trading_settings` 는 정책 0개로 잠겨 있다(마이그 279). 소유자 확인은
 * `lib/trading/access.ts` 가 창구에서 하고, 여기는 확인을 지난 뒤에만 불린다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { computeRisk, checkSettingsStorable } from '../risk/arithmetic.ts'
import { pickEffective, type EffectiveRow } from './pick-effective.ts'
import {
  TRADING_SETTINGS,
  defaultSettings,
  tradingSetting,
  validateSetting,
  validateSettingSet,
  type SettingRejection,
  type TradingSettingValue,
} from './registry.ts'

/** 한 거래일 기준의 값 전부와, 그 값이 몇 판인가 */
export interface TradingSettingsSnapshot {
  values: Readonly<Record<string, TradingSettingValue>>
  /** 이 스냅샷을 만든 판 중 가장 큰 번호. 판단 행에 함께 적는다(§14.1) */
  version: number
}

/**
 * 이 거래일에 쓸 값 전부.
 *
 * 저장된 판이 없는 키는 레지스트리 초기값으로 채운다 — 값이 비어 있는 채로
 * 판단이 돌지 않게 한다. 채운 사실은 판 번호에 안 실린다(저장된 것만 판이 있다).
 */
export async function loadTradingSettings(tradeDate: string): Promise<TradingSettingsSnapshot> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_settings')
    .select('key, value, version, effective_trade_date')
    .lte('effective_trade_date', tradeDate)

  // 조용히 기본값으로 넘어가지 않는다 — 읽기가 막힌 것과 아직 안 정한 것은 다르다
  if (error) throw new Error(`설정을 읽지 못했습니다: ${error.message}`)

  const effective = pickEffective((data ?? []) as EffectiveRow[], tradeDate)
  const values: Record<string, TradingSettingValue> = defaultSettings()
  let version = 0
  for (const [key, row] of effective) {
    // 레지스트리에서 사라진 옛 키는 무시한다. 코드가 안 읽는 값을 되살리지 않는다
    if (!tradingSetting(key)) continue
    values[key] = row.value
    if (row.version > version) version = row.version
  }
  return { values, version }
}

export interface SaveSettingInput {
  key: string
  value: TradingSettingValue
  source: 'init' | 'admin' | 'ai'
  reason?: string
  changedBy?: string | null
  /** 이 날부터 유효하다. 보통 다음 거래일 */
  effectiveTradeDate: string
}

export type SaveSettingResult =
  | { ok: true; version: number }
  | { ok: false; rejection: SettingRejection }

/**
 * 값 하나를 다음 판으로 저장한다.
 *
 * 두 사람이 같은 키를 동시에 저장하면 같은 판 번호를 노리게 되고, 유일 키가 뒤를 막는다.
 * 막힌 쪽은 실패로 돌려보낸다 — 조용히 덮어쓰면 한 사람의 변경이 사라진다.
 */
export async function saveTradingSetting(input: SaveSettingInput): Promise<SaveSettingResult> {
  const rejection = validateSetting(input.key, input.value)
  if (rejection) return { ok: false, rejection }

  /**
   * **리스크 산술이 안 맞는 설정은 저장되지 않는다** (M6 · §9).
   *
   * 일일 손실 한도가 1회 위험보다 작으면 그 설정으로는 어떤 신호도 못 나간다.
   * 저장해 두면 화면에는 「신호가 안 온다」로만 보이고, 왜 안 오는지는 아무 데도 안 적힌다.
   */
  if (input.key === 'daily_loss_limit_krw' && typeof input.value === 'number') {
    const blocked = await checkLimitAgainstRisk(input.value, input.effectiveTradeDate)
    if (blocked) return { ok: false, rejection: blocked }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data: last, error: readError } = await admin
    .from('trading_settings')
    .select('version')
    .eq('key', input.key)
    .order('version', { ascending: false })
    .limit(1)
  if (readError) {
    return {
      ok: false,
      rejection: { reason: `read_failed:${readError.message}`, userMessage: '이전 설정을 읽지 못해 저장을 멈췄습니다' },
    }
  }

  const nextVersion = ((last ?? [])[0]?.version ?? 0) + 1
  const { error: writeError } = await admin.from('trading_settings').insert({
    key: input.key,
    value: input.value,
    version: nextVersion,
    source: input.source,
    reason: input.reason ?? null,
    changed_by: input.changedBy ?? null,
    effective_trade_date: input.effectiveTradeDate,
  })
  // supabase-js 는 쓰기 오류를 던지지 않고 돌려준다. 안 보면 0건 저장이 성공으로 보인다
  if (writeError) {
    return {
      ok: false,
      rejection: { reason: `write_failed:${writeError.message}`, userMessage: '설정을 저장하지 못했습니다' },
    }
  }
  return { ok: true, version: nextVersion }
}

/**
 * 첫 실행에 초기값을 한 번 심는다.
 *
 * 이미 판이 있는 키는 건드리지 않는다 — 다시 심으면 관리자가 바꾼 값이
 * 초기값으로 되돌아간다(마이그레이션이 상태 플래그를 덮어쓴 전례와 같은 사고다).
 */
export async function seedTradingSettings(effectiveTradeDate: string): Promise<{ seeded: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_settings').select('key')
  if (error) throw new Error(`설정을 읽지 못했습니다: ${error.message}`)

  const existing = new Set(((data ?? []) as { key: string }[]).map((r) => r.key))
  const missing = TRADING_SETTINGS.filter((s) => !existing.has(s.key))
  if (missing.length === 0) return { seeded: [] }

  const { error: writeError } = await admin.from('trading_settings').insert(
    missing.map((s) => ({
      key: s.key,
      value: s.defaultValue,
      version: 1,
      source: 'init',
      reason: `레지스트리 초기값 (${s.source})`,
      effective_trade_date: effectiveTradeDate,
    })),
  )
  if (writeError) throw new Error(`설정 초기값을 심지 못했습니다: ${writeError.message}`)
  return { seeded: missing.map((s) => s.key) }
}

export { validateSettingSet }

/**
 * 상품 규격 — 승수와 호가 간격. **숫자를 코드에 안 적는다**(M6).
 *
 * `trading_instruments` 가 유일한 출처다. 못 읽으면 던진다 —
 * 기본값을 끼워 넣으면 미니와 정규의 승수가 5배 다른데 그것을 모르고 위험을 계산한다.
 */
export async function loadInstrumentSpec(
  tradeDate: string,
): Promise<{ multiplier: number; tickSize: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { values } = await loadTradingSettings(tradeDate)
  const root = String(values.instrument_root ?? 'MINI_KOSPI200')
  const { data, error } = await admin
    .from('trading_instruments').select('multiplier, tick_size').eq('root', root).maybeSingle()
  if (error) throw new Error(`상품 규격을 읽지 못했습니다: ${error.message}`)
  if (!data) throw new Error(`상품 규격이 없습니다: ${root}`)
  return { multiplier: Number(data.multiplier), tickSize: Number(data.tick_size) }
}

/**
 * 이 한도로 신호가 나갈 수 있나.
 *
 * 상품 규격과 손절 설정에서 「보통의 1회 위험」을 만들어 한도와 견준다.
 * 규격을 못 읽으면 **막지 않는다** — 읽기 장애가 저장 금지가 되면 설정을 못 고친다.
 */
async function checkLimitAgainstRisk(
  limitKrw: number,
  tradeDate: string,
): Promise<SettingRejection | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { values } = await loadTradingSettings(tradeDate)
  const root = String(values.instrument_root ?? 'MINI_KOSPI200')
  const { data } = await admin
    .from('trading_instruments').select('multiplier, tick_size').eq('root', root).maybeSingle()
  if (!data) return null

  const atr = 1.3
  const stopMultiple = Number(values.exit_stop_atr_multiple) || 1.2
  const chaseMultiple = Number(values.exit_chase_atr_multiple) || 0.3
  const reference = 1100
  const risk = computeRisk({
    direction: 'long',
    instrument: { multiplier: Number(data.multiplier), tickSize: Number(data.tick_size) },
    referencePrice: reference,
    stopPrice: reference - stopMultiple * atr,
    chaseDistance: chaseMultiple * atr,
    stopSlippageTicks: Number(values.replay_fallback_ticks) || 2,
    roundTripFeeKrw: Number(values.fee_rate) || 0,
    quantity: 1,
  })
  return checkSettingsStorable({ dailyLossLimitKrw: limitKrw, typicalRisk: risk })
}
