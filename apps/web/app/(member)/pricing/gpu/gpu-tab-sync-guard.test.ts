import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// GPU 관리 화면 "다다다닥" 진동 회귀 가드 (정적).
//   사고: 탭→URL 반영을 useEffect(deps [activeTab])에서 처리하며 URL에 state(activeTab)를 되썼다.
//   mount 시 activeTab이 아직 배치 대기(stale='board')인데 URL은 실제 탭 → effect가 URL을 'board'로
//   되덮고, URL→탭 effect가 되받아쳐 board↔현재탭 무한 진동(탭 서브트리 mount/unmount 반복).
//   재현: 마지막 탭이 board가 아닌 상태(예: 통합입력)로 GPU 관리 재진입.
//   수정: URL 쓰기를 effect에서 제거하고 goToTab(핸들러)이 fresh 파라미터로만 replaceState → 단방향·수렴.
// 이 가드는 그 사고 시그니처가 재유입되면 즉시 실패한다.

const SRC = readFileSync(
  join(process.cwd(), 'app/(member)/pricing/gpu/GpuPricingClient.tsx'),
  'utf8',
)

test('탭 전환 SSOT goToTab(useCallback)이 존재한다', () => {
  assert.match(SRC, /const goToTab = useCallback\(/, 'goToTab 핸들러가 있어야 함')
})

test('URL에 state activeTab을 되쓰는 사고 패턴이 없다 (p.set(\'tab\', activeTab) 금지)', () => {
  // 이 사고의 정확한 자국: effect가 URL에 state(activeTab)를 되씀. goToTab은 fresh 파라미터 t를 쓴다
  //   (p.set('tab', t)). activeTab을 URL에 쓰는 코드가 재유입되면 mount stale 진동이 재발한다.
  assert.doesNotMatch(SRC, /p\.set\(\s*['"]tab['"]\s*,\s*activeTab\s*\)/, 'effect가 activeTab을 URL에 되쓰면 진동 재발 — 금지')
})
