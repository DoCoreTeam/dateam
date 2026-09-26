/**
 * 설정을 고치는 길 — **관문을 우회하는 옆문이 안 생기게**
 *
 * **왜** (사용자 지적 2026-09-27: 「설정하는 것 자체가 없네」): 레지스트리에 값이 88개인데
 *   바꾸는 길은 좁은 토글 셋뿐이었다. 나머지 85개는 읽기 전용으로 그려지기만 했다.
 *
 * 길을 내면서 같이 생기는 위험이 하나 있다. 그 88개 중 **관문을 지나야 바뀌는 값**이 섞여
 * 있다는 것이다. `notify_enabled` 는 검증 관문과 섀도 일수를 지나야 켜지는데, 설정 화면에서
 * 그냥 참으로 쓰면 관문은 그대로 서 있고 **옆으로 지나가는 길**만 생긴다.
 * 관문이 있는데 지나갈 수 있으면 관문이 없는 것과 같다.
 *
 * 이 가드가 보는 것은 넷이다.
 *
 * 1. 저장 창구가 **서버 액션**이다 — 이 모듈은 API 라우트를 안 연다
 * 2. 소유자 확인을 지난 뒤에만 저장한다
 * 3. 레지스트리에 없는 키와 **관문이 있는 키**는 저장하지 않는다
 * 4. 저장은 `saveTradingSetting` 을 지난다 — 표에 직접 쓰지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TRADING_APP_DIR } from './app-dirs.ts'
import { CHANGED_ELSEWHERE, editableHere } from '../trading/settings/editable.ts'
import { TRADING_SETTINGS } from '../trading/settings/registry.ts'

const WEB = join(import.meta.dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

const ACTIONS = `${TRADING_APP_DIR}/settings/actions.ts`
const PAGE = `${TRADING_APP_DIR}/settings/page.tsx`
const FORM = `${TRADING_APP_DIR}/settings/SettingsForm.tsx`

test('저장 창구는 서버 액션이다 — 이 모듈은 라우트를 안 연다', () => {
  const src = read(ACTIONS)
  assert.ok(src.startsWith("'use server'"), '서버 액션 파일이 아니다')

  /**
   * 라우트를 열면 소유자 확인이 두 벌이 된다. 게다가 `api-auth-surface` 는
   * `tradingAccess` 를 인증 장치로 모르므로 **열린 창구**로 잡힌다.
   */
  let open = false
  try { readFileSync(join(WEB, 'app/api/trading/settings/route.ts'), 'utf8'); open = true } catch { /* 없으면 정상 */ }
  assert.equal(open, false, '설정용 API 라우트가 생겼다 — 이 모듈은 서버 액션으로만 쓴다')
})

test('소유자 확인을 지난 뒤에만 저장한다', () => {
  const src = read(ACTIONS)
  assert.match(src, /tradingAccess\(\)/, '소유자 확인을 안 부른다')

  const gate = src.indexOf('await tradingAccess()')
  const write = src.indexOf('saveTradingSetting({')
  assert.ok(gate > -1 && write > -1, '확인이나 저장 자리를 못 찾았다')
  assert.ok(gate < write, '소유자 확인이 저장보다 뒤에 있다 — 그 확인은 아무것도 막지 않는다')
})

test('모르는 키와 관문이 있는 키는 저장되지 않는다', () => {
  const src = read(ACTIONS)

  assert.match(src, /tradingSetting\(key\)/, '레지스트리와 대조하지 않는다')
  assert.match(src, /if \(!spec\) return/, '모르는 키를 그대로 저장한다')
  assert.match(src, /editableHere\(key\)/, '관문이 있는 키를 걸러 내지 않는다')

  const check = src.indexOf('editableHere(key)')
  const write = src.indexOf('saveTradingSetting({')
  assert.ok(check > -1 && check < write, '관문 검사가 저장보다 뒤에 있다')

  /**
   * **화면만 막는 것으로는 모자라다.** 입력칸을 잠가도 주소를 아는 사람은
   * 서버 액션을 그대로 부를 수 있다. 그래서 창구에도 같은 검사가 있어야 한다.
   */
  assert.match(read(FORM), /row\.elsewhere !== null/, '화면이 잠긴 값을 안 잠근다')
})

test('저장은 설정 저장기를 지난다 — 표에 직접 쓰지 않는다', () => {
  const src = read(ACTIONS)
  assert.doesNotMatch(
    src,
    /from\(\s*'trading_settings'\s*\)/,
    '설정 표를 직접 다룬다 — 판이 안 쌓여 「그날 무엇으로 판단했나」가 사라진다',
  )
  assert.match(src, /saveTradingSetting\(\{/, '저장이 저장기를 안 지난다')
  assert.match(src, /changedBy: user\.id/, '바꾼 사람이 판에 안 남는다')
  assert.match(src, /reason: '설정 화면에서 변경'/, '어디서 바꿨는지가 판에 안 남는다')
})

test('막은 값 셋이 실제로 관문을 가진 값이다 — 아무거나 막지 않는다', () => {
  const keys = new Set(TRADING_SETTINGS.map((s) => s.key))
  for (const key of Object.keys(CHANGED_ELSEWHERE)) {
    assert.ok(keys.has(key), `${key} 는 레지스트리에 없다`)
    assert.equal(editableHere(key), false)
  }
  // 관문을 가진 값이 목록에서 빠지면 그 길이 다시 열린다
  for (const key of ['notify_enabled', 'night_signal_enabled']) {
    assert.ok(key in CHANGED_ELSEWHERE, `${key} 가 설정 화면에서 그냥 바뀐다 — 관문 옆문이다`)
  }
})

test('설정 화면이 값 전부를 그린다 — 고칠 수 없는 값이 숨지 않는다', () => {
  const page = read(PAGE)
  assert.match(page, /TRADING_SETTINGS\.filter/, '레지스트리에서 줄을 안 만든다')
  assert.match(page, /SettingsForm/, '고치는 칸을 안 그린다')
  assert.match(page, /whyElsewhere/, '못 바꾸는 값의 사유를 화면에 안 넘긴다')

  /** 예전처럼 읽기 전용으로만 그리면 이 화면은 전시로 돌아간다 */
  assert.doesNotMatch(page, /formatTradingSettingValue/, '아직 읽기 전용으로 그린다')
})
