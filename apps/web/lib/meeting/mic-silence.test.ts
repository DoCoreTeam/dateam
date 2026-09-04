/**
 * 마이크 무음 판정 — 순간값이 지속 상태로 둔갑하지 않는지 잠근다.
 *
 * **왜 이 가드가 있나**: 화면이 떨린 이유는 판정이 «지금 이 순간 조용한가」였기 때문이다.
 * 그 판정은 초당 60번 뒤집혔고, 문단이 붙었다 떨어지며 아래 에디터를 밀었다.
 * 여기서 잠그는 것은 «몇 초 연속으로 조용해야 조용하다고 말하는가»다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  nextMicSilence,
  IDLE_MIC_SILENCE,
  QUIET_ENTER_LEVEL,
  QUIET_EXIT_LEVEL,
  QUIET_ENTER_MS,
  QUIET_WARMUP_MS,
  type MicSilenceState,
} from './mic-silence.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** 시작 시각 0 을 기준으로 표본을 흘려 넣는다 */
function feed(
  states: MicSilenceState,
  samples: Array<{ level: number; at: number }>,
): MicSilenceState {
  let s = states
  for (const { level, at } of samples) {
    s = nextMicSilence(s, { level, nowMs: at, startedAtMs: 0 })
  }
  return s
}

test('★ 준비 시간 안에는 조용하다고 말하지 않는다 — 마이크가 열리는 동안의 0 은 음소거가 아니다', () => {
  const s = feed(IDLE_MIC_SILENCE, [
    { level: 0, at: 100 },
    { level: 0, at: 3_000 },
    { level: 0, at: QUIET_WARMUP_MS - 1 },
  ])
  assert.equal(s.quiet, false)
})

test('★ 연속으로 4초 조용해야 말한다 — 3.9초에서는 아직 아니다', () => {
  const start = QUIET_WARMUP_MS
  const almost = feed(IDLE_MIC_SILENCE, [
    { level: 0.001, at: start },
    { level: 0.001, at: start + QUIET_ENTER_MS - 100 },
  ])
  assert.equal(almost.quiet, false, '3.9초는 아직 «지속»이 아니다')

  const enough = nextMicSilence(almost, {
    level: 0.001,
    nowMs: start + QUIET_ENTER_MS,
    startedAtMs: 0,
  })
  assert.equal(enough.quiet, true, '4초를 채우면 말한다')
})

test('★ 소리가 들어오면 즉시 해제하고 타이머도 지운다 — 다시 4초를 세야 한다', () => {
  const start = QUIET_WARMUP_MS
  const quiet = feed(IDLE_MIC_SILENCE, [
    { level: 0.001, at: start },
    { level: 0.001, at: start + QUIET_ENTER_MS },
  ])
  assert.equal(quiet.quiet, true)

  const spoke = nextMicSilence(quiet, {
    level: QUIET_EXIT_LEVEL,
    nowMs: start + QUIET_ENTER_MS + 10,
    startedAtMs: 0,
  })
  assert.equal(spoke.quiet, false)
  assert.equal(spoke.since, null, '타이머가 남아 있으면 다음 정적에서 곧바로 켜진다')
})

test('★ 불감대(0.02~0.05)에서 판정이 흔들리지 않는다 — 이것이 떨림의 근본 형태였다', () => {
  const start = QUIET_WARMUP_MS
  // 진입 문턱 바로 위·아래를 오간다. 문턱이 하나면 여기서 매 표본마다 판정이 뒤집힌다.
  let s: MicSilenceState = IDLE_MIC_SILENCE
  let flips = 0
  let prev = false
  // 4초 문턱을 확실히 넘기도록 300 프레임(4.8초)을 흘린다
  for (let i = 0; i < 300; i += 1) {
    s = nextMicSilence(s, {
      level: i % 2 === 0 ? QUIET_ENTER_LEVEL - 0.005 : QUIET_ENTER_LEVEL + 0.01,
      nowMs: start + i * 16, // 60fps
      startedAtMs: 0,
    })
    if (s.quiet !== prev) { flips += 1; prev = s.quiet }
  }
  assert.equal(flips, 1, `300 프레임에 전환은 «조용해짐» 한 번뿐이어야 한다 (실제: ${flips})`)
  assert.equal(s.quiet, true, '불감대에 머무는 동안은 조용한 쪽으로 수렴한다')
})

