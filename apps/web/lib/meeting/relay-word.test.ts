// lib/meeting/relay-word.test.ts — 뽑은 할 일이 딜까지 갔는지 말하는 문장 가드
//
// 이 문장의 값어치는 **「안 갔다」를 말하는 데** 있다. 실측 2026-09-17: 회의에서 뽑은
// 할 일 40건이 전부 개인 일일업무로만 갔고 딜에는 0건이었는데, 화면은 아무 말도 안 했다.
// 사용자는 딜 화면에서 「왜 안 보이지」로 겪었다.
//
// 그래서 갈래 넷을 전부 잠근다 — 하나라도 같은 문장으로 뭉개지면 다음 손을 못 찾는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relayLine } from './relay-word.ts'

test('딜에 세웠으면 몇 건인지 말한다', () => {
  assert.match(relayLine({ created: 3, skipped: null }), /3건/)
  assert.match(relayLine({ created: 3, skipped: null }), /딜/)
})

test('안 간 이유마다 다음 손이 다르다 — 문장이 서로 달라야 한다', () => {
  const lines = (['no-access', 'not-published', 'no-anchor'] as const)
    .map((s) => relayLine({ created: 0, skipped: s }))
  assert.equal(new Set(lines).size, 3, '세 이유가 같은 문장으로 뭉개졌다')
  // 고칠 수 있는 둘은 **어디를 눌러야 하는지**를 말한다
  assert.match(lines[1], /공개 범위/)
  assert.match(lines[2], /딜을 붙여/)
})

test('갈 곳은 있는데 0건이면 「이미 서 있다」 — 실패로 읽히면 안 된다', () => {
  const line = relayLine({ created: 0, skipped: null })
  assert.match(line, /이미/)
  assert.doesNotMatch(line, /실패|못/)
})

test('CRM 을 안 쓰는 사람에게도 개인 업무는 들어갔다고 말한다', () => {
  for (const s of ['no-access', 'not-published', 'no-anchor'] as const) {
    assert.match(relayLine({ created: 0, skipped: s }), /일일업무/)
  }
  assert.match(relayLine(null), /일일업무/)
})
