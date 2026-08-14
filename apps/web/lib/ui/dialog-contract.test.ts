// lib/ui/dialog-contract.test.ts — "화면을 덮는데 대화상자가 아닌 것"을 잡는다
//
// 왜: 캘린더 날짜 패널이 화면을 덮는 오버레이인데 `role`·`aria-modal`·이름이 전부 없었다.
//   눈으로는 멀쩡했다 — 스크린리더에서만 존재하지 않았고, 어떤 검사도 잡지 못했다.
//   전수로 훑으니 같은 상태의 오버레이가 15곳이었다(v0.7.459).
//
// 계약: `position: fixed` + `inset: 0`으로 화면을 덮으면 셋 중 하나여야 한다.
//   ① `NbModal`(가운데 카드) 또는 `SlidePanel`(우측 드로어)을 쓴다 — 권장. 규약이 딸려온다.
//   ② 직접 그린다면 `role="dialog"`와 `aria-modal="true"`를 **직접** 단다.
//   ③ 대화상자가 아닌 오버레이(로딩·전환 표시)는 `role="status"`/`role="progressbar"`로 밝힌다.
//
// 조용히 아무 role도 없는 상태만 막는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

/**
 * 아직 이관하지 못한 곳 — **늘리지 말 것.**
 * 여기 있는 동안 그 화면은 스크린리더에서 대화상자로 안 읽힌다.
 * GPU 탭은 계획상 Phase 4 단독 배치라 마지막에 함께 정리한다.
 */
const PENDING = new Set([
  'app/(member)/pricing/gpu/tabs/MarketTab.tsx',
  'app/(member)/pricing/gpu/tabs/SuppliersTab.tsx',
  'app/(member)/pricing/gpu/tabs/PriceTableTab.tsx',
])

/** 화면을 덮지만 대화상자가 아닌 것 — 로딩·전환 표시. role=status 계열로 밝히면 통과 */
const NON_DIALOG_ROLE = /role=["'](?:status|progressbar|alert|presentation|none)["']/

function coversScreen(src: string): boolean {
  // `position: 'fixed'` … `inset: 0` 이 같은 스타일 객체 안에 있는지(줄바꿈 허용)
  return /position:\s*['"]fixed['"][^}]{0,200}inset:\s*0/s.test(src)
    || /inset:\s*0[^}]{0,200}position:\s*['"]fixed['"]/s.test(src)
}

function declaresDialog(src: string): boolean {
  return /role=["']dialog["']/.test(src)
    || /\bNbModal\b/.test(src)
    || /\bSlidePanel\b/.test(src)
}

test('화면을 덮는 오버레이는 대화상자로 선언한다 (role=dialog 또는 NbModal/SlidePanel)', () => {
  const offenders: string[] = []
  for (const file of [...walkFiles('components', ['.tsx']), ...walkFiles('app', ['.tsx'])]) {
    const src = read(file)
    if (!coversScreen(src)) continue
    if (declaresDialog(src)) continue
    if (NON_DIALOG_ROLE.test(src)) continue
    if (PENDING.has(file)) continue
    offenders.push(file)
  }
  assert.deepEqual(offenders, [],
    `화면을 덮는데 role이 없다(스크린리더에 존재하지 않는다):\n  ${offenders.join('\n  ')}`)
})

test('PENDING 항목은 실제로 아직 위반 상태여야 한다 (죽은 예외 방지)', () => {
  const stale = [...PENDING].filter((f) => {
    const src = read(f)
    return !coversScreen(src) || declaresDialog(src) || NON_DIALOG_ROLE.test(src)
  })
  assert.deepEqual(stale, [], `이미 해소된 항목이 예외 목록에 남아 있다. 지울 것: ${stale.join(', ')}`)
})
