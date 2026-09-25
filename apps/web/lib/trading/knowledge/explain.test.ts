/**
 * 신호 설명 — **알림이 이것을 안 기다린다** (§12)
 *
 * 설명을 만드는 데 몇 초가 걸린다. 그 몇 초가 큰 이유는 시간이 아니라 —
 * AI 가 죽은 날 알림이 통째로 안 나가기 때문이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_FACT_KEYS, BANNED_PHRASES, MAX_EXPLANATION_LENGTH, TRUNCATION_MARK,
  factLines, buildExplainPrompt, checkExplanation, normalizeExplanation,
  type SignalFacts,
} from './explain-policy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRADING = join(HERE, '..')

const F: SignalFacts = {
  direction: 'long', referencePrice: 301.25, stopPrice: 299.8, targetPrice: 303.1,
  calibratedProb: 0.62, netExpectedValueR: 0.31, riskPerTradeKrw: 362500,
  triggerId: 'breakout', minutesSinceOpen: 42,
}

test('사실 줄이 신호 기록만 담는다', () => {
  const lines = factLines(F)
  assert.ok(lines[0].includes('매수'))
  assert.ok(lines.some((l) => l.includes('301.25')))
  assert.ok(lines.some((l) => l.includes('62%')))
  assert.ok(lines.some((l) => l.includes('0.31R')))
  assert.ok(lines.some((l) => l.includes('362,500원')))
})

test('★ 보정이 없으면 「없음」이라 적는다 — 0% 로 적으면 계산한 값처럼 보인다', () => {
  const lines = factLines({ ...F, calibratedProb: null, netExpectedValueR: null })
  assert.ok(lines.some((l) => l === '보정 확률: 없음'))
  assert.ok(lines.some((l) => l === '순기대값: 없음'))
  assert.equal(lines.some((l) => l.includes('0%')), false)
})

test('★ 프롬프트에 신호 기록 밖의 재료가 안 들어간다 — 안 주는 것이 쓰지 말라는 것보다 낫다', () => {
  const p = buildExplainPrompt(F)
  assert.ok(p.includes('있는 것만'))
  assert.ok(p.includes('시장 상황·뉴스·전망을 쓰지 않는다'))
  assert.ok(p.includes('권하지 않는다'))
  assert.ok(p.includes('확률을 단정으로 바꾸지 않는다'))
  // 사실 줄 말고 다른 자료가 안 붙는다
  for (const line of factLines(F)) assert.ok(p.includes(line))
})

test('★ 볼 수 있는 값의 목록이 형과 어긋나지 않는다', () => {
  const keys = Object.keys(F) as (keyof SignalFacts)[]
  assert.deepEqual([...ALLOWED_FACT_KEYS].sort(), keys.sort())
})

// ── 지어낸 말 막기 ───────────────────────────────────────

test('★ 권하는 말과 단정하는 말이 있으면 안 싣는다', () => {
  for (const bad of ['지금 들어가세요', '뉴스에 따르면 좋습니다', '확실히 오릅니다', '수익을 보장합니다']) {
    const r = checkExplanation(bad)
    assert.ok(r, `「${bad}」 가 통과했다`)
    assert.match(r.reason, /^banned_phrase:/)
  }
  assert.equal(checkExplanation('기준가 301.25 에서 매수 신호입니다. 손절은 299.8 입니다.'), null)
})

test('빈 설명은 설명이 아니다', () => {
  assert.equal(checkExplanation('   ')?.reason, 'empty')
})

test('금지어 목록이 비어 있지 않다 — 비면 위 시험이 공회전이다', () => {
  assert.ok(BANNED_PHRASES.length >= 8)
  assert.ok(BANNED_PHRASES.includes('들어가세요'))
  assert.ok(BANNED_PHRASES.includes('보장'))
})

test('긴 설명은 자르고 자른 사실을 남긴다', () => {
  const long = normalizeExplanation('가'.repeat(MAX_EXPLANATION_LENGTH + 100))
  assert.equal(long.length, MAX_EXPLANATION_LENGTH)
  assert.ok(long.endsWith(TRUNCATION_MARK))
})

// ── 알림이 설명을 안 기다린다 (M2 · §12) ─────────────────

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

/**
 * 주석만 지운다. **import 는 남긴다** — 알림 경로에서는 들여오는 것 자체가 위반이다.
 * 들여와 놓고 안 부른다는 것은 다음 줄에서 부르겠다는 뜻이고, 그 다음 줄은 언젠가 온다.
 */
function sources(): { file: string; src: string }[] {
  return walk(TRADING).map((file) => ({
    file: relative(TRADING, file),
    src: readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1'),
  }))
}

/** 알림이 나가는 길에 있는 파일들 */
const NOTIFY_PATH = [
  'notify/outbox.ts', 'notify/outbox-policy.ts',
  'jobs/emit-signal.ts', 'signal/emit.ts', 'signal/store.ts', 'jobs/watch.ts',
]

test('★ 알림 발송 경로가 설명을 안 부른다 — 부르면 AI 가 죽은 날 알림이 통째로 안 나간다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    if (!NOTIFY_PATH.includes(file)) continue
    /**
     * 부르는 꼴만 보지 않는다. 실측: `const { explainSignal } = await import(...)` 로 들여오고
     * 안 부르는 판을 넣었더니 `이름\s*\(` 가드가 초록이었다. **이름이 나오면 위반**이다
     */
    if (/explainSignal|buildExplainPrompt|signal_explain|knowledge\/explain/.test(src)) {
      offenders.push(file)
    }
  }
  assert.deepEqual(offenders, [],
    `알림 경로가 설명을 기다린다:\n  ${offenders.join('\n  ')}`)
})

test('★ 검사 대상 경로가 실제로 있다 — 이름이 바뀌면 위 단정이 공회전한다', () => {
  const files = new Set(sources().map((s) => s.file))
  for (const f of NOTIFY_PATH) assert.ok(files.has(f), `${f} 가 없다. 경로 목록을 고친다`)
})

test('★ 설명이 신호를 안 바꾼다 — 쓰는 곳이 설명 표 하나뿐이다', () => {
  const src = readFileSync(join(HERE, 'explain.ts'), 'utf8')
  const writes = [...src.matchAll(/\.from\('(\w+)'\)[\s\S]{0,120}?\.(insert|update|upsert)\(/g)]
    .map((m) => m[1])
  assert.deepEqual([...new Set(writes)], ['trading_signal_explanations'],
    `설명이 다른 표를 쓴다: ${writes.join(', ')}`)
})

test('★ 설명이 실패해도 신호가 남는다 — 신호 표를 아예 안 만진다', () => {
  const src = readFileSync(join(HERE, 'explain.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function explainSignal'))
  assert.equal(/from\('trading_signals'\)/.test(fn), false, '설명이 신호 표를 만진다')
})
