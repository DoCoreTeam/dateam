/**
 * **알림은 다섯을 다 지나야 나간다** (명세 M2)
 *
 * 「안전 게이트 → 진입 조건 → 판단 → 보정 → 신호 규칙」. 이 다섯을 건너뛰고
 * 알림으로 가는 길이 하나라도 있으면, 그 길로 나간 알림은 게이트를 안 본 알림이다.
 * 그리고 **화면에서는 똑같이 보인다** — 사람은 그 알림을 보고 돈을 넣는다.
 *
 * 무엇을 세나
 *   ① 판단기·지표에서 알림·신호 저장으로 가는 지름길
 *   ② 알림을 대기 표 밖에서 보내는 자리 (§14.3 D-33)
 *   ③ 게이트나 규칙을 끄는 말
 *   ④ 신호를 내는 자리가 `decideEmit` 을 지나는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMIT_STAGES } from '../trading/signal/emit.ts'
import { TRADING_APP_DIR } from './app-dirs.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRADING = join(WEB, 'lib', 'trading')
const TRADING_APP = join(WEB, TRADING_APP_DIR)
const TRADING_API = join(WEB, 'app', 'api', 'trading')

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    // 가드 자신은 금지어를 적어야 한다
    if (name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

/** 주석은 코드를 실행하지 않는다. 설명을 위반으로 세면 설명을 지우게 된다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/**
 * `import` 줄을 지운다.
 *
 * **들여온 것은 부른 것이 아니다.** 실측 2026-09-26: 관문 판정 호출을 떼어 봤는데
 * 이 가드가 초록이었다 — `import { decideEnableNotify }` 줄이 그대로 남아
 * 이름이 「있다」로 세어졌기 때문이다.
 */
function stripImports(src: string): string {
  return src
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, ' ')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, ' ')
}

function sources(root: string): { file: string; src: string }[] {
  return walk(root).map((file) => ({
    file: relative(WEB, file),
    src: stripImports(stripComments(readFileSync(file, 'utf8'))),
  }))
}

const ALL = () => [...sources(TRADING), ...sources(TRADING_APP), ...sources(TRADING_API)]

test('★ 검사 대상이 있다 — 0개면 아래 단정은 언제나 초록이다', () => {
  const files = ALL()
  assert.ok(files.length >= 50, `대상이 ${files.length}개뿐이다. 경로가 바뀌었는지 확인한다`)
  assert.ok(files.some((f) => f.src.includes('decideEmit')), '발행 판정을 못 찾았다')
  assert.ok(files.some((f) => f.src.includes('queueNotification')), '알림 대기 표를 못 찾았다')
})

test('★ 판단기에서 알림·신호로 가는 지름길이 0개다 (M2)', () => {
  const offenders: string[] = []
  for (const { file, src } of sources(join(TRADING, 'judge'))) {
    for (const forbidden of ['queueNotification', 'saveSignal', 'trading_notifications', 'trading_signals']) {
      if (src.includes(forbidden)) offenders.push(`${file} — ${forbidden}`)
    }
  }
  assert.deepEqual(offenders, [],
    `판단기가 게이트와 규칙을 건너뛰고 알림·신호로 간다:\n  ${offenders.join('\n  ')}`)
})

test('★ 알림을 대기 표 밖에서 보내는 자리가 0개다 (§14.3 D-33)', () => {
  const offenders: string[] = []
  for (const { file, src } of ALL()) {
    // 알림 표에 직접 insert 하는 곳은 아웃박스 하나뿐이다
    if (!/from\('trading_notifications'\)/.test(src)) continue
    if (file.endsWith('lib/trading/notify/outbox.ts')) continue
    offenders.push(file)
  }
  assert.deepEqual(offenders, [],
    `알림 표를 아웃박스 밖에서 만진다 — 두 크론이 같은 알림을 두 번 보낸다:\n  ${offenders.join('\n  ')}`)
})

test('★ 신호를 저장하는 자리가 발행 판정을 지난다', () => {
  const writers = ALL().filter(({ file, src }) =>
    /from\('trading_signals'\)\s*\n?\s*\.insert/.test(src) && !file.endsWith('lib/trading/signal/store.ts'))
  assert.deepEqual(writers.map((w) => w.file), [],
    '신호를 store 밖에서 만든다 — 그 자리는 유일 키(§14.3)를 안 지난다')

  // 정의한 자리(store.ts)는 부르는 자리가 아니다. 안 빼면 정의가 위반으로 잡힌다
  const callers = ALL().filter(({ file, src }) =>
    /\bsaveSignal\s*\(/.test(src) && !file.endsWith('lib/trading/signal/store.ts'))
  assert.ok(callers.length > 0, 'saveSignal 을 아무도 안 부른다')
  for (const { file, src } of callers) {
    assert.ok(/\bdecideEmit\s*\(/.test(src), `${file} 이 발행 판정을 안 지나고 신호를 만든다`)
  }
})

test('★ 게이트·규칙을 끄는 말이 0개다', () => {
  const offenders: string[] = []
  // 「끈다」는 말은 게이트·규칙·발행 쪽에서만 센다. 알림 켜기(notify_enabled)는 C4 가 시키는 스위치다
  const scope = [
    ...sources(join(TRADING, 'gate')),
    ...sources(join(TRADING, 'signal')),
    ...sources(join(TRADING, 'jobs')),
  ]
  for (const { file, src } of scope) {
    for (const word of ['bypassGate', 'skipGate', 'disableGate', 'ignoreRules', 'forceSignal', 'gateDisabled']) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(src)) offenders.push(`${file} — ${word}`)
    }
  }
  assert.deepEqual(offenders, [], `게이트를 끄는 말이 생겼다:\n  ${offenders.join('\n  ')}`)
})

test('★ 다섯 단계가 한 곳에서만 정해진다 — 두 곳이 되면 갈린다', () => {
  const definers = ALL().filter(({ src }) => src.includes('EMIT_STAGES ='))
  assert.deepEqual(definers.map((d) => d.file), ['lib/trading/signal/emit.ts'])
  assert.equal(EMIT_STAGES.length, 5)
})

test('★ 발행 판정이 다섯 단계를 전부 본다 — 한 칸을 안 보면 그 단계가 사라진다', () => {
  const src = readFileSync(join(TRADING, 'signal', 'emit.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function decideEmit'))
  const body = fn.slice(0, fn.indexOf("\n  return { kind: 'signal' }"))
  for (const stage of EMIT_STAGES) {
    assert.ok(body.includes(`stage: '${stage}'`), `${stage} 단계에서 막는 자리가 없다`)
  }
})

test('★ 알림 켜기가 관문 판정을 지난다 (C4)', () => {
  const togglers = ALL().filter(({ src }) => /'notify_enabled'/.test(src) && /saveTradingSetting\s*\(/.test(src))
  assert.ok(togglers.length > 0, '알림을 켜고 끄는 자리를 못 찾았다')
  for (const { file, src } of togglers) {
    // 이름이 아니라 **부르는 자리**를 본다
    assert.ok(/\bdecideEnableNotify\s*\(/.test(src), `${file} 이 관문을 안 지나고 알림을 켠다`)
    assert.ok(/\bdecideDisableNotify\s*\(/.test(src), `${file} 이 끄기 판정을 안 지난다`)
  }
})
