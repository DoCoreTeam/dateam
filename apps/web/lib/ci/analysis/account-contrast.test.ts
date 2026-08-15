import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAccountContrast, MIN_WINNERS, MIN_BASELINE,
  type ContrastInput,
} from './account-contrast.ts'

function row(p: Partial<ContrastInput> & { outlierIndex: number | null }): ContrastInput {
  return {
    format: null, durationSec: null, weekday: null, dayPart: null,
    keywords: null, title: null, ...p,
  }
}

/** 잘된 n건 + 평소 m건을 기본 속성으로 만든다. 각 테스트가 필요한 축만 덮어쓴다. */
function pool(winners: Partial<ContrastInput>[], baseline: Partial<ContrastInput>[]): ContrastInput[] {
  return [
    ...winners.map((w) => row({ outlierIndex: 3, ...w })),
    ...baseline.map((b) => row({ outlierIndex: 0.8, ...b })),
  ]
}

// ── 근거가 없으면 말하지 않는다 ───────────────────────────────────────

test('배수를 낸 게시물이 하나도 없으면 아무 말도 하지 않고 이유를 밝힌다', () => {
  const r = buildAccountContrast([row({ outlierIndex: null }), row({ outlierIndex: null })])
  assert.equal(r.findings.length, 0)
  assert.match(r.insufficientReason ?? '', /배수를 낸 게시물이 없습니다/)
})

test('★ 잘된 게 2건뿐이면 공통점을 찾아도 말하지 않는다 — 우연과 구분이 안 된다', () => {
  const rows = pool(
    [{ format: 'short' }, { format: 'short' }],
    Array.from({ length: 10 }, () => ({ format: 'long' })),
  )
  const r = buildAccountContrast(rows)
  assert.equal(r.winners, 2)
  assert.equal(r.findings.length, 0)
  assert.match(r.insufficientReason ?? '', new RegExp(`${MIN_WINNERS}건부터`))
})

test('★ 평소 게시물이 얇으면 "평소와 다르다"고 말하지 않는다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ format: 'short' })),
    [{ format: 'long' }, { format: 'long' }],
  )
  const r = buildAccountContrast(rows)
  assert.equal(r.findings.length, 0)
  assert.match(r.insufficientReason ?? '', new RegExp(`평소가 ${MIN_BASELINE}건은`))
})

test('배수가 없는 콘텐츠는 양쪽 어디에도 세지 않는다 — 판정 불가를 "평소"로 취급하면 안 된다', () => {
  const rows = [
    ...pool(
      Array.from({ length: 4 }, () => ({ format: 'short' })),
      Array.from({ length: 6 }, () => ({ format: 'long' })),
    ),
    row({ outlierIndex: null, format: 'long' }),
    row({ outlierIndex: null, format: 'long' }),
  ]
  const r = buildAccountContrast(rows)
  assert.equal(r.winners, 4)
  assert.equal(r.baseline, 6)
})

// ── 실제 차이를 찾는다 ───────────────────────────────────────────────

test('형식 차이를 찾는다 — 잘된 건 숏폼, 평소는 롱폼', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ format: 'short' })),
    Array.from({ length: 10 }, () => ({ format: 'long' })),
  )
  const r = buildAccountContrast(rows)
  const f = r.findings.find((x) => x.dimension === 'format')
  assert.ok(f, '형식 차이를 못 찾았다')
  assert.match(f!.text, /숏폼/)
  assert.equal(f!.winnerCount, 5)
})

test('요일·시간대 차이를 사람 말로 낸다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ weekday: 6, dayPart: 'evening' })),
    Array.from({ length: 10 }, () => ({ weekday: 2, dayPart: 'morning' })),
  )
  const r = buildAccountContrast(rows)
  assert.ok(r.findings.some((f) => f.dimension === 'weekday' && /토요일/.test(f.text)))
  assert.ok(r.findings.some((f) => f.dimension === 'dayPart' && /저녁/.test(f.text)))
})

test('소재(키워드) 차이를 찾고, 대소문자·해시태그 표기를 하나로 본다', () => {
  const rows = pool(
    [{ keywords: ['#캠핑'] }, { keywords: ['캠핑'] }, { keywords: ['Camping', '캠핑'] }, { keywords: ['캠핑'] }],
    Array.from({ length: 10 }, () => ({ keywords: ['요리'] })),
  )
  const r = buildAccountContrast(rows)
  const f = r.findings.find((x) => x.dimension === 'keyword' && /캠핑/.test(x.text))
  assert.ok(f, '키워드 차이를 못 찾았다')
  assert.equal(f!.winnerCount, 4, '같은 소재를 표기별로 나눠 셌다')
})

