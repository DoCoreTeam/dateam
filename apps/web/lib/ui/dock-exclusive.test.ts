// lib/ui/dock-exclusive.test.ts — 우측하단 고정 레이어 독점 (02-SYSTEM §4)
//
// 왜: QuickAddFab(bottom:1.5rem/right:1.5rem, z:90)과 CI AssistantPanel FAB
//   (bottom:var(--space-4)/right:var(--space-4), z:var(--z-sticky)=90)이 좌표·z가 모두 같아
//   실제로 겹쳐 잘렸다. ScrollJumpButtons는 그걸 피하려고 `bottom: 92`라는 매직넘버를 썼다.
//   "각자 좌표를 정하는" 구조가 원인이다 → 좌표는 Dock만 안다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

/** 우측하단 좌표를 직접 정해도 되는 곳 = Dock 구현체뿐. */
const DOCK_OWNERS = new Set([
  'components/ui/shell/Dock.tsx',
])

/**
 * 아직 Dock으로 안 옮긴 것 — Phase 1이 이 목록을 **비운다**.
 * QueryToast는 토스트 레이어(z-toast=300)로 Dock과 층이 다르다 → 영구 예외.
 */
const DOCK_MIGRATION_PENDING = new Set([
  'components/ui/QueryToast.tsx', // 토스트 층 — Dock 대상 아님
  'app/admin/content/ContentSections.tsx', // 콘텐츠 관리 저장바 — Phase 2 목록 툴바로 흡수
])

/** `position:'fixed'` 주변에서 bottom+right만 지정 = 우측하단 점유 */
function occupiesBottomRight(src: string): boolean {
  for (const m of src.matchAll(/position: *['"]fixed['"]/g)) {
    const seg = src.slice(Math.max(0, m.index - 250), m.index + 250)
    if (/bottom: /.test(seg) && /right: /.test(seg) && !/left: /.test(seg) && !/top: /.test(seg)) return true
  }
  return false
}

test('우측하단 고정 레이어는 Dock만 좌표를 정한다', () => {
  const offenders = walkFiles('app', ['.tsx'])
    .concat(walkFiles('components', ['.tsx']))
    .filter((f) => !DOCK_OWNERS.has(f) && !DOCK_MIGRATION_PENDING.has(f))
    .filter((f) => occupiesBottomRight(read(f)))

  assert.deepEqual(offenders, [],
    `우측하단을 직접 점유하면 FAB끼리 겹친다. Dock 슬롯(primary/assistant/utility)으로 등록할 것:\n  ${offenders.join('\n  ')}`)
})

test('bottom 매직넘버(다른 FAB 피하기)를 새로 만들지 않는다', () => {
  // `bottom: 92`처럼 "남의 FAB 높이만큼 띄우기"는 Dock이 세로 스택을 관리하면 필요 없다.
  const offenders = walkFiles('app', ['.tsx'])
    .concat(walkFiles('components', ['.tsx']))
    .filter((f) => !DOCK_OWNERS.has(f) && !DOCK_MIGRATION_PENDING.has(f))
    .filter((f) => /bottom: *[0-9]{2,}\b/.test(read(f)))

  assert.deepEqual(offenders, [],
    `우측하단 여백을 손으로 계산하지 않는다. Dock의 --dock-safe-area를 쓸 것: ${offenders.join(', ')}`)
})

test('DOCK_MIGRATION_PENDING 항목은 실제로 아직 위반 상태여야 한다 (죽은 예외 방지)', () => {
  const stale = [...DOCK_MIGRATION_PENDING].filter((f) => {
    const src = read(f)
    return !occupiesBottomRight(src) && !/bottom: *[0-9]{2,}\b/.test(src)
  })
  assert.deepEqual(stale, [], `해소된 예외가 남아 있다. 목록에서 제거할 것: ${stale.join(', ')}`)
})
