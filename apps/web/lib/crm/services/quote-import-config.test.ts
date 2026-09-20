/**
 * 견적서 파일 읽기 설정 가드
 *
 * **여기서 틀리면 견적서가 조용히 0 건으로 읽힌다.** 상한 칸에 0 이 들어간 채
 * 그 값을 그대로 쓰면 그날부터 모든 파일이 「항목을 못 찾았어요」가 되고,
 * 사용자는 설정을 건드린 것과 그 화면을 잇지 못한다.
 *
 * DB 를 안 쓴다 — 푸는 함수가 순수해야 운영 데이터 없이 이 경우들을 밟을 수 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  toQuoteImportConfig, parseLimit, parseToggle, parsePrintComponents,
  QUOTE_IMPORT_FALLBACK, QUOTE_IMPORT_CEILING,
} from './quote-import-config.ts'
import { QUOTE_IMPORT_SETTING_KEY } from '../../terms/quote.ts'
import { MAX_SOURCE_CHARS } from './quote-source-text.ts'
import { MAX_DOC_LINES } from '../ai/schemas/quote-from-doc.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')

/* ── 기본값 ─────────────────────────────────────── */

test('★ 설정이 하나도 없으면 기본값 다섯이 그대로 나온다 — 설정 전에도 시스템은 돈다', () => {
  assert.deepEqual(toQuoteImportConfig({}), QUOTE_IMPORT_FALLBACK)
  // 「빈 객체면 빈 값」 만 보면 서명이 틀려도 초록이다 — 실제 값이 들어 있는지도 본다
  assert.equal(QUOTE_IMPORT_FALLBACK.maxComponentLines, 40)
  assert.equal(QUOTE_IMPORT_FALLBACK.snapshot, true)
  assert.equal(QUOTE_IMPORT_FALLBACK.printComponents, 'expand')
})

test('★ 기본값은 이미 있던 상수를 가리킨다 — 숫자를 또 적으면 두 곳이 갈린다', () => {
  assert.equal(QUOTE_IMPORT_FALLBACK.maxChars, MAX_SOURCE_CHARS)
  assert.equal(QUOTE_IMPORT_FALLBACK.maxLines, MAX_DOC_LINES)
})

/* ── 망가진 값 ───────────────────────────────────── */

test('★ 0 을 넣으면 기본값으로 떨어진다 — 0 을 그대로 쓰면 그날부터 항목 0 건이다', () => {
  const c = toQuoteImportConfig({ [QUOTE_IMPORT_SETTING_KEY.maxLines]: '0' })
  assert.equal(c.maxLines, QUOTE_IMPORT_FALLBACK.maxLines)
})

test('글자·빈 값·음수도 기본값이다', () => {
  assert.equal(parseLimit('많이', 40, 200), 40)
  assert.equal(parseLimit('', 40, 200), 40)
  assert.equal(parseLimit('-5', 40, 200), 40)
  assert.equal(parseLimit(null, 40, 200), 40)
})

test('★ 위쪽 상한을 넘으면 상한까지만 — 사람이 실수해도 시스템이 버틴다', () => {
  const c = toQuoteImportConfig({ [QUOTE_IMPORT_SETTING_KEY.maxChars]: '9999999' })
  assert.equal(c.maxChars, QUOTE_IMPORT_CEILING.maxChars)
})

test('쉼표와 소수가 섞여도 정수로 읽는다 — 사람은 「12,000」 이라고 쓴다', () => {
  assert.equal(parseLimit('12,000', 100, 99_999), 12_000)
  assert.equal(parseLimit('40.7', 10, 200), 40)
})

/* ── 켜고 끄기 ───────────────────────────────────── */

test('★ 조각 만들기를 끄면 꺼진다', () => {
  const c = toQuoteImportConfig({ [QUOTE_IMPORT_SETTING_KEY.snapshot]: 'off' })
  assert.equal(c.snapshot, false)
})

test('모르는 값은 기본값이다 — 설정이 망가져도 읽기는 멈추지 않는다', () => {
  assert.equal(parseToggle('아마도', true), false, '「on」이 아니면 끈 것이다')
  assert.equal(parseToggle('', true), true, '빈 값은 아직 안 고른 것이다')
  assert.equal(parsePrintComponents('접기', 'expand'), 'expand')
  assert.equal(parsePrintComponents('collapse', 'expand'), 'collapse')
})

/* ── 화면 배선 ───────────────────────────────────── */

/*
  **왜 여기서 화면까지 보나**: 설정을 만들어 두고 화면에 안 걸면 사용자에게는
  없는 기능이다. 실제로 이 저장소에서 「표와 설정만 만들고 소비 코드 0」이
  여러 번 나왔다. 카드가 실제로 서는지는 세 파일이 같은 이름을 쓰는지로만 확인된다.
*/
test('★ 새 카드가 묶음·카드 목록·화면 셋에 같은 이름으로 있다 — 하나만 빠져도 화면에 안 뜬다', () => {
  const group = read('lib/crm/domain/setting-group.ts')
  const tab = read('lib/crm/domain/settings-tab.ts')
  const page = read('app/(crm)/crm/settings/page.tsx')

  assert.match(group, /quoteImport: \{/, '묶음에 quoteImport 가 없다')
  assert.match(group, /SETTING_GROUP_ORDER[^\n]*quoteImport/, '묶음 차례에 안 들어갔다')
  assert.match(tab, /id: 'SettingsCard\.quoteImport'/, '카드 목록에 없다')
  assert.match(page, /'SettingsCard\.quoteImport':\s*<SettingsCard group="quoteImport"/, '화면이 그 카드를 안 그린다')
})

test('★ 설정 다섯이 전부 등록돼 있고 읽는 쪽과 같은 키를 쓴다', () => {
  const setting = read('lib/crm/services/setting.ts')
  const defs = setting.slice(
    setting.indexOf('export const SETTING_DEFS'),
    setting.indexOf('export const PLANNED_SETTINGS'),
  )
  for (const [name, key] of Object.entries(QUOTE_IMPORT_SETTING_KEY)) {
    assert.ok(defs.includes(`QUOTE_IMPORT_SETTING_KEY.${name}`),
      `${key} 가 설정 화면에 안 뜬다`)
  }
  assert.equal(Object.keys(QUOTE_IMPORT_SETTING_KEY).length, 5)
})

test('★ 설정 기본값을 숫자로 다시 적지 않는다 — 화면이 말하는 기본값과 도는 값이 갈린다', () => {
  const setting = read('lib/crm/services/setting.ts')
  const defs = setting.slice(
    setting.indexOf('QUOTE_IMPORT_SETTING_KEY.maxComponentLines'),
    setting.indexOf('] as const'),
  )
  assert.ok(!/fallback:\s*'?\d/.test(defs),
    '읽기 설정 fallback 에 숫자를 직접 적었다 — QUOTE_IMPORT_FALLBACK 을 가리켜야 한다')
})