test('한 게시물이 같은 키워드를 두 번 달아도 한 번만 센다', () => {
  const rows = pool(
    Array.from({ length: 4 }, () => ({ keywords: ['캠핑', '캠핑', '#캠핑'] })),
    Array.from({ length: 10 }, () => ({ keywords: ['요리'] })),
  )
  const r = buildAccountContrast(rows)
  const f = r.findings.find((x) => /캠핑/.test(x.text))
  assert.equal(f?.winnerCount, 4)
})

test('길이 차이는 중앙값으로 비교하고 방향을 밝힌다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ durationSec: 45 })),
    Array.from({ length: 10 }, () => ({ durationSec: 600 })),
  )
  const r = buildAccountContrast(rows)
  const f = r.findings.find((x) => x.dimension === 'duration')
  assert.ok(f)
  assert.match(f!.text, /더 짧음/)
})

test('평소에 없던 특징은 "새로 시도한 것"으로 말한다 (0으로 나누지 않는다)', () => {
  const rows = pool(
    Array.from({ length: 4 }, () => ({ format: 'short' })),
    Array.from({ length: 10 }, () => ({ format: 'long' })),
  )
  const r = buildAccountContrast(rows)
  const f = r.findings.find((x) => x.dimension === 'format')
  assert.match(f!.text, /평소 게시물에는 없던/)
  assert.ok(Number.isFinite(f!.lift), 'lift가 Infinity로 새어 나갔다')
})

// ── 차이가 없으면 없다고 말한다 ───────────────────────────────────────

test('★ 잘된 것과 평소가 비슷하면 억지 공식을 만들지 않는다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ format: 'long', weekday: 3, dayPart: 'morning', durationSec: 600, keywords: ['요리'] })),
    Array.from({ length: 10 }, () => ({ format: 'long', weekday: 3, dayPart: 'morning', durationSec: 600, keywords: ['요리'] })),
  )
  const r = buildAccountContrast(rows)
  assert.equal(r.findings.length, 0)
  assert.match(r.insufficientReason ?? '', /뚜렷한 차이를 찾지 못했습니다/)
})

test('비율만 높고 근거가 1건이면 말하지 않는다 (support 하한)', () => {
  const rows = pool(
    [{ keywords: ['희귀소재'] }, {}, {}, {}, {}],
    Array.from({ length: 20 }, () => ({ keywords: ['요리'] })),
  )
  const r = buildAccountContrast(rows)
  assert.equal(r.findings.filter((f) => /희귀소재/.test(f.text)).length, 0)
})

test('작은 길이 차이(10%)는 소음으로 보고 말하지 않는다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ durationSec: 550 })),
    Array.from({ length: 10 }, () => ({ durationSec: 600 })),
  )
  const r = buildAccountContrast(rows)
  assert.equal(r.findings.filter((f) => f.dimension === 'duration').length, 0)
})

test('값을 모르는 콘텐츠(null)를 하나의 부류로 만들지 않는다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ format: null })),
    Array.from({ length: 10 }, () => ({ format: null })),
  )
  const r = buildAccountContrast(rows)
  assert.equal(r.findings.filter((f) => f.dimension === 'format').length, 0)
})

// ── 항상 근거를 붙인다 ───────────────────────────────────────────────

test('근거 문장에 양쪽 표본 수가 반드시 들어간다', () => {
  const rows = pool(
    Array.from({ length: 5 }, () => ({ format: 'short' })),
    Array.from({ length: 10 }, () => ({ format: 'long' })),
  )
  const r = buildAccountContrast(rows)
  assert.match(r.basisText, /5건/)
  assert.match(r.basisText, /10건/)
})

test('차이가 큰 것이 먼저 온다 — 화면이 위에서부터 읽힌다', () => {
  const rows = pool(
    Array.from({ length: 6 }, (_, i) => ({
      format: 'short',
      weekday: i < 4 ? 6 : 1,
    })),
    Array.from({ length: 12 }, (_, i) => ({ format: 'long', weekday: i % 7 })),
  )
  const r = buildAccountContrast(rows)
  assert.ok(r.findings.length >= 2)
  for (let i = 1; i < r.findings.length; i += 1) {
    assert.ok(r.findings[i - 1].lift >= r.findings[i].lift, '정렬이 깨졌다')
  }
})

test('빈 입력도 예외 없이 처리한다', () => {
  const r = buildAccountContrast([])
  assert.equal(r.winners, 0)
  assert.equal(r.findings.length, 0)
  assert.ok(r.insufficientReason)
})
