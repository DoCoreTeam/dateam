/**
 * 자동 주문 배선 — **열린 포지션 위험 바로 다음, 곁가지보다 앞**
 *
 * 돈이 걸린 일이 지식·운영자 뒤로 밀리면 안 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wouldDisarm, disarmLeavesOrders } from '../order/disarm-view.ts'
import { TRADING_SETTINGS } from '../settings/registry.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..', '..', '..', TRADING_APP_DIR)
const T0 = new Date('2026-09-25T04:00:00Z')

test('★ 주문이 감시 다음이고 지식·운영자보다 앞이다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const order = ['runWatch(', 'emitOrExplain(', 'orderOrExplain(', 'knowledgeOrExplain(', 'operatorOrExplain(']
  const at = order.map((k) => tick.indexOf(k))
  for (let i = 0; i < at.length; i += 1) assert.ok(at[i] > 0, `${order[i]} 를 안 부른다`)
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i - 1] < at[i], `${order[i]} 가 ${order[i - 1]} 보다 먼저 온다`)
  }
})

test('★ 주문이 실패해도 앞의 일이 산다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const fn = tick.slice(tick.indexOf('async function orderOrExplain'))
  assert.ok(fn.includes('try {') && fn.includes('} catch'))
  assert.ok(fn.includes('order_failed:'))
})

/**
 * **고정값의 존재가 아니라 뜻을 본다.**
 *
 * 처음에는 `fn.includes('acct: null')` 로 봤다. 그때는 크론이 정말 계좌를 안 넘겼고
 * 그 줄이 그 사실이었다. 그런데 이 가드는 **배선하면 반드시 빨개진다** — 계좌를 넘기는
 * 것이 목적인 판에서 「계좌를 안 넘겼나」를 물으니까. 그때 할 일은 가드를 지우는 것이
 * 아니라 원래 지키려던 것을 다시 적는 것이다: **빈 인증이 주문 창구에 닿지 않는다.**
 */
