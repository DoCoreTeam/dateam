/**
 * 설정 도우미 — **원래 설명을 안 덮는다**
 *
 * 도우미가 원래 설명을 덮으면 AI 가 죽은 날 화면이 빈다.
 * 그리고 화면이 빈 설정을 사람이 만진다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_HELP_LENGTH, TRUNCATION_MARK, BANNED_PHRASES,
  settingFactLines, buildSettingHelpPrompt, checkHelp, normalizeHelp, composeHelp,
} from './setting-help.ts'
import { TRADING_SETTINGS, tradingSetting } from '../settings/registry.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const KEY = 'signal_max_per_day'

test('★ 도우미가 없어도 원래 설명이 있다', () => {
  const v = composeHelp(KEY, null)
  assert.ok(!('reason' in v))
  assert.equal(v.extra, null)
  assert.equal(v.original, tradingSetting(KEY)?.help)
  assert.ok(v.original.length > 0)
})

test('★ 도우미가 있어도 원래 설명이 그대로 남는다 — 덮지 않는다', () => {
  const v = composeHelp(KEY, 'AI 가 쓴 말')
  assert.ok(!('reason' in v))
  assert.equal(v.original, tradingSetting(KEY)?.help)
  assert.equal(v.extra, 'AI 가 쓴 말')
})

test('모르는 키는 거절한다', () => {
  const v = composeHelp('nope', 'x')
  assert.ok('reason' in v && v.reason === 'unknown_key')
})

// ── 범위를 지어내지 않는다 ────────────────────────────────

test('★ 범위와 근거를 레지스트리에서 끌어온다 — AI 가 지어내면 화면에 두 숫자가 뜬다', () => {
  const spec = tradingSetting(KEY)
  assert.ok(spec)
  const lines = settingFactLines(spec)
  assert.ok(lines.some((l) => l.startsWith('범위:')))
  assert.ok(lines.some((l) => l.includes(String(spec.min))))
  assert.ok(lines.some((l) => l.includes(String(spec.max))))
  assert.ok(lines.some((l) => l.startsWith('근거:') && l.includes(spec.source)))
  assert.ok(lines.some((l) => l.includes(spec.help)), '우리 설명을 안 넘긴다')
})

test('범위가 없는 설정은 「정해진 것 없음」이라 적는다 — 빈칸으로 두면 AI 가 채운다', () => {
  const noRange = TRADING_SETTINGS.find((s) => s.min === undefined && s.max === undefined)
  assert.ok(noRange, '범위 없는 설정이 하나도 없다. 이 시험이 아무것도 안 지킨다')
  assert.ok(settingFactLines(noRange).includes('범위: 정해진 것 없음'))
})

test('프롬프트가 지어내기와 값 권하기를 막는다', () => {
  const spec = tradingSetting(KEY)
  assert.ok(spec)
  const p = buildSettingHelpPrompt(spec)
  assert.ok(p.includes('있는 것만'))
  assert.ok(p.includes('범위나 기본값을 지어내지 않는다'))
  assert.ok(p.includes('값을 얼마로 하라고 말하지 않는다'))
})

// ── 값을 권하지 않는다 ───────────────────────────────────

test('★ 값을 권하는 말이 있으면 안 싣는다 — 값 제안은 스펙 후보의 일이다', () => {
  for (const bad of ['6으로 두세요', '10을 추천합니다', '조금 올리세요', '권장 값은 3입니다']) {
    const r = checkHelp(bad)
    assert.ok(r, `「${bad}」 가 통과했다`)
    assert.match(r.reason, /^banned_phrase:/)
  }
  assert.equal(checkHelp('하루에 몇 건까지 신호를 낼지 정합니다. 낮추면 신호가 줄어듭니다.'), null)
})

test('금지어 목록이 비어 있지 않다', () => {
  assert.ok(BANNED_PHRASES.length >= 6)
  assert.equal(checkHelp('  ')?.reason, 'empty')
})

test('긴 설명은 정확히 상한까지 자르고 표시를 남긴다', () => {
  const long = normalizeHelp('가'.repeat(MAX_HELP_LENGTH + 100))
  assert.equal(long.length, MAX_HELP_LENGTH)
  assert.ok(long.endsWith(TRUNCATION_MARK))
})

// ── 값을 못 바꾼다 ───────────────────────────────────────

test('★ 도우미가 설정을 쓰는 길이 0개다', () => {
  const src = readFileSync(join(HERE, 'setting-help.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const banned of ['saveTradingSetting', 'trading_settings', 'createAdminClient', '.insert(', '.update(']) {
    assert.equal(src.includes(banned), false, `도우미가 ${banned} 에 닿는다 — 설명하는 자리가 고치는 자리가 된다`)
  }
})

test('★ 도우미가 읽기만 한다 — 순수 모듈이라 server-only 도 아니다', () => {
  const src = readFileSync(join(HERE, 'setting-help.ts'), 'utf8')
  assert.equal(src.includes("import 'server-only'"), false,
    'server-only 가 붙었다 — 쓰는 일이 생겼다는 뜻이다')
})
