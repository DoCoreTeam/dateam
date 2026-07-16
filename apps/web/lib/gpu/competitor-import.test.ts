import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// P0-2 저장 게이트 배선 가드 (SSOT 정적 검증).
//   competitor-import.ts는 `@/` 경로 별칭 import를 써서 node:test로 직접 실행 불가(런타임 resolve X).
//   → 게이트 "동작"은 validate.test.ts(validateCompetitorItem)가 커버하고, 여기선 "배선"을 소스로 단언한다.
//   회귀(게이트 제거·rejected 미반환)가 생기면 즉시 실패해, 미리보기가 새더라도 저장 경계가 뚫리는 것을 막는다.
//   배경: 일본 사이트 URL 사고 — モデルプラン·サービス 라벨/¥→$ 둔갑값($30,000)이 무검증 저장될 뻔함.

const SRC = readFileSync(join(process.cwd(), 'lib/gpu/competitor-import.ts'), 'utf8')

test('P0-2 — saveCompetitorPrices가 validateCompetitorItem 게이트를 import·호출한다', () => {
  assert.match(SRC, /import\s*\{[^}]*validateCompetitorItem[^}]*\}\s*from\s*'@\/lib\/gpu\/validate'/, 'validate SSOT import')
  assert.match(SRC, /validateCompetitorItem\(item\)/, '루프 내 각 항목 게이트 호출')
})

test('P0-2 — 게이트 실패(!ok) 항목은 rejected로 격리하고 저장 skip(continue)', () => {
  // gate.ok 검사 → rejected.push → continue 순서가 있어야 한다.
  assert.match(SRC, /if\s*\(!gate\.ok\)\s*\{[\s\S]*?rejected\.push\([\s\S]*?continue/, 'block이면 rejected 격리 후 저장 스킵')
})

test('P0-2 — SaveCompetitorResult에 rejected 필드가 있고 반환된다', () => {
  assert.match(SRC, /rejected:\s*\{\s*model:\s*string;\s*issues:\s*Issue\[\]\s*\}\[\]/, 'result 타입에 rejected')
  assert.match(SRC, /return\s*\{\s*saved,\s*held,\s*rejected\s*\}/, 'rejected 반환')
})
