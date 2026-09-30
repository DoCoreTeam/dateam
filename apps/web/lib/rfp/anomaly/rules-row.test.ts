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
import { readFileSync } from 'node:fs'

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

// 조직 둘 이상 — 마이그레이션 300

test('규칙 줄은 조직 없이 만들어지지 않는다', () => {
  // 읽기 정책에 `org_id is null` 갈래가 있던 시절, 조직을 비운 줄은
  // **조직을 안 가리고 읽혔다.** 300 이 기본키를 (org_id, id) 로 바꿔 그 줄을
  // 표가 아예 못 받게 했지만, 코드가 빈 값을 보내면 이제 저장이 통째로 실패한다.
  // 어느 쪽이든 빈 org_id 를 만들 이유가 없다
  for (const rule of DEFAULT_RULES) {
    const org = toRow(rule, ORG).org_id
    assert.ok(org, `${rule.id} 의 org_id 가 비었다`)
    assert.match(String(org), /^[0-9a-f-]{36}$/i, `${rule.id} 의 org_id 가 uuid 가 아니다`)
  }
})

test('같은 규칙 id 를 조직 둘이 가질 수 있다', () => {
  // 기본키가 id 하나이던 시절, R01 을 가질 수 있는 조직은 저장소 전체에 하나뿐이었다.
  // 쓰기 정책은 org_id 를 요구하므로 둘째 조직은 규칙을 영영 저장할 수 없었다.
  // 표의 기본키는 마이그레이션 300 이 (org_id, id) 로 바꿨다(실측: 조직 둘에 R01 두 행)
  const OTHER = '00000000-0000-4000-8000-0000000000ff'
  const a = toRow(DEFAULT_RULES[0], ORG)
  const b = toRow(DEFAULT_RULES[0], OTHER)
  assert.equal(a.id, b.id, '같은 규칙이면 id 가 같아야 한다')
  assert.notEqual(a.org_id, b.org_id)
  // 두 줄을 가르는 것은 id 가 아니라 (org_id, id) 다
  assert.notDeepEqual([a.org_id, a.id], [b.org_id, b.id])
})

test('300 이 기본키와 외래키를 함께 옮긴다', () => {
  // 가리키는 쪽 키가 두 칸이 되면 가리키는 외래키도 두 칸이어야 한다.
  // 기본키만 바꾸고 외래키를 두고 가면 마이그레이션이 그 자리에서 죽는다
  // 주석을 먼저 지운다. 이 파일의 설명글에 「사본(CREATE TABLE AS)을 뜨지 않는다」가 있어
  // 지우지 않으면 가드가 자기 주석을 보고 빨개진다 — 실제로 그렇게 한 번 빨개졌다
  const sql = readFileSync(
    new URL('../../../../../supabase/migrations/300_rfp_anomaly_rule_org_key.sql', import.meta.url),
    'utf8',
  ).replace(/^\s*--.*$/gm, '')
  assert.match(sql, /primary key \(org_id, id\)/i, '기본키를 두 칸으로 안 바꾼다')
  assert.match(sql, /foreign key \(org_id, rule_id\)/i, '외래키를 두 칸으로 안 바꾼다')
  // 그냥 set null 이면 org_id 까지 비우려 들고, 그 칸은 NOT NULL 이라 규칙 삭제가 통째로 실패한다
  assert.match(sql, /on delete set null \(rule_id\)/i, '비울 칸을 안 집어 준다')
  assert.match(sql, /alter column org_id set not null/i, 'org_id 를 NOT NULL 로 안 올린다')
  // 사본을 뜨면 원본의 RLS 를 안 물려받는다
  assert.doesNotMatch(sql, /create table/i, '표를 새로 만들거나 사본을 뜬다')
})