test('★ 빈 인증으로 주문이 나가는 길이 없다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const fn = tick.slice(tick.indexOf('async function orderOrExplain'))
  const code = fn.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  // ① 빈 문자열 인증을 그 자리에서 지어내지 않는다
  assert.doesNotMatch(code, /accessToken:\s*['"]['"]/,
    '빈 접속표를 만들어 넘긴다 — 인증 없이 주문 창구를 두드린다')
  assert.doesNotMatch(code, /appKey:\s*['"]['"]/, '빈 앱키를 만들어 넘긴다')

  // ② 계좌가 없으면 주문 자체를 만들지 않는다
  assert.match(code, /account \? await loadPendingEntry\(/,
    '계좌가 없어도 낼 주문을 찾는다')

  // ③ 그래도 계좌가 null 로 닿으면 주문 일이 첫 줄에서 돌려보낸다
  const job = readFileSync(join(HERE, 'order-job.ts'), 'utf8')
  assert.ok(job.includes("if (!input.acct) return { reason: 'order=no_account'"),
    '계좌가 없어도 진행한다')

  // ④ 무장 확인이 계좌 확인 **다음**이다. 순서가 바뀌면 무장만으로 주문을 시도한다
  const run = job.slice(job.indexOf('export async function runOrderJob'))
  assert.ok(run.indexOf('!input.acct') < run.indexOf('armedNow('),
    '계좌를 보기 전에 무장을 본다')
})

test('★ 순서가 규칙이다 — 무장 → 멈추는 장치 → 모르는 주문 → 청산 → 진입', () => {
  const src = readFileSync(join(HERE, 'order-job.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function runOrderJob'))
  const armedAt = fn.indexOf('armedNow(')
  const guardAt = fn.indexOf('enforceDisarm(')
  const unknownAt = fn.indexOf('unknownOrders(')
  const exitAt = fn.indexOf('shouldExit(')
  const entryAt = fn.indexOf("orderKind: 'entry'")
  for (const [n, v] of [['armed', armedAt], ['guard', guardAt], ['unknown', unknownAt], ['exit', exitAt], ['entry', entryAt]]) {
    assert.ok((v as number) > 0, `${n} 이 없다`)
  }
  assert.ok(armedAt < guardAt, '무장 확인보다 멈추는 장치를 먼저 본다')
  assert.ok(guardAt < unknownAt, '멈추는 장치보다 모르는 주문을 먼저 본다')
  assert.ok(unknownAt < exitAt, '모르는 주문을 확인하기 전에 청산한다')
  assert.ok(exitAt < entryAt, '청산보다 진입을 먼저 낸다 — 들고 있는 것이 급하다')
})

test('★ 모르는 주문이 있으면 새로 안 낸다', () => {
  const src = readFileSync(join(HERE, 'order-job.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function runOrderJob'))
  assert.ok(fn.includes('resolved_unknown:'), '확인만 하고 사유를 안 남긴다')
  const returnAt = fn.indexOf('resolved_unknown:')
  const exitAt = fn.indexOf('shouldExit(')
  assert.ok(returnAt < exitAt, '모르는 주문이 있는데 새 주문을 낸다')
})

test('★ 청산은 들고 있는 것의 반대로 낸다 — 같은 방향이면 두 배가 된다', () => {
  const src = readFileSync(join(HERE, 'order-job.ts'), 'utf8')
  assert.ok(src.includes("direction: input.openPosition.direction === 'long' ? 'short' : 'long'"),
    '청산을 같은 방향으로 낸다')
})

test('★ 진입과 청산을 나눠 켤 수 없다', () => {
  const src = readFileSync(join(HERE, 'order-job.ts'), 'utf8')
  assert.ok(src.includes('entryAndExitArmTogether()'), '나눌 수 있는지 안 묻는다')
  assert.ok(src.includes("reason: 'order=entry_exit_split'"), '나뉘어 있어도 그냥 돈다')
})

test('★ 화면이 무장을 안 푼다 — 묻기만 한다', () => {
  assert.equal(wouldDisarm({
    expiresAt: new Date(T0.getTime() + 1000), now: T0,
    ordersToday: 0, maxOrdersPerDay: 12,
    orderFailureStreak: 0, maxOrderFailureStreak: 3,
    reconciliationRequired: false, protectionBreached: false,
  }), false)
  assert.equal(wouldDisarm({
    expiresAt: T0, now: T0,
    ordersToday: 0, maxOrdersPerDay: 12,
    orderFailureStreak: 0, maxOrderFailureStreak: 3,
    reconciliationRequired: false, protectionBreached: false,
  }), true)
  // 묻는 파일과 푸는 파일을 갈라 뒀다. 화면이 여는 것만으로 풀리면 안 된다
  const view = readFileSync(join(HERE, '..', 'order', 'disarm-view.ts'), 'utf8')
  assert.equal(/await disarm\(|enforceDisarm|createAdminClient/.test(view), false,
    '묻기만 해야 하는 파일이 푼다')
  assert.equal(view.includes("import 'server-only'"), false, 'server-only 라 화면이 못 쓴다')
})

test('★ 해제가 주문을 남긴다는 사실을 화면이 말한다', () => {
  assert.equal(disarmLeavesOrders(), true)
  const src = readFileSync(join(APP, 'ArmingPanel.tsx'), 'utf8')
  assert.ok(src.includes('arming.disarmLeavesOrders'), '화면이 안 말한다')
  assert.ok(src.includes('해제해도 이미 낸 주문은 남습니다'))
})

test('★ 화면이 무장 만료와 막는 것을 말한다', () => {
  const src = readFileSync(join(APP, 'ArmingPanel.tsx'), 'utf8')
  assert.ok(src.includes('스스로 풀립니다'), '언제 풀리는지를 안 말한다')
  assert.ok(src.includes('arming.blockedBy'), '무엇이 막는지를 안 말한다')
  assert.ok(src.includes('arming.willDisarm'), '곧 풀린다는 것을 안 말한다')
  assert.ok(src.includes('arming.unknownOrders'), '확인 못 한 주문을 안 말한다')
})

test('★ 해제 단추는 관문과 무관하게 눌린다', () => {
  const src = readFileSync(join(APP, 'ArmingPanel.tsx'), 'utf8')
  const off = src.slice(src.indexOf('해제') - 400, src.indexOf('해제'))
  assert.equal(/canArm/.test(off), false, '해제 단추가 관문을 본다')
})

test('★ 무장 창구가 소유자 확인을 지나고 사람 ID 를 넘긴다', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function setAutoOrderArmed'))
  assert.ok(fn.includes('tradingAccess()'))
  assert.ok(fn.includes('actorUserId: user.id'), '사람 ID 를 안 넘긴다')
  const gateAt = fn.indexOf('tradingAccess()')
  const armAt = fn.indexOf('await arm(')
  assert.ok(gateAt < armAt, '확인보다 먼저 무장한다')
})

test('★ 모의 일수를 0 으로 넘긴다 — 한 번도 안 돌려 봤다는 것이 정확한 상태다', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function setAutoOrderArmed'))
  assert.ok(fn.includes('paperAutoDays: 0'), '안 센 값을 0 이 아닌 무언가로 넘긴다')
})

test('★ 새 창구를 안 엶 — 서버 액션뿐', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  assert.ok(src.startsWith("'use server'"))
})

test('★ 문턱이 설정에서 온다', () => {
  for (const key of ['order_max_per_day', 'order_max_failure_streak', 'order_required_paper_days', 'order_arm_hours']) {
    assert.ok(TRADING_SETTINGS.some((s) => s.key === key), `${key} 설정이 없다`)
  }
  // 무장 자체는 설정이 아니다 — 상태다
  assert.equal(TRADING_SETTINGS.some((s) => /arm(ed)?_enabled|auto_order_enabled/.test(s.key)), false,
    '무장이 설정으로 있다 — 화면에서 스무 개 값 중 하나로 보인다')
})
