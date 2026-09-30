import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 내가 적는 진입 기록 — **주문은 안 나가고, 남의 줄은 안 보인다**
 *
 * 사용자 지시 2026-09-30: 「들어갔으면 체크하게 해줘 얼마에 들어갔는지 확인하고 말이야
 * (…) 직접 매매는 안해도 데이터는 받을수있으니」.
 *
 * 「직접 매매는 안 한다」는 이 기능의 전제다. 나중에 누가 이 창구에 주문 한 줄을 붙이면
 * 화면은 그대로인 채 실제 돈이 나간다 — 그것이 이 가드가 막는 일이다.
 *
 * 그리고 새 표를 만들었으므로(마이그 295) RLS 와 권한을 이 판에서 잠근다(S1).
 */
const ACTIONS = new URL('../../app/(trading)/trading/actions.ts', import.meta.url)
const STORE = new URL('../trading/position/manual-entry-store.ts', import.meta.url)
const MIGRATION = new URL('../../../../supabase/migrations/295_trading_manual_entry.sql', import.meta.url)

const read = (u: URL): string => readFileSync(u, 'utf8')

/** 주석은 통과시키지 않는다 — 규칙을 적은 글이 가드를 속이면 안 된다 */
function drawnOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('적기 전에 소유자 확인을 지난다 — 확인이 뒤에 있으면 아무것도 안 막는다', () => {
  const src = drawnOnly(read(ACTIONS))
  for (const [fn, write] of [
    ['markEntered', 'insertManualEntry('],
    ['markExited', 'closeManualEntry('],
  ] as const) {
    const at = src.indexOf(`export async function ${fn}`)
    assert.ok(at > 0, `${fn} 가 없다`)
    /*
      **다음 선언까지가 몸통이다.** `\n}` 로 자르면 안쪽 블록에서 일찍 끊겨,
      뒤에 있는 확인이나 쓰기를 못 본 채 통과하거나 실패한다
    */
    const nextAt = src.indexOf('\nexport ', at + 1)
    const body = src.slice(at, nextAt > 0 ? nextAt : src.length)
    const gate = body.indexOf('await tradingAccess()')
    const to = body.indexOf(write)
    assert.ok(gate > -1, `${fn} 이 소유자 확인을 안 부른다`)
    assert.ok(to > -1, `${fn} 이 쓰는 자리를 못 찾았다`)
    assert.ok(gate < to, `${fn} 의 소유자 확인이 쓰기보다 뒤에 있다`)
    // 누가 적었는지를 안 걸면 남의 줄을 건드린다
    assert.match(body, /getRequestUser\(\)/, `${fn} 이 누구인지 안 본다`)
  }
})

test('이 창구에서는 주문이 안 나간다 — 사용자가 못 박은 전제다', () => {
  const src = drawnOnly(read(ACTIONS))
  const at = src.indexOf('export async function markEntered')
  assert.ok(at > 0, 'markEntered 가 없다')
  const body = src.slice(at)
  for (const forbidden of ['placeOrder', 'sendOrder', 'submitOrder', 'arm(', 'kisRequest']) {
    assert.equal(body.includes(forbidden), false, `진입 기록 창구가 ${forbidden} 을 부른다 — 주문이 나간다`)
  }
})

test('저장 모듈의 모든 질의가 내 줄로 좁혀진다', () => {
  const src = drawnOnly(read(STORE))
  // 서비스롤은 RLS 를 통째로 지나간다. 그 위에 user_id 조건이 없으면 표 전체가 열린다
  assert.match(src, /import 'server-only'/, '서비스롤을 다루는데 server-only 가 없다')
  const queries = src.split('.from(\'trading_manual_entries\')').slice(1)
  assert.ok(queries.length >= 3, `질의를 ${queries.length}개만 찾았다`)
  for (const q of queries) {
    // 질의 하나가 끝나는 곳까지만 본다 — 다음 질의의 조건을 빌려 오면 안 된다
    const head = q.split('export ')[0]
    /*
      읽기와 고치기는 `.eq('user_id', …)` 로 좁히고, 넣기는 그 값을 **심는다**.
      둘 다 「누구 것인지」를 거는 것이라 어느 쪽이든 하나는 있어야 한다.
    */
    const bound = /\.eq\('user_id'/.test(head) || /user_id:\s*input\.userId/.test(head)
    assert.ok(bound, `user_id 를 안 건 질의가 있다: ${head.slice(0, 80)}`)
  }
})

test('표는 만든 판에서 잠긴다 — anon 도 authenticated 도 못 건드린다 (S1)', () => {
  const sql = read(MIGRATION)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/, 'RLS 를 안 켠다')
  assert.match(sql, /FORCE\s+ROW LEVEL SECURITY/, 'RLS 를 강제하지 않는다')
  for (const who of ['anon', 'authenticated', 'PUBLIC']) {
    assert.ok(
      new RegExp(`REVOKE ALL ON public\\.trading_manual_entries FROM ${who}`).test(sql),
      `${who} 권한을 안 거둔다`,
    )
  }
  // TO public 정책은 RLS 를 켠 채로 다 열어 주는 것과 같다
  assert.equal(/TO public/i.test(sql), false, 'TO public 정책을 쓴다')
  // 사본은 원본 잠금을 안 물려받는다
  assert.equal(/CREATE TABLE .* AS/i.test(sql), false, '사본을 만든다')
})

test('값 검증이 서버에 있다 — 화면이 막아도 창구는 열려 있다 (S4)', () => {
  const src = drawnOnly(read(ACTIONS))
  assert.match(src, /checkEntry\(input\)/, '들어온 값을 서버가 안 본다')
  assert.match(src, /if \(!checked\.ok\) return/, '검증 결과를 안 쓴다')
})
