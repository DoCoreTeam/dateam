// lib/ci/review-idempotent.test.ts — 「이미 정리됨」을 실패로 말하지 않는다
//
// 왜 이 가드가 필요한가 (실측 2026-08-27):
//   묶음 확정이 성공했는데(200 · 4건 정리됨) 같은 묶음으로 요청이 한 번 더 나갔고,
//   서버가 404 «이 묶음은 이미 정리됐습니다»를 냈다. 화면은 그것을
//   **빨간 오류 + «다시 눌러 보세요»**로 띄웠다.
//   사용자는 시키는 대로 다시 누르고 → 또 같은 답 → 화면이 영원히 고장난 것처럼 보인다.
//   («이게 뭐냐고»)
//
//   할 일은 재시도가 아니다. 이미 그렇게 돼 있으므로 **목록을 다시 읽으면** 그 카드는 사라진다.
//   그래서 서버는 멱등하게 200 + resolved:0 으로 답하고, 화면은 그걸 오류로 취급하지 않는다.
//
// 정적 검사인 이유: 이 규칙은 타입으로도 단위테스트로도 안 잡힌다 —
// 라우트는 Supabase 를, 화면은 DOM 을 필요로 한다. 그런데 되돌리기는 한 줄이면 된다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const ROUTE = readFileSync(join(ROOT, 'app/api/ci/review/resolve/route.ts'), 'utf8')
const VIEW = readFileSync(join(ROOT, 'components/ci/ReviewGroups.tsx'), 'utf8')

test('서버: 묶음이 비었으면 실패가 아니라 멱등 성공으로 답한다', () => {
  const m = ROUTE.match(/if\s*\(inGroup\.length === 0\)\s*\{[\s\S]{0,300}?\n\s*\}/)
  assert.ok(m, 'inGroup.length === 0 분기가 사라졌다 — 이미 정리된 묶음의 처리가 없다')
  assert.match(m[0], /return ok\(/, '「이미 정리됨」은 실패가 아니다 — ok() 로 답해야 한다')
  assert.match(m[0], /resolved: 0/, '화면이 «바꾼 것이 없음»을 알 수 있어야 한다')
  assert.doesNotMatch(m[0], /fail\(/, 'fail() 로 되돌리면 화면이 다시 빨간 오류를 띄운다')
})

test('서버: 「이미 정리됐습니다」를 오류 메시지로 되돌리지 않는다', () => {
  assert.doesNotMatch(
    ROUTE, /fail\([^)]*이미 정리/,
    '이 문구가 fail() 로 나가면 화면은 그것을 «다시 눌러 보세요»로 띄운다',
  )
})

test('화면: resolved 0 을 오류보다 먼저 처리한다', () => {
  assert.match(VIEW, /d\.resolved === 0/, '«이미 정리돼 있었다» 처리가 사라졌다')
  const zeroAt = VIEW.indexOf('d.resolved === 0')
  const doneAt = VIEW.indexOf("건을 '")          // 「N건을 '주제'으로 정리했습니다」
  assert.ok(zeroAt > 0 && zeroAt < doneAt, '0건은 «0건을 정리했습니다»보다 먼저 걸러야 한다')
})

test('화면: 같은 묶음을 두 번 보내지 않는다', () => {
  // 버튼 disabled 는 상태라 다시 그려질 때까지 한 박자가 있다 — ref 로 즉시 막아야 한다
  assert.match(VIEW, /inFlight\.current\.has\(g\.key\)/, '중복 전송 차단이 사라졌다')
  assert.match(VIEW, /inFlight\.current\.add\(g\.key\)/, '보내기 전에 표시해야 한다')
  assert.match(VIEW, /inFlight\.current\.delete\(g\.key\)/, 'finally 에서 풀지 않으면 영영 막힌다')
})
