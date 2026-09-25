/**
 * 「만료 30분 전까지는 아무도 재발급을 안 부른다」가 정말 그런가
 *
 * 이 규칙은 **안 일어나는 일**이라 눈으로 확인할 수 없다. KIS 가 재발급을 1분 1회로 막고,
 * 분마다 도는 크론이 저마다 부르면 거부가 쌓이는 동안 조회가 통째로 막힌다 —
 * 매매 시스템에서 그 1분은 봉 하나가 통째로 비는 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideTokenAction,
  COOLDOWN_HOLDER,
  COOLDOWN_MS,
  REISSUE_LOCK_MS,
  type TokenRow,
} from './token-policy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOW = new Date('2026-09-26T01:00:00.000Z')
const MARGIN = 30

const row = (over: Partial<TokenRow> = {}): TokenRow => ({
  tokenEnc: { v: 1, iv: 'x', ct: 'y', tag: 'z' },
  expiresAt: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
  lockHolder: null,
  lockedUntil: null,
  ...over,
})

test('★ 만료까지 여유가 있으면 재발급을 생각조차 안 한다', () => {
  for (const minutesLeft of [31, 60, 6 * 60, 24 * 60]) {
    const action = decideTokenAction({
      row: row({ expiresAt: new Date(NOW.getTime() + minutesLeft * 60_000) }),
      now: NOW,
      refreshMarginMinutes: MARGIN,
    })
    assert.equal(action.kind, 'use', `${minutesLeft}분 남았는데 ${action.kind} 를 했다`)
  }
})

test('★ 여유가 있으면 남이 잠금을 잡고 있어도 그냥 쓴다 — 기다릴 이유가 없다', () => {
  const action = decideTokenAction({
    row: row({
      expiresAt: new Date(NOW.getTime() + 60 * 60_000),
      lockHolder: 'run-1',
      lockedUntil: new Date(NOW.getTime() + 20_000),
    }),
    now: NOW,
    refreshMarginMinutes: MARGIN,
  })
  assert.equal(action.kind, 'use')
})

test('만료가 임박하고 잠금이 없으면 재발급한다', () => {
  const action = decideTokenAction({
    row: row({ expiresAt: new Date(NOW.getTime() + 29 * 60_000) }),
    now: NOW,
    refreshMarginMinutes: MARGIN,
  })
  assert.equal(action.kind, 'reissue')
})

test('★ 남이 재발급 중이면 나는 안 부른다 — 둘이 부르면 하나는 반드시 거부당한다', () => {
  const action = decideTokenAction({
    row: row({
      expiresAt: new Date(NOW.getTime() + 10 * 60_000),
      lockHolder: 'run-1',
      lockedUntil: new Date(NOW.getTime() + REISSUE_LOCK_MS),
    }),
    now: NOW,
    refreshMarginMinutes: MARGIN,
  })
  assert.equal(action.kind, 'wait')
  assert.equal(action.kind === 'wait' && action.reason, 'locked_by_other')
})

test('★ 직전 재발급이 거부됐으면(EGW00133) 다른 실행이 이어서 안 부른다', () => {
  const action = decideTokenAction({
    row: row({
      expiresAt: new Date(NOW.getTime() + 5 * 60_000),
      lockHolder: COOLDOWN_HOLDER,
      lockedUntil: new Date(NOW.getTime() + COOLDOWN_MS),
    }),
    now: NOW,
    refreshMarginMinutes: MARGIN,
  })
  assert.equal(action.kind, 'wait')
  assert.equal(action.kind === 'wait' && action.reason, 'cooldown', '거부를 「남이 하는 중」과 같게 읽었다')
})

test('잠금이 만료됐으면 이어받는다 — 실행이 죽어도 영원히 막히지 않는다', () => {
  const action = decideTokenAction({
    row: row({
      expiresAt: new Date(NOW.getTime() + 5 * 60_000),
      lockHolder: 'run-죽음',
      lockedUntil: new Date(NOW.getTime() - 1_000),
    }),
    now: NOW,
    refreshMarginMinutes: MARGIN,
  })
  assert.equal(action.kind, 'reissue')
})

test('토큰이 이미 만료됐으면 값이 있어도 재발급한다', () => {
  const action = decideTokenAction({
    row: row({ expiresAt: new Date(NOW.getTime() - 60_000) }),
    now: NOW,
    refreshMarginMinutes: MARGIN,
  })
  assert.equal(action.kind, 'reissue')
})

test('행이 없으면 첫 발급이다', () => {
  assert.equal(decideTokenAction({ row: null, now: NOW, refreshMarginMinutes: MARGIN }).kind, 'issue_first')
})

test('거부 대기가 KIS 제한(1분)보다 길다', () => {
  assert.ok(COOLDOWN_MS > 60_000, `대기 ${COOLDOWN_MS}ms 는 1분 제한 안에 다시 부른다`)
})

test('★ 토큰을 메모리에 들고 있지 않다 — DB 한 행이 유일한 자리다', () => {
  for (const file of ['token.ts', 'token-policy.ts']) {
    const src = readFileSync(join(HERE, file), 'utf8')
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    // 모듈 수준 `let` 은 실행 사이에 값을 나른다. 서버리스에서는 인스턴스마다 다른 값이 되고,
    // 그러면 「한 행만 쓴다」가 인스턴스 수만큼 깨진다
    const moduleLet = body.match(/^let\s+\w+/gm) ?? []
    assert.deepEqual(moduleLet, [], `${file} 에 모듈 수준 가변 변수가 있다: ${moduleLet.join(', ')}`)
    assert.doesNotMatch(body, /^(const|let)\s+\w*[Cc]ache\w*\s*=\s*new\s+Map/m, `${file} 에 메모리 캐시가 있다`)
  }
})