test('★ 말 사이의 짧은 정적은 «음소거»가 아니다 — 낱말 사이 0.3초가 매번 경고를 띄웠다', () => {
  const start = QUIET_WARMUP_MS
  let s: MicSilenceState = IDLE_MIC_SILENCE
  // 1.5초 말하고 0.3초 쉬기를 20번 반복 — 사람이 말하는 모양
  let t = start
  for (let turn = 0; turn < 20; turn += 1) {
    for (let i = 0; i < 90; i += 1) { s = nextMicSilence(s, { level: 0.35, nowMs: t, startedAtMs: 0 }); t += 16 }
    for (let i = 0; i < 18; i += 1) { s = nextMicSilence(s, { level: 0.001, nowMs: t, startedAtMs: 0 }); t += 16 }
    assert.equal(s.quiet, false, `${turn + 1}번째 쉼에서 경고가 떴다`)
  }
})

test('마이크가 정말 음소거면 켜지고, 켜진 채로 유지된다', () => {
  const start = QUIET_WARMUP_MS
  let s: MicSilenceState = IDLE_MIC_SILENCE
  for (let t = start; t <= start + 30_000; t += 16) {
    s = nextMicSilence(s, { level: 0, nowMs: t, startedAtMs: 0 })
  }
  assert.equal(s.quiet, true)
})

test('문턱은 서로 다르다 — 같으면 슈미트 트리거가 아니다', () => {
  assert.ok(QUIET_EXIT_LEVEL > QUIET_ENTER_LEVEL)
  assert.ok(QUIET_ENTER_MS >= 2_000, '너무 짧으면 말 사이의 쉼을 다시 잡는다')
})

// ── 가드: 60fps 상태가 되살아나지 않는다 ─────────────────────────────

test('★ 레코더가 마이크 세기를 리액트 상태로 들지 않는다 — setLevel 재유입 차단', () => {
  const src = read('lib/meeting/use-recorder.ts')
  assert.ok(!/setLevel\s*\(/.test(src), 'setLevel 이 돌아왔다 — 초당 60번 리렌더된다')
  assert.ok(src.includes('subscribeLevel'), '미터는 구독으로 그린다')
  assert.ok(src.includes('nextMicSilence'), '무음 판정은 SSOT 를 거친다')
})

test('★ 컨텍스트가 마이크 세기를 값으로 내보내지 않는다 — 내보내면 모든 소비자가 60fps 로 리렌더된다', () => {
  const src = read('lib/meeting/recording-context.tsx')
  assert.ok(!/^\s*level:\s*(number|rec\.level)/m.test(src), 'level 이 컨텍스트 값으로 돌아왔다')
  assert.ok(src.includes('subscribeLevel'), '구독 함수를 내보낸다')
  assert.ok(src.includes('micQuiet'), '지속 판정만 값으로 나간다')
})

test('★ 녹음 패널의 안내 줄은 조건부로 붙였다 뗐다 하지 않는다 — 그게 화면을 밀었다', () => {
  const src = read('components/meeting/RecordingPanel.tsx')
  assert.ok(src.includes('styles.micLine'), '안내 줄이 전용 클래스를 쓴다')
  assert.ok(
    !/rec\.micQuiet\s*&&\s*\(/.test(src),
    '조건부 마운트가 돌아왔다 — 나타날 때마다 아래 화면이 밀린다',
  )
  assert.ok(!/rec\.level/.test(src), '순간값을 화면이 다시 읽고 있다')
})

test('★ 그 줄이 자리를 예약한다 — min-height 가 없으면 결국 다시 밀린다', () => {
  const css = read('components/meeting/recording-panel.module.css')
  const block = css.slice(css.indexOf('.micLine'))
  assert.ok(block.includes('min-height'), '.micLine 에 최소 높이가 없다')
})
