import 'server-only'

/**
 * 오늘 무슨 월물을 보는가 — **묻는 자리가 하나다**
 *
 * `pickFrontContract` 가 규칙을 쥐고, 이 파일이 그 규칙에 넣을 값 셋을 읽어 온다.
 * 읽는 쪽(현황·실시간 가격·검증)이 각자 표를 조회하면, 한 곳만 고치는 날
 * 같은 질문에 두 답이 생긴다 — 2026-09-30 과 2026-10-02 에 두 번 그랬다.
 *
 * **수집(`jobs/tick.ts`)은 이 함수를 안 부른다.** 수집은 굳은 값이 없으면 스스로
 * 마스터를 받아 굳히는 쪽이고, 그 일은 이 읽기와 방향이 반대다. 수집이 굳힌 값을
 * 나머지가 따라 읽는 것이 이 파일의 전부다.
 *
 * 굳은 값을 읽는 일도 새로 쓰지 않고 수집이 쓰는 `loadDayConfig` 를 그대로 부른다.
 * 같은 표를 두 군데서 읽으면 그 둘이 갈라질 자리가 또 하나 생긴다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { kstTodayKey } from '@/lib/datetime/kst'
import { loadDayConfig } from '../jobs/day-config.ts'
import { pickFrontContract, type FrontPick } from './front.ts'

/** 월물 표가 아는 그 월물의 머리글. 코드만으로는 무슨 종목인지 못 말한다 */
export interface TodayContractHead {
  code: string
  /** 종목 뿌리(`MINI_KOSPI200` 등). 표에 그 코드가 없으면 null */
  root: string | null
  /** 만기월 `YYYY-MM`. 표에 그 코드가 없으면 null */
  expiryMonth: string | null
  source: FrontPick['source']
  /**
   * 월물 표가 근월물로 표시한 코드. 우리가 보는 것과 다를 수 있다 —
   * 교체 기한이 거래가 아직 안 넘어온 월물을 먼저 집는 날이 그렇다(실측 2026-10-07).
   * 못 읽었으면 null
   */
  exchangeFrontCode: string | null
}

/** 월물 표의 근월물 한 줄. `is_front` 를 읽는 자리는 이 파일 안뿐이다 */
async function frontCodeFromTable(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_contracts')
    .select('code')
    .eq('is_front', true)
    .limit(1)
  if (error) throw new Error(`월물 표를 읽지 못했습니다: ${error.message}`)
  const code = String((data ?? [])[0]?.code ?? '').trim()
  return code === '' ? null : code
}

/**
 * 그날 쓸 월물 한 줄.
 *
 * @param override 설정 `front_contract_code_override`
 * @param now 기준 시각. 안 주면 지금
 */
export async function loadTodayContract(
  override: string | null | undefined,
  now?: Date,
): Promise<FrontPick> {
  const tradeDate = kstTodayKey(now)

  /*
    **못 읽은 것과 없는 것을 안 섞는다.** 굳은 값 조회가 실패했는데 그것을 「아직 안 굳었다」로
    읽으면 표로 떨어져 크론과 다른 월물을 본다 — 이 파일이 막으려는 바로 그 일이다.
    `loadDayConfig` 와 `frontCodeFromTable` 둘 다 조회 실패에는 던진다.
  */
  const [frozen, fromTable] = await Promise.all([loadDayConfig(tradeDate), frontCodeFromTable()])

  return pickFrontContract({
    override,
    frozen: frozen?.frontContractCode ?? null,
    fromTable,
  })
}

/** 코드만 필요할 때. 못 정했으면 null */
export async function loadTodayContractCode(
  override: string | null | undefined,
  now?: Date,
): Promise<string | null> {
  return (await loadTodayContract(override, now)).code
}

/**
 * 그날 쓸 월물에 종목 이름까지 붙여서. 못 정했으면 null
 *
 * 머리글이 「A05610 근월물」이라고만 적고 있어 읽는 사람이 무엇을 보는 화면인지 몰랐다
 * (사용자 개입 2026-09-30). 그래서 종목 뿌리와 만기월을 함께 읽는다.
 *
 * **굳은 값이 표에 없어도 코드는 돌려준다.** 교체 다음 날의 마스터가 아직 안 들어왔다고
 * 화면이 「월물이 없다」고 말하면, 크론이 쌓고 있는 봉을 못 찾는 일이 다시 난다.
 */
export async function loadTodayContractHead(
  override: string | null | undefined,
  now?: Date,
): Promise<TodayContractHead | null> {
  const pick = await loadTodayContract(override, now)
  if (!pick.code) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_contracts')
    .select('expiry_month, trading_instruments(root)')
    .eq('code', pick.code)
    .limit(1)
  if (error) throw new Error(`월물을 읽지 못했습니다: ${error.message}`)

  const row = (data ?? [])[0] as
    | { expiry_month?: string; trading_instruments?: { root?: string } | { root?: string }[] }
    | undefined
  // 조인 결과는 한 줄일 수도 배열일 수도 있다. 둘 다 받아 두지 않으면 모양 하나에 조용히 null 이 된다
  const joined = Array.isArray(row?.trading_instruments)
    ? row?.trading_instruments[0]
    : row?.trading_instruments

  return {
    code: pick.code,
    root: joined?.root ?? null,
    expiryMonth: row?.expiry_month ?? null,
    source: pick.source,
    /*
      **보는 월물과 표가 말하는 근월물을 함께 돌려준다.** 화면이 둘을 견주려면 둘이 필요하고,
      `is_front` 를 읽는 자리는 이 파일 안뿐이라는 규율도 지켜야 한다
    */
    exchangeFrontCode: await frontCodeFromTable(),
  }
}
