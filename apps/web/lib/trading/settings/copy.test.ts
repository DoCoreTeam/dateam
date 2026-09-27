/**
 * 설정 화면의 말 — **문서 문체를 화면에 쓰지 않는다**
 *
 * ## 왜 가드인가
 *
 * 규정은 이미 있었다. `.claude/heavy/CEO.md` §0-2 는 「화면에 한글 문자열을 직접 적지
 * 않는다」고 적고, LOOP.md 6절의 개조식·마침표 없음은 **마크다운 산출물** 규정이다.
 * 그런데 설정 92개가 그 문서 문체로 쓰여 있었고 라벨 24개에는 내부 코드명이 그대로 박혀
 * 있었다. 사용자가 읽고 「이게 무슨말이야」라고 물었다 (2026-09-27).
 *
 * 규칙을 글로만 두면 안 지켜진다는 증거가 이 저장소에 이미 여러 번 있다.
 * 그래서 센다.
 *
 * ## 무엇을 세나
 *
 *   ① 라벨에 내부 코드명이 없다 — 사람은 `SR-01` 을 모른다
 *   ② 도움말이 존댓말이다 — 「…한다」는 우리끼리 쓰는 말이다
 *   ③ 도움말에 개발 기록이 없다 — 날짜와 실측은 화면이 아니라 커밋에 남긴다
 *   ④ 도움말이 짧다 — 한 줄에 두 문장을 넘기면 아무도 안 읽는다
 *   ⑤ 금지어가 없다 — 용어집이 정한 말을 쓴다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRADING_SETTINGS } from './registry.ts'
import { BANNED_TERMS } from '../../terms/action.ts'

/** 사람이 모르는 말. 화면 이름에 못 쓴다 */
const INTERNAL = [
  /\bJev\b/i, /\bSR-\d/, /\bSG-\d/, /\bCK-\d/, /\bATR\b/, /\bVWAP\b/,
  /\b1-[ABC]\b/, /\brule\b/, /\bKIS\b/, /\bcron\b/i, /\bRLS\b/,
]

test('★ 설정 이름에 내부 코드명이 없다 — 사람은 SR-01 을 모른다', () => {
  const bad = TRADING_SETTINGS
    .filter((s) => INTERNAL.some((re) => re.test(s.label)))
    .map((s) => `${s.key}: ${s.label}`)
  assert.deepEqual(bad, [], `이름에 내부 코드명이 있다:\n  ${bad.join('\n  ')}`)
})

/**
 * **도움말은 존댓말이다.**
 *
 * 「…한다」는 명세와 코드 주석의 말이다. 그 말이 화면에 나오면 읽는 사람은 자기에게
 * 하는 말이 아니라고 느끼고, 실제로 이 저장소가 그 지적을 받았다.
 */
test('★ 도움말이 존댓말로 끝난다', () => {
  const bad = TRADING_SETTINGS
    .filter((s) => !/(니다|세요)$/.test(s.help.trim()))
    .map((s) => `${s.key}: ${s.help}`)
  assert.deepEqual(bad, [], `도움말이 해라체다:\n  ${bad.join('\n  ')}`)
})

test('★ 도움말에 개발 기록이 없다 — 날짜와 실측은 커밋에 남긴다', () => {
  const bad = TRADING_SETTINGS
    .filter((s) => /\d{4}-\d{2}-\d{2}|실측|커밋|마이그|v\d+\.\d+\.\d+/.test(s.help))
    .map((s) => `${s.key}: ${s.help}`)
  assert.deepEqual(bad, [], `도움말에 개발 기록이 있다:\n  ${bad.join('\n  ')}`)
})

/** 전각 대시는 문서 기호다. 화면에서는 문장을 끊어 쓴다 */
test('★ 화면 문구에 전각 대시가 없다', () => {
  const bad = TRADING_SETTINGS
    .filter((s) => s.help.includes('—') || s.label.includes('—'))
    .map((s) => s.key)
  assert.deepEqual(bad, [], `전각 대시가 있다: ${bad.join(', ')}`)
})

test('★ 도움말이 짧다 — 길면 아무도 안 읽는다', () => {
  const LIMIT = 60
  const bad = TRADING_SETTINGS
    .filter((s) => s.help.length > LIMIT)
    .map((s) => `${s.key}: ${s.help.length}자`)
  assert.deepEqual(bad, [], `도움말이 ${LIMIT}자를 넘는다:\n  ${bad.join('\n  ')}`)
})

test('★ 이름도 짧다', () => {
  const bad = TRADING_SETTINGS.filter((s) => s.label.length > 20).map((s) => s.label)
  assert.deepEqual(bad, [], `이름이 길다: ${bad.join(', ')}`)
})

test('★ 용어집 금지어를 안 쓴다', () => {
  const bad: string[] = []
  for (const s of TRADING_SETTINGS) {
    for (const { bad: term, good } of BANNED_TERMS) {
      if (s.label.includes(term)) bad.push(`${s.key} 이름의 「${term}」 → 「${good}」`)
      if (s.help.includes(term)) bad.push(`${s.key} 도움말의 「${term}」 → 「${good}」`)
    }
  }
  assert.deepEqual(bad, [], `금지어를 쓴다:\n  ${bad.join('\n  ')}`)
})

test('★ 같은 이름이 두 개가 아니다 — 겹치면 어느 것을 고칠지 모른다', () => {
  const seen = new Map<string, string[]>()
  for (const s of TRADING_SETTINGS) {
    seen.set(s.label, [...(seen.get(s.label) ?? []), s.key])
  }
  const dup = [...seen.entries()].filter(([, keys]) => keys.length > 1)
    .map(([label, keys]) => `${label}: ${keys.join(', ')}`)
  assert.deepEqual(dup, [], `이름이 겹친다:\n  ${dup.join('\n  ')}`)
})

/** 규칙 번호는 사라지면 안 된다. 화면에서 뺀 대신 근거 자리에 남는다 */
test('★ 명세의 규칙 번호가 근거에 남아 추적이 끊기지 않는다', () => {
  const ruleSettings = TRADING_SETTINGS.filter((s) => s.key.startsWith('signal_') || s.key.startsWith('gate_'))
  assert.ok(ruleSettings.length > 10, '규칙 설정을 못 찾았다')
  const noSource = ruleSettings.filter((s) => !/§|SR-|SG-|명세|설계/.test(s.source)).map((s) => s.key)
  assert.deepEqual(noSource, [], `근거가 없어 어느 규칙인지 못 찾는다: ${noSource.join(', ')}`)
})

test('★ 세는 대상이 0개가 아니다', () => {
  assert.ok(TRADING_SETTINGS.length > 50, '설정을 하나도 못 찾았다 — 가드가 언제나 초록이다')
})
