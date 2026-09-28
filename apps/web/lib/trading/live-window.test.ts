/**
 * 가드 — **닫힌 장을 밤새 두드리지 않는다, 그리고 멈췄다고 말한다**
 *
 * 실측 2026-09-28 오후 7시42분: 정규장은 15:45 에 끝났고 마지막 봉은 15:35 인데
 * 화면이 「27초 뒤 다시 읽습니다」를 계속 세고 있었다. 사람은 뭔가 오고 있다고 읽고,
 * 서버는 아무도 안 보는 화면을 위해 밤새 돈다.
 *
 * 멈추기만 하고 말을 안 하면 죽은 화면과 구별되지 않으므로, 멈춤과 그 이유를 함께 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveWindowAt, CLOSED_REASON_LABEL, nextOpenLine } from './live-window.ts'
import { TRADING_APP_DIR } from '../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const at = (s: string) => new Date(`${s}+09:00`)

test('★ 정규장이 끝나고 야간장 전인 빈 구간에는 멈춘다', () => {
  /*
    처음에 「오후 7시42분에 계속 읽더라」를 고장으로 적었는데 **틀린 전제였다** —
    19:42 는 야간장(18:00~06:00)이 열려 있는 시각이라 다시 읽는 것이 맞다.
    진짜 빈 구간은 정규장이 끝난 15:45 부터 야간장이 여는 18:00 까지다.
  */
  const w = liveWindowAt(at('2026-09-28T16:30:00'))
  assert.equal(w.live, false, '장이 끝났는데 계속 읽는다')
  assert.equal(w.reason, 'after_close')
  assert.equal(w.nextOpenAt, '18:00', '언제 다시 여는지 안 말한다 — 멈춘 화면과 죽은 화면이 같아 보인다')

  // 야간장이 열려 있으면 저녁이라도 읽는다
  assert.equal(liveWindowAt(at('2026-09-28T19:42:00')).live, true, '야간장이 열렸는데 멈춘다')
})

test('★ 장중에는 읽는다 — 멈추는 조건이 너무 넓으면 실시간이 죽는다', () => {
  for (const s of ['2026-09-28T09:00:00', '2026-09-28T13:30:00', '2026-09-28T15:34:00']) {
    assert.equal(liveWindowAt(at(s)).live, true, s)
  }
  // 개장 전 단일가부터 값이 움직인다
  assert.equal(liveWindowAt(at('2026-09-28T08:31:00')).live, true, '개장 단일가')
  // 야간장도 장이다 — 정규장만 보면 밤 8시에 봉이 오는데 화면이 멈춘다
  assert.equal(liveWindowAt(at('2026-09-28T20:00:00')).live, true, '야간장')
  assert.equal(liveWindowAt(at('2026-09-29T02:00:00')).live, true, '자정 넘긴 야간장')
})

test('★ 자정을 넘는 야간장을 한 줄로 자르지 않는다', () => {
  // 「18시보다 크고 6시보다 작다」로 쓰면 하루도 안 맞는다
  assert.equal(liveWindowAt(at('2026-09-29T05:59:00')).live, true, '야간장 끝 직전')
  const justAfter = liveWindowAt(at('2026-09-29T06:01:00'))
  assert.equal(justAfter.live, false, '야간장이 끝났는데 계속 읽는다')
  assert.equal(justAfter.reason, 'before_open')
})

test('★ 토요일 새벽은 금요일 밤 장이 이어지는 중이다', () => {
  // 요일만 보고 자르면 살아 있는 장에서 화면이 멈춘다
  assert.equal(liveWindowAt(at('2026-10-03T02:00:00')).live, true, '토요일 새벽')
  const satDay = liveWindowAt(at('2026-10-03T13:00:00'))
  assert.equal(satDay.live, false, '토요일 낮')
  assert.equal(satDay.reason, 'weekend')
  assert.equal(liveWindowAt(at('2026-10-04T13:00:00')).reason, 'weekend', '일요일 낮')
})

test('멈춘 이유마다 다른 말을 한다', () => {
  const said = new Set(Object.values(CLOSED_REASON_LABEL))
  assert.equal(said.size, 3, '이유가 셋인데 말이 셋이 아니다')
  for (const line of said) assert.match(line, /다시 읽지 않습니다/, `무엇이 멈췄는지 안 말한다: ${line}`)
  assert.match(nextOpenLine('18:00'), /18:00/)
})

test('★ 화면이 그 판정을 실제로 쓴다 — 만들어만 두지 않는다', () => {
  const src = readFileSync(join(HERE, '..', '..', TRADING_APP_DIR, 'LiveRefresh.tsx'), 'utf8')
  assert.ok(src.includes('liveWindowAt('), '판정을 안 부른다 — 여전히 밤새 두드린다')
  assert.ok(src.includes('CLOSED_REASON_LABEL'), '멈췄다는 사실을 화면에 안 적는다')
  /*
    타이머를 거는 자리에서 살아 있는지 봐야 한다. 그리기만 하고 타이머를 그대로 두면
    화면은 「멈췄습니다」라고 적으면서 뒤에서 계속 읽는다 — 가장 나쁜 판이다.
  */
  assert.ok(/if\s*\(!?\s*live/.test(src) || src.includes('if (!live)'),
    '멈춘다고 적어 놓고 타이머는 안 끈다')
})
