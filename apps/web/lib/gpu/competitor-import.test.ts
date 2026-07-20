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

// P1 관측원본 배선 — obs 필드가 market_prices insert로 통과(persist)되는지 정적 가드.
test('P1 — buildObsColumns가 존재하고 market_prices insert에 배선된다', () => {
  assert.match(SRC, /export function buildObsColumns/, '관측원본 매핑 함수 존재')
  assert.match(SRC, /\.\.\.buildObsColumns\(item\.obs\)/, 'insert에 obs 통과')
  // 관측 원본 핵심 컬럼 매핑 확인(환산 전 진실값 + 환율 스냅샷)
  assert.match(SRC, /obs_amount/, 'obs_amount 매핑')
  assert.match(SRC, /obs_segment/, 'obs_segment(세그먼트 격리)')
  assert.match(SRC, /o\.fx_rate = obs\.fx_rate/, '환율 스냅샷 매핑')
})

// T1.4 요금성분 1:N 배선(v0.7.351) — 복합요금 무손실 저장 경로가 실제로 결선돼 있는지 정적 가드.
//   결선이 빠지면 성분이 조용히 폐기되고 관측 헤더만 남는다(= 재설계 이전 손실 상태로 회귀).
test('T1.4 — components가 market_price_components에 저장 배선된다', () => {
  assert.match(SRC, /import\s*\{[^}]*toComponentRow[^}]*\}\s*from\s*'@\/lib\/gpu\/price-components'/, '성분 SSOT import')
  assert.match(SRC, /\.from\('market_price_components'\)\.insert\(rows\)/, '성분 테이블 insert 결선')
  assert.match(SRC, /observation_id:\s*obsRow\.id/, '관측 헤더 FK 결합')
})

test('T1.4 — 성분 저장 실패가 관측 저장을 되돌리지 않는다(never-block)', () => {
  // 유실0 > 정합. 성분 insert 실패는 로그로 노출하되 continue/throw로 관측을 버리지 않아야 한다.
  const compBlock = SRC.match(/if\s*\(obsRow\?\.id && item\.components\?\.length\)\s*\{[\s\S]*?\n    \}/)
  assert.ok(compBlock, '성분 저장 블록 존재')
  assert.doesNotMatch(compBlock![0], /\bthrow\b|\bcontinue\b/, '성분 실패가 관측 저장을 취소하면 안 됨')
  assert.match(compBlock![0], /console\.error/, '실패는 조용히 넘기지 말고 노출')
})
