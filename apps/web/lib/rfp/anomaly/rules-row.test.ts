// 규칙 ↔ 표 왕복 가드
//
// 코드가 쓰는 이름(rule_id·title·method·grade·params)과 표가 가진 이름
// (id·name·rule_type·definition·severity_default)이 달랐다. 둘 다 오류를 안 내고
// **읽기는 빈 목록, 쓰기는 500** 이 됐다 — 화면은 언제나 기본값을 보여 줘서
// 「저장이 안 된다」가 아니라 「원래 그런 화면」으로 보였다(실측 2026-09-20).
//
// 그래서 여기서 왕복을 센다. 넣은 것이 그대로 돌아오지 않으면 그 규칙은 잃은 것이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, RULE_COLS, toRow, toRule } from './rules.ts'

const ORG = '00000000-0000-4000-8000-000000000001'

test('규칙을 표에 넣었다 꺼내면 그대로다', () => {
  for (const rule of DEFAULT_RULES) {
    const back = toRule(toRow(rule, ORG))
    assert.deepEqual(back, rule, `${rule.id} 가 왕복에서 달라졌다`)
  }
})

test('끈 규칙은 꺼진 채로 돌아온다 — 스위치가 저장하는 값이 이것뿐이다', () => {
  const off = { ...DEFAULT_RULES[0], enabled: false }
  assert.equal(toRule(toRow(off, ORG)).enabled, false)
})

test('표가 비워 두지 못하는 칸이 전부 채워진다', () => {
  for (const rule of DEFAULT_RULES) {
    const row = toRow(rule, ORG)
    for (const col of ['id', 'org_id', 'category', 'name', 'rule_type', 'severity_default']) {
      assert.ok(row[col], `${rule.id} 의 ${col} 이 비었다 — not null 이라 넣기가 실패한다`)
    }
  }
})

test('판정 방법을 표가 받는 네 가지 안으로 좁힌다', () => {
  const allowed = new Set(['regex', 'numeric', 'stat', 'llm'])
  for (const rule of DEFAULT_RULES) {
    const t = toRow(rule, ORG).rule_type
    assert.ok(allowed.has(String(t)), `${rule.id} 의 rule_type ${String(t)} 은 표의 check 가 막는다`)
  }
})

test('org_id 는 부르는 쪽이 넘긴 것만 들어간다 — 규칙 안에 조직이 없다', () => {
  // 요청 본문에서 org_id 를 받으면 남의 조직 규칙을 바꿀 수 있다.
  // 그래서 규칙 모델에는 조직이 아예 없고, 서버가 rfp_default_org() 로 정해 넣는다.
  assert.equal(toRow(DEFAULT_RULES[0], ORG).org_id, ORG)
  assert.ok(!('org_id' in DEFAULT_RULES[0]), '규칙 모델에 조직이 들어왔다')
})

test('읽는 칸 목록이 표에 실재하는 이름만 쓴다', () => {
  // 없는 칸을 하나라도 적으면 select 가 통째로 오류가 되고 목록이 조용히 빈다
  const REAL = new Set(['id', 'org_id', 'category', 'name', 'description',
    'rule_type', 'definition', 'severity_default', 'enabled', 'updated_at'])
  const asked = RULE_COLS.split(',').map((c) => c.trim())
  const unknown = asked.filter((c) => !REAL.has(c))
  assert.deepEqual(unknown, [], `표에 없는 칸을 읽으려 한다: ${unknown.join(', ')}`)
})
