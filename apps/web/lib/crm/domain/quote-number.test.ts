import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderQuoteNo, seqScopeOf, seqPrefix, seqOf, validateQuoteNoPattern,
  DEFAULT_QUOTE_NO_PATTERN, QUOTE_NO_PRESETS,
} from './quote-number.ts'

test('기본 형식에 연월일이 통째로 들어간다 — 번호만 보고 언제 낸 견적인지 안다', () => {
  assert.equal(renderQuoteNo(DEFAULT_QUOTE_NO_PATTERN, '2026-08-28', 1), 'DA-20260828-01')
  assert.equal(renderQuoteNo(DEFAULT_QUOTE_NO_PATTERN, '2026-08-28', 12), 'DA-20260828-12')
})

test('★ 긴 토큰이 먼저 바뀐다 — {YYYY} 를 먼저 바꾸면 {YYYYMMDD} 가 깨진다', () => {
  assert.equal(renderQuoteNo('{YYYYMMDD}-{SEQ:2}', '2026-08-28', 3), '20260828-03')
  // 둘이 함께 있어도 각자 맞는다
  assert.equal(renderQuoteNo('{YYYY}/{YYYYMMDD}', '2026-01-05', 1), '2026/20260105')
})

test('토큰이 전부 치환된다', () => {
  assert.equal(renderQuoteNo('{YYYY}/{YY}/{MM}/{DD}/{MMDD}/{SEQ}/{SEQ:2}', '2026-01-05', 7),
    '2026/26/01/05/0105/0007/07')
})

test('모르는 토큰은 지우지 않고 그대로 둔다 — 조용히 짧아지면 나간 뒤에 안다', () => {
  assert.equal(renderQuoteNo('X-{NOPE}-{SEQ:2}', '2026-08-28', 3), 'X-{NOPE}-03')
})

test('빈 형식은 기본값으로 떨어진다 — 번호 없는 견적을 만들지 않는다', () => {
  assert.equal(renderQuoteNo('', '2026-08-28', 1), 'DA-20260828-01')
})

test('채번 범위는 형식이 정한다 — 사용자가 따로 고르면 둘이 어긋난다', () => {
  assert.equal(seqScopeOf('DA-{YYYY}-{MMDD}-{SEQ:2}'), 'DAY')
  assert.equal(seqScopeOf('DA-{YYYYMMDD}-{SEQ:2}'), 'DAY')
  assert.equal(seqScopeOf('Q-{YYYY}{MM}-{SEQ}'), 'MONTH')
  assert.equal(seqScopeOf('Q-{YYYY}-{SEQ}'), 'YEAR')
  assert.equal(seqScopeOf('Q{SEQ}'), 'FOREVER')
  /*
    빈 형식은 기본값으로 본다 — `renderQuoteNo` 가 그렇게 하므로 여기도 같아야 한다.
    안 맞추면 설정 화면이 「계속 이어서」라고 안내하는데 저장되는 번호는 「날마다」다(실측).
  */
  assert.equal(seqScopeOf(''), 'DAY', '빈 형식이 기본값과 다른 범위로 안내된다')
})

test('앞자리로 같은 범위의 번호를 찾는다', () => {
  assert.equal(seqPrefix('DA-{YYYY}-{MMDD}-{SEQ:2}', '2026-08-28'), 'DA-2026-0828-')
  assert.equal(seqPrefix('DA-{YYYYMMDD}-{SEQ:2}', '2026-08-28'), 'DA-20260828-')
  assert.equal(seqPrefix('Q-{YYYY}-{SEQ}', '2026-08-28'), 'Q-2026-')
  // SEQ 가 맨 앞이면 공통 앞자리가 없다
  assert.equal(seqPrefix('{SEQ}-X', '2026-08-28'), '')
})

test('쓴 번호에서 일련번호를 되읽는다 — 접미사가 붙어도 견딘다', () => {
  assert.equal(seqOf('DA-2026-0828-07', 'DA-2026-0828-'), 7)
  assert.equal(seqOf('DA-2026-0828-07-Rev2', 'DA-2026-0828-'), 7)
  assert.equal(seqOf('Q-2026-0014', 'Q-2026-'), 14)
  // 범위가 다른 번호는 0 — 어제 번호를 오늘 이어받으면 안 된다
  assert.equal(seqOf('DA-2026-0827-09', 'DA-2026-0828-'), 0)
  assert.equal(seqOf(null, 'DA-2026-0828-'), 0)
})

test('일련번호 없는 형식은 거절한다 — 모든 견적이 같은 번호가 된다', () => {
  assert.ok(validateQuoteNoPattern('DA-{YYYY}')?.includes('{SEQ}'))
  assert.equal(validateQuoteNoPattern('DA-{YYYY}-{SEQ}'), null)
})

test('빈 형식·모르는 토큰·너무 긴 형식을 거절한다', () => {
  assert.ok(validateQuoteNoPattern(''))
  assert.ok(validateQuoteNoPattern('{SEQ}-{WRONG}')?.includes('{WRONG}'))
  assert.ok(validateQuoteNoPattern('{SEQ}' + 'x'.repeat(60)))
})

test('프리셋은 전부 유효하다 — 고르자마자 저장이 막히면 안 된다', () => {
  for (const p of QUOTE_NO_PRESETS) {
    assert.equal(validateQuoteNoPattern(p.pattern), null, `${p.label} 이 유효하지 않다`)
    assert.equal(renderQuoteNo(p.pattern, '2026-08-28', 1), p.label, `${p.pattern} 의 예시가 라벨과 다르다`)
  }
})
