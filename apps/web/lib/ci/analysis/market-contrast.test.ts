import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buildMarketContrast, describeComposition,
  MARKET_MIN_CHANNELS, MARKET_MIN_WINNER_CHANNELS,
  type MarketContrastInput,
} from './market-contrast.ts'
import { isJudged, isWinner } from './account-contrast.ts'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..', '..')

function row(o: {
  ch: string; idx: number | null; format?: string; name?: string
}): MarketContrastInput {
  return {
    outlierIndex: o.idx,
    format: o.format ?? 'long',
    durationSec: null, weekday: null, dayPart: null, keywords: null, title: null,
    channelId: o.ch,
    channelName: o.name ?? o.ch,
  }
}

/** 채널 5곳·잘된 것 3채널 — 게이트를 통과하는 최소 표본 */
function healthySample(): MarketContrastInput[] {
  return [
    ...['c1', 'c1', 'c2', 'c2', 'c3', 'c3'].map((ch) => row({ ch, idx: 2.0, format: 'short' })),
    ...['c1', 'c2', 'c3', 'c4', 'c5', 'c1', 'c2', 'c3'].map((ch) => row({ ch, idx: 1.0, format: 'long' })),
  ]
}

// ── "잘된 것"의 정의가 한 곳인지 ──────────────────────────────

test('isWinner/isJudged가 판정의 유일한 정의다 — 시장과 채널이 같은 기준을 쓴다', () => {
  assert.equal(isJudged({ outlierIndex: null }), false)
  assert.equal(isJudged({ outlierIndex: Number.NaN }), false)
  assert.equal(isJudged({ outlierIndex: 0.2 }), true)
  assert.equal(isWinner({ outlierIndex: 1.5 }), true)   // 경계 포함
  assert.equal(isWinner({ outlierIndex: 1.49 }), false)
  assert.equal(isWinner({ outlierIndex: null }), false)
})

// ── 표본 구성 공개 ────────────────────────────────────────────

test('★ 한 채널이 표본을 지배하면 그 사실을 문장에 박는다 — 숨기면 한 계정의 습관이 법칙처럼 읽힌다', () => {
  const rows = [
    ...Array.from({ length: 99 }, () => row({ ch: 'big', idx: 1, name: '추성훈' })),
    row({ ch: 'small', idx: 1, name: '다른곳' }),
  ]
  const c = describeComposition(rows)
  assert.equal(c.channels, 2)
  assert.equal(c.topChannelShare, 99)
  assert.equal(c.dominated, true)
  assert.match(c.text, /추성훈/)
  assert.match(c.text, /99%/)
})

test('채널이 하나뿐이면 그렇게 말한다', () => {
  const c = describeComposition(Array.from({ length: 5 }, () => row({ ch: 'a', idx: 1, name: '한곳' })))
  assert.equal(c.channels, 1)
  assert.match(c.text, /한 곳입니다/)
})

test('고르게 퍼져 있으면 지배 표기를 하지 않는다', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((ch) => row({ ch, idx: 1 }))
  const c = describeComposition(rows)
  assert.equal(c.dominated, false)
  assert.equal(c.topChannelShare, 20)
})

test('표본이 없으면 없다고 말한다 — 0을 발견처럼 그리지 않는다', () => {
  const c = describeComposition([])
  assert.equal(c.channels, 0)
  assert.equal(c.contents, 0)
  assert.match(c.text, /없습니다/)
})

// ── 게이트 ────────────────────────────────────────────────────

test('★ 채널이 기준 미만이면 "시장"이라 말하지 않는다 — 이번 재설계의 핵심 결함', () => {
  // 채널 1곳 310건: 예전 화면이 이 상태를 "시장"이라 불렀다
  const rows = Array.from({ length: 310 }, (_, i) => row({
    ch: 'only', idx: i % 3 === 0 ? 2.0 : 1.0, format: i % 3 === 0 ? 'short' : 'long', name: '추성훈',
  }))
  const r = buildMarketContrast(rows)
  assert.equal(r.findings.length, 0, '한 채널짜리 표본에서 시장 발견을 냈다')
  assert.match(r.insufficientReason ?? '', new RegExp(String(MARKET_MIN_CHANNELS)))
  assert.match(r.insufficientReason ?? '', /시장/)
  // 게이트에 걸려도 구성은 밝힌다
  assert.equal(r.composition.channels, 1)
})

test('★ 잘된 게시물이 소수 채널에서만 나오면 발견으로 팔지 않는다', () => {
  const rows = [
    // 잘된 것이 c1·c2 두 곳에서만
    ...['c1', 'c1', 'c2', 'c2'].map((ch) => row({ ch, idx: 2.0, format: 'short' })),
    ...['c1', 'c2', 'c3', 'c4', 'c5', 'c3'].map((ch) => row({ ch, idx: 1.0, format: 'long' })),
  ]
  const r = buildMarketContrast(rows)
  assert.equal(r.winnerChannels, 2)
  assert.equal(r.findings.length, 0)
  assert.match(r.insufficientReason ?? '', new RegExp(String(MARKET_MIN_WINNER_CHANNELS)))
})

