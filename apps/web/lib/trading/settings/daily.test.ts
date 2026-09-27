/**
 * 매일 보는 것 — **꺼내되 숨기지 않는다**
 *
 * 앞으로 꺼낸 값이 원래 묶음에서 사라지면, 「안전 게이트를 다 봤다」고 믿은 사람이
 * 못 본 값이 생긴다. 접힌 묶음도 바꿔 둔 값이 있으면 그 사실을 말해야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DAILY_KEYS, dailySettings, changedCount } from './daily.ts'
import { TRADING_SETTINGS } from './registry.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SETTINGS_DIR = join(HERE, '..', '..', '..', TRADING_APP_DIR, 'settings')

test('★ 매일 보는 키가 전부 등재돼 있다 — 이름을 바꾼 날 빈 자리가 안 되게', () => {
  const missing = DAILY_KEYS.filter((k) => !TRADING_SETTINGS.some((s) => s.key === k))
  assert.deepEqual(missing, [], `등재 안 된 키: ${missing.join(', ')}`)
  assert.equal(dailySettings().length, DAILY_KEYS.length)
})

test('★ 앞으로 꺼낸 값이 원래 묶음에서 안 사라진다', () => {
  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  // 묶음을 만들 때 매일 보는 키를 빼는 코드가 없어야 한다
  assert.equal(/!isDaily|filter\([^)]*isDaily/.test(page), false,
    '묶음에서 매일 보는 값을 빼고 있다 — 다 봤다고 믿은 사람이 못 본 값이 생긴다')
  // 두 목록이 같은 함수로 줄을 만든다. 다르면 같은 값이 두 얼굴이 된다
  assert.ok((page.match(/toRow\(/g) ?? []).length >= 2, '두 목록이 다른 방법으로 줄을 만든다')
})

test('★ 목록이 레지스트리에서 나온다 — 화면이 키를 손으로 안 적는다', () => {
  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  assert.ok(page.includes('dailySettings()'), '화면이 목록을 직접 만든다')
  assert.equal(/'notify_enabled'|'daily_loss_limit_krw'/.test(page), false,
    '화면이 키를 손으로 적었다 — 목록이 두 곳이 된다')
})

test('★ 바꿔 둔 개수를 센다 — 접었다고 사실이 사라지지 않는다', () => {
  const spec = TRADING_SETTINGS.find((s) => s.key === 'signal_max_per_day')
  assert.ok(spec)
  // 기본값과 같으면 0
  assert.equal(changedCount(['signal_max_per_day'], { signal_max_per_day: spec.defaultValue }), 0)
  // 다르면 1
  assert.equal(changedCount(['signal_max_per_day'], { signal_max_per_day: 3 }), 1)
  // 값이 아직 없으면 기본값을 쓰는 것이다. 다른 것이 아니다
  assert.equal(changedCount(['signal_max_per_day'], {}), 0)
  // 등재 안 된 키는 안 센다
  assert.equal(changedCount(['없는키'], { 없는키: 1 }), 0)
})

test('★ 접힌 머리가 바꾼 개수를 그린다', () => {
  const groups = readFileSync(join(SETTINGS_DIR, 'SettingsGroups.tsx'), 'utf8')
  assert.ok(groups.includes('g.changed'), '바꾼 개수를 안 그린다')
  assert.ok(groups.includes('SETTING_CHANGED'), '말을 화면 안에서 짓는다')
  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  assert.ok(page.includes('changed: changedCount('), '개수를 안 넘긴다')
})

test('★ 조수사를 화면이 고르지 않는다 — 용어집이 정한다', () => {
  const groups = readFileSync(join(SETTINGS_DIR, 'SettingsGroups.tsx'), 'utf8')
  assert.ok(groups.includes("count('setting'"), '개수 표기를 화면이 짓는다')
  assert.equal(/\$\{g\.rows\.length\}개/.test(groups), false, '조수사를 화면이 붙였다')
})

test('★ 여덟이 너무 많지 않다 — 앞자리가 길어지면 꺼낸 뜻이 없다', () => {
  assert.ok(DAILY_KEYS.length <= 10, `매일 보는 것이 ${DAILY_KEYS.length}개다`)
  assert.ok(DAILY_KEYS.length >= 5, '너무 적어 앞자리가 빈다')
  assert.equal(new Set(DAILY_KEYS).size, DAILY_KEYS.length, '같은 키가 두 번 있다')
})
