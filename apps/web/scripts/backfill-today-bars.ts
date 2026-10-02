/**
 * 오늘 놓친 1분봉을 증권사에서 받아 온다 — **한 번 쓰고 마는 자리가 아니다**
 *
 * ## 왜 필요한가 (실측 2026-10-02)
 *
 * 월물이 잘못 굳어 수집이 하루 종일 다른 월물을 모았다. 굳은 값을 바로잡아도
 * **그 전 시간대의 봉은 안 돌아온다** — 크론은 직전 1분만 확정하기 때문이다.
 * 운영 화면의 「빠진 봉 다시 받기」는 `deferred_to_collector` 로 넘기고 실제로는 안 받는다
 * (`lib/trading/operator/remedy.ts`). 그래서 그 하루의 차트가 영영 비어 있게 된다.
 *
 * ## 안 하는 것 둘
 *
 * 1 **값을 지어내지 않는다.** 저장 경로는 검증이 쓰는 `backfillMinuteBars` 그대로다 —
 *   증권사가 준 분봉만 들어가고, 이미 가진 봉은 안 덮는다.
 * 2 **기본은 안 쓴다.** `--apply` 가 없으면 몇 개를 받을 셈인지만 센다.
 *
 * 실행: node --import tsx scripts/backfill-today-bars.ts
 *       node --import tsx scripts/backfill-today-bars.ts --apply
 *       node --import tsx scripts/backfill-today-bars.ts --apply --code A05610 --date 2026-10-02
 *
 * `server-only` 를 지나므로 `--tsconfig scripts/tsconfig.json` 이 필요하다:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/backfill-today-bars.ts --apply
 */

import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const at = line.indexOf('=')
  if (at <= 0 || line.trim().startsWith('#')) continue
  const name = line.slice(0, at).trim()
  const value = line.slice(at + 1).trim().replace(/^["']|["']$/g, '')
  if (!process.env[name]) process.env[name] = value
}

async function main(): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const { loadTradingSettings } = await import('@/lib/trading/settings/store')
  const { getAccessToken } = await import('@/lib/trading/broker/token')
  const { loadAppCredential } = await import('@/lib/trading/broker/credentials')
  const { createKisClient } = await import('@/lib/trading/broker/kis-client')
  const { backfillMinuteBars } = await import('@/lib/trading/backfill/minute-backfill')
  const { kstTodayKey } = await import('@/lib/datetime/kst')

  const args = process.argv.slice(2)
  const flag = (name: string): string | null => {
    const at = args.indexOf(`--${name}`)
    return at >= 0 && at + 1 < args.length ? args[at + 1] : null
  }
  const apply = args.includes('--apply')
  const tradeDate = flag('date') ?? kstTodayKey()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  /** 받을 월물. 안 주면 그날 굳은 값을 따른다 — 수집이 보는 것과 같아야 한다 */
  async function pickCode(): Promise<string | null> {
    const given = flag('code')
    if (given) return given
    const { data: frozen } = await admin
      .from('trading_day_config').select('front_contract_code').eq('trade_date', tradeDate).maybeSingle()
    if (frozen?.front_contract_code) return String(frozen.front_contract_code)
    const { data: front } = await admin
      .from('trading_contracts').select('code').eq('is_front', true).limit(1)
    return (front ?? [])[0]?.code ? String((front ?? [])[0].code) : null
  }

  async function countBars(code: string): Promise<number> {
    const { count } = await admin
      .from('trading_bars').select('*', { count: 'exact', head: true })
      .eq('contract_code', code).eq('tf', '1m')
      .gte('bar_start_at', `${tradeDate}T00:00:00+09:00`)
      .lt('bar_start_at', `${tradeDate}T23:59:59+09:00`)
    return Number(count ?? 0)
  }

  const code = await pickCode()
  if (!code) {
    console.error('받을 월물을 못 정했습니다. 월물 표에 근월물이 없습니다')
    process.exit(1)
  }

  const now = new Date()
  /** 정규장 시작부터 지금까지. 야간 구간은 분봉 창구가 따로라 여기서 안 건드린다 */
  const from = new Date(`${tradeDate}T08:30:00+09:00`)
  const to = now < new Date(`${tradeDate}T15:45:00+09:00`) ? now : new Date(`${tradeDate}T15:45:00+09:00`)

  const before = await countBars(code)
  console.log(`거래일   ${tradeDate}`)
  console.log(`월물     ${code}`)
  console.log(`구간     ${from.toISOString()} ~ ${to.toISOString()}`)
  console.log(`지금 가진 1분봉 ${before}개`)

  if (!apply) {
    console.log('\n--apply 를 안 줬으므로 아무것도 안 받았습니다')
    process.exit(0)
  }

  const { values } = await loadTradingSettings(tradeDate)
  const env = values.kis_env === 'paper' ? 'paper' : 'real'
  const token = await getAccessToken({
    env,
    refreshMarginMinutes: Number(values.kis_token_refresh_margin_minutes) || 30,
    runId: `backfill-${tradeDate}`,
    now,
  })
  if (!token.ok) { console.error('증권사 토큰을 못 받았습니다:', token.reason); process.exit(1) }
  const credential = await loadAppCredential(env)
  if (!credential) { console.error('증권사 자격증명이 없습니다'); process.exit(1) }

  const kis = createKisClient({
    env,
    auth: { accessToken: token.accessToken, appKey: credential.appKey, appSecret: credential.appSecret },
    minIntervalMs: Number(values.kis_min_interval_ms) || 200,
    requestTimeoutMs: 15_000,
  })

  const result = await backfillMinuteBars({ contractCode: code, from, to, kis, now })
  const after = await countBars(code)
  console.log(`\n사유     ${result.reason}`)
  console.log(`받은 봉  ${after - before}개 (${before} -> ${after})`)
  if (result.userMessage) console.log(`할 말    ${result.userMessage}`)
  if (!result.ok) process.exit(1)

}

main().catch((error) => {
  // 조용히 0 으로 끝내지 않는다 — 실패가 성공으로 보이면 아무도 안 본다
  console.error('백필이 실패했습니다:', error instanceof Error ? error.message : error)
  process.exit(1)
})
