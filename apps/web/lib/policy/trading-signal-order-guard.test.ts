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
import { agreedDirection } from '../trading/signal/models-core.ts'
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

test('★ 발행 단계가 한 곳에서만 정해진다 — 두 곳이 되면 갈린다', () => {
  const definers = ALL().filter(({ src }) => src.includes('EMIT_STAGES ='))
  assert.deepEqual(definers.map((d) => d.file), ['lib/trading/signal/emit.ts'])
  // 숫자를 박지 않는다. 단계는 늘 수 있고, 줄면 그것이 규칙이 사라진 것이다
  assert.ok(EMIT_STAGES.length >= 5, '단계가 사라졌다')
  assert.deepEqual([...new Set(EMIT_STAGES)].length, EMIT_STAGES.length, '같은 단계가 두 번 있다')
})

test('★ 발행 판정이 모든 단계를 전부 본다 — 한 칸을 안 보면 그 단계가 사라진다', () => {
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

/**
 * **방향은 한 곳에서만 난다** (§7.2)
 *
 * 전에는 두 곳에서 따로 났다. `jobs/tick.ts` 는 원점수로 보정 모델을 골랐고,
 * `jobs/emit-signal.ts` 는 **진입 조건의 방향**으로 손절·목표 부호를 정했다.
 * 어긋나면 롱 보정으로 숏 신호가 나가고 손절가가 반대로 붙는다 —
 * 화면에서는 아무 일도 안 일어나고 숫자만 조용히 반대다.
 */
test('★ 발행 쪽이 방향을 다시 정하지 않는다', () => {
  const emit = readFileSync(join(TRADING, 'jobs', 'emit-signal.ts'), 'utf8')
  const fn = emit.slice(emit.indexOf('export async function emitSignal'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.equal(/const direction = input\.trigger\.direction/.test(body), false,
    '발행이 진입 조건에서 방향을 다시 뽑는다 — 판단과 어긋나도 모른다')
  assert.ok(body.includes('const direction = input.direction'), '방향을 받아서 안 쓴다')
})

test('★ 어긋나면 신호가 안 나가고 사유가 남는다', () => {
  // 판단이 롱인데 진입 조건이 숏이면 낼 수 없다
  assert.deepEqual(
    agreedDirection({ p_long: 0.6, p_short: 0.2, p_hold: 0.2 }, 'short'),
    { direction: null, conflict: true, reason: 'direction_conflict:long!=short' })
  // 관망이 가장 높으면 방향이 없다 (§7.4 D-09)
  assert.deepEqual(
    agreedDirection({ p_long: 0.3, p_short: 0.2, p_hold: 0.5 }, 'long'),
    { direction: null, conflict: true, reason: 'no_direction' })
  // 같은 말을 하면 그 방향이다
  assert.deepEqual(
    agreedDirection({ p_long: 0.6, p_short: 0.2, p_hold: 0.2 }, 'long'),
    { direction: 'long', conflict: false })
  assert.deepEqual(
    agreedDirection({ p_long: 0.1, p_short: 0.7, p_hold: 0.2 }, 'short'),
    { direction: 'short', conflict: false })

  const tick = readFileSync(join(TRADING, 'jobs', 'tick.ts'), 'utf8')
  assert.ok(tick.includes('agreedDirection(rawScore, trigger.direction)'), '어긋남을 안 본다')
  assert.ok(tick.includes('return `emit:judge:${verdict.reason}'), '어긋났는데 사유를 안 남긴다')
})

test('★ 손절·목표 부호가 그 하나의 방향에서 나온다', () => {
  const emit = readFileSync(join(TRADING, 'jobs', 'emit-signal.ts'), 'utf8')
  const fn = emit.slice(emit.indexOf('export async function emitSignal'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  // 청산 계획도 위험 계산도 같은 `direction` 을 쓴다
  assert.ok(body.includes('buildExitPlan(direction,'), '청산 계획이 다른 방향을 쓴다')
  assert.ok(/computeRisk\(\{\s*\n\s*direction,/.test(body), '위험 계산이 다른 방향을 쓴다')
})