test('게이트를 통과하면 대조 결과를 낸다 — 통과 자체가 막히면 화면이 영영 비어 있다', () => {
  const r = buildMarketContrast(healthySample())
  assert.equal(r.insufficientReason, null, r.insufficientReason ?? '')
  assert.ok(r.findings.length > 0, '통과 표본인데 발견이 없다')
  assert.ok(r.findings.some((f) => f.dimension === 'format'), '형식 차이를 못 찾았다')
  assert.equal(r.winnerChannels, 3)
  assert.equal(r.composition.channels, 5)
})

test('★ 근거 문장에 채널 수가 들어간다 — 건수만 보이면 한 채널 20건이 여러 채널 20건처럼 읽힌다', () => {
  const r = buildMarketContrast(healthySample())
  assert.match(r.basisText, /채널 3곳/)
  assert.match(r.basisText, /잘된 게시물 6건/)
  assert.match(r.basisText, /평소 8건/)
})

test('빈 입력에서 터지지 않는다', () => {
  const r = buildMarketContrast([])
  assert.equal(r.findings.length, 0)
  assert.ok(r.insufficientReason)
  assert.equal(r.winnerChannels, 0)
})

test('채널을 모르는 행은 채널 수에 포함되지 않는다 — 모르는 것을 한 부류로 만들지 않는다', () => {
  const rows = [row({ ch: 'a', idx: 1 }), { ...row({ ch: 'a', idx: 1 }), channelId: null }]
  assert.equal(describeComposition(rows).channels, 1)
})

test('대조 기준은 SSOT에 위임한다 — 여기서 다시 구현하면 두 화면의 답이 갈린다', () => {
  const src = readFileSync(join(here, 'market-contrast.ts'), 'utf8')
  assert.match(src, /buildAccountContrast\(/, '대조를 SSOT에 위임하지 않는다')
  assert.doesNotMatch(src, /MIN_LIFT|MIN_SUPPORT|contrastCategory/,
    '대조 판정 규칙을 시장 쪽에 복제했다 — account-contrast가 유일한 규칙이어야 한다')
})

// ── 모집단 분리 재발 차단 (정적) ──────────────────────────────
//
// 실제 사고: `getTimingOverview(workspaceId)`가 기간·주제를 아예 안 받아
// 위쪽은 "28일 표본 18건", 아래쪽은 "312/313건"이었다. 기간을 바꿔도 아래는 그대로였다.

test('★ 게시 맥락 집계는 기간·주제를 받는다 — 안 받으면 한 화면에 모집단이 둘 생긴다', () => {
  const src = readFileSync(join(web, 'lib/ci/queries/trends.ts'), 'utf8')
  assert.match(src, /export async function getTimingOverview\(\s*workspaceId: string,\s*windowDays[^)]*topicId/,
    'getTimingOverview가 기간·주제 인자를 받지 않는다')
  // 기간 조건이 실제로 쿼리에 걸리는지 (인자만 받고 안 쓰면 같은 사고다)
  const body = src.slice(src.indexOf('export async function getTimingOverview'))
  assert.match(body, /published_at\.gte\.\$\{since\}/, 'getTimingOverview가 기간 조건을 쿼리에 걸지 않는다')
  assert.match(body, /\.eq\('topic_id', topicId\)/, 'getTimingOverview가 주제 조건을 걸지 않는다')
})

test('★ 화면이 조건을 실제로 넘긴다 — 함수만 고치고 호출부를 안 고치면 그대로다', () => {
  const src = readFileSync(join(web, 'app/(ci)/ci/trends/page.tsx'), 'utf8')
  assert.match(src, /getTimingOverview\(workspace\.id, windowDays, topicId\)/,
    '트렌드 페이지가 getTimingOverview에 조건을 넘기지 않는다')
  assert.match(src, /getMarketContrast\(workspace\.id, windowDays, topicId\)/,
    '트렌드 페이지가 시장 대조를 같은 조건으로 부르지 않는다')
})

test('★ 시장 탭은 나열이 아니라 결론을 먼저 그린다', () => {
  const src = readFileSync(join(web, 'app/(ci)/ci/trends/TrendsView.tsx'), 'utf8')
  assert.match(src, /<AccountWhyPanel\b/, '시장 탭에 결론 패널이 없다 — 집계 나열로 되돌아갔다')
  const panelAt = src.indexOf('<AccountWhyPanel')
  const firstTable = src.indexOf('rows={p.market.byPlatform}')
  assert.ok(panelAt > 0 && firstTable > panelAt, '집계표가 결론보다 먼저 나온다')
  // 표본 구성을 반드시 함께 넘긴다
  assert.match(src, /composition=\{p\.marketWhy\.composition\.text\}/,
    '표본 구성을 화면에 넘기지 않는다 — 지배 채널이 숨는다')
})
