import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guideFor, GUIDE_ENTRIES, GUIDE_FLOW } from './guide.ts'

test('주소가 정확히 맞으면 그 화면 안내가 나온다', () => {
  assert.equal(guideFor('/rfp/new').match, '/rfp/new')
  assert.equal(guideFor('/rfp/admin').match, '/rfp/admin')
  assert.equal(guideFor('/rfp/profile').match, '/rfp/profile')
})

test('가장 길게 맞는 것이 이긴다 — /rfp 가 /rfp/new 를 가로채지 않는다', () => {
  // 목록에서 '/rfp' 가 먼저 걸리면 모든 화면이 같은 안내를 받는다
  assert.notEqual(guideFor('/rfp/new').title, guideFor('/rfp').title)
})

test('짝이 없는 주소(케이스 상세)는 서비스 안내로 떨어진다', () => {
  assert.equal(guideFor('/rfp/2f0c1d4a-0000-0000-0000-000000000000').match, '/rfp')
})

test('하위 경로도 부모 안내를 받는다', () => {
  assert.equal(guideFor('/rfp/radar/rules').match, '/rfp/radar')
})

test('모든 안내에 제목과 단계가 있다', () => {
  for (const e of GUIDE_ENTRIES) {
    assert.ok(e.title.length > 0, `${e.match} 제목 없음`)
    assert.ok(e.lead.length > 0, `${e.match} 설명 없음`)
    assert.ok(e.steps.length > 0, `${e.match} 단계 없음`)
    for (const s of e.steps) assert.ok(s.body.length > 0, `${e.match}/${s.title} 본문 없음`)
  }
  assert.ok(GUIDE_FLOW.length >= 4)
})
