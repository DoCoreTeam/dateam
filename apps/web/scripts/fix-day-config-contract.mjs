// 굳은 월물 바로잡기 — trading_day_config.front_contract_code 를 월물 표의 근월물에 맞춘다
//
// ## 왜 이 자리가 필요한가 (실측 2026-10-02)
//
// 수집 크론은 거래일이 시작할 때 그날 쓸 월물을 `trading_day_config` 에 **굳힌다.**
// 굳은 값은 일부러 안 덮는다 — 장중 배포가 그날 기준을 조용히 갈아치우면 안 되기 때문이다.
//
// 그런데 굳히기 직전의 교체 판정이 틀리면, 그 하루는 통째로 틀린 월물로 돈다.
// 2026-10-02 에 실제로 그랬다. 만기가 엿새 남은 10월물(A05610) 대신 11월물(A05611)이 굳었고,
// 11월물은 거래가 듬성해 분봉이 빠지는 분이 많아 수집이 매분 `bar_missing` 을 적었다.
// **그날 확정 봉이 0건이고 판단도 0건이다.**
//
// 판정 자체는 `lib/trading/contracts/roll.ts` 에서 고쳤다(어제 거래량을 본다).
// 다만 **이미 굳은 오늘 값은 그 고침이 안 건드린다** — 굳은 값을 안 덮는 것이 설계이기 때문이다.
// 그래서 사람이 한 번 바로잡는 자리를 둔다.
//
// ## 규율 셋
//
// 1 **기본은 안 쓴다.** `--apply` 가 없으면 무엇을 무엇으로 바꾸려는지만 찍는다
// 2 **되돌리는 명령을 같이 찍는다.** 바꾼 값과 되돌릴 값이 둘 다 보여야 한다
// 3 **월물 표가 근거다.** 바깥에서 받은 코드를 그대로 쓰지 않고 `trading_contracts.is_front` 를 읽는다
//
// 실행: node scripts/fix-day-config-contract.mjs            (무엇을 바꿀지만 본다)
//       node scripts/fix-day-config-contract.mjs --apply    (실제로 바꾼다)
//       node scripts/fix-day-config-contract.mjs --apply --code A05610 --date 2026-10-02

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null
}
const apply = args.includes('--apply')

/** 서울 기준 오늘 (`YYYY-MM-DD`) */
function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

const tradeDate = flag('date') ?? seoulToday()

const { data: frozen, error: frozenErr } = await supa
  .from('trading_day_config')
  .select('trade_date, front_contract_code, frozen_at')
  .eq('trade_date', tradeDate)
  .maybeSingle()
if (frozenErr) { console.error('굳은 값을 못 읽었습니다:', frozenErr.message); process.exit(1) }
if (!frozen) { console.log(`${tradeDate} 에 굳은 값이 없습니다. 바로잡을 것이 없습니다`); process.exit(0) }

const { data: contracts, error: contractErr } = await supa
  .from('trading_contracts')
  .select('code, is_front, last_trading_day')
  .order('last_trading_day', { ascending: true })
if (contractErr) { console.error('월물 표를 못 읽었습니다:', contractErr.message); process.exit(1) }

const front = (contracts ?? []).find((c) => c.is_front)
// 사람이 코드를 직접 줄 수 있지만, 그 코드도 월물 표에 있어야 한다 — 없는 월물로는 봉이 안 온다
const wantedCode = flag('code') ?? front?.code ?? null
if (!wantedCode) { console.error('월물 표에 근월물이 없습니다. 수집이 한 번은 돌아야 합니다'); process.exit(1) }
const wanted = (contracts ?? []).find((c) => c.code === wantedCode)
if (!wanted) {
  console.error(`${wantedCode} 는 월물 표에 없습니다. 표에 있는 것만 고를 수 있습니다`)
  console.error('표:', (contracts ?? []).map((c) => `${c.code}(만기 ${c.last_trading_day})`).join(' '))
  process.exit(1)
}

const before = frozen.front_contract_code
console.log(`거래일        ${tradeDate}`)
console.log(`굳은 시각      ${frozen.frozen_at}`)
console.log(`지금 굳은 월물  ${before}${(contracts ?? []).find((c) => c.code === before)?.last_trading_day ? ` (만기 ${(contracts ?? []).find((c) => c.code === before).last_trading_day})` : ''}`)
console.log(`월물 표의 근월물 ${front?.code ?? '없음'}${front ? ` (만기 ${front.last_trading_day})` : ''}`)
console.log(`바꿀 값        ${wanted.code} (만기 ${wanted.last_trading_day})`)

if (before === wanted.code) {
  console.log('\n이미 같습니다. 바꿀 것이 없습니다')
  process.exit(0)
}

console.log(`\n되돌리는 명령  node scripts/fix-day-config-contract.mjs --apply --date ${tradeDate} --code ${before}`)

if (!apply) {
  console.log('\n--apply 를 안 줬으므로 아무것도 안 바꿨습니다')
  process.exit(0)
}

const { error: updateErr } = await supa
  .from('trading_day_config')
  .update({ front_contract_code: wanted.code })
  .eq('trade_date', tradeDate)
if (updateErr) { console.error('못 바꿨습니다:', updateErr.message); process.exit(1) }

const { data: after } = await supa
  .from('trading_day_config')
  .select('front_contract_code')
  .eq('trade_date', tradeDate)
  .maybeSingle()
console.log(`\n바꿨습니다 ${before} -> ${after?.front_contract_code}`)
if (after?.front_contract_code !== wanted.code) {
  console.error('쓴 값이 돌아온 값과 다릅니다. 직접 확인하세요')
  process.exit(1)
}
