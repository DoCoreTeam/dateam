// lib/ui/duplicate-component.test.ts — "같은 것을 두 번 만들었다" 차단 (02-SYSTEM §8-3)
//
// 왜: 이 시스템의 실제 문제는 "부품을 안 쓴다"가 아니라 "두 벌 만들었다"였다.
//   EmptyState가 ui/EmptyState.tsx와 ci/states.tsx에 **같은 이름으로** 18건씩 존재했고,
//   화면을 만드는 사람은 매번 다른 쪽을 골랐다. 이름이 같으니 grep으로도 안 보였다.
// 이 가드는 components/** 안에서 같은 이름을 2곳이 export하면 즉시 실패한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, exportedSymbols, isComponentName } from './component-scan.ts'

/**
 * 아직 남은 중복 — Phase 1.5가 이 목록을 **비운다**.
 * 새 중복을 여기 추가하는 것은 정책 위반이다(통일 대상을 먼저 정한다).
 */
const KNOWN_REMAINING: readonly string[] = [
  'EmptyState', // ui/EmptyState.tsx(18) vs ci/states.tsx(18) — ui/ 로 통일 예정
  'SortIcon',   // pricing/gpu/SortIcon.tsx(26) vs pricing/gpu/cockpit/SortIcon.tsx(26)
]

test('components/** 에서 같은 이름을 2곳이 export하지 않는다', () => {
  const byName = new Map<string, string[]>()
  for (const file of walkFiles('components', ['.tsx'])) {
    for (const name of exportedSymbols(read(file))) {
      if (!isComponentName(name)) continue
      byName.set(name, [...(byName.get(name) ?? []), file])
    }
  }

  const dupes = [...byName.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => `${name} → ${files.join(' | ')}`)
    .filter((line) => !KNOWN_REMAINING.some((n) => line.startsWith(`${n} →`)))

  assert.deepEqual(dupes, [],
    `같은 부품을 두 벌 만들었다. 하나로 통일하고 docs/ui-system/INVENTORY.md에 등재할 것:\n  ${dupes.join('\n  ')}`)
})

test('KNOWN_REMAINING에 적힌 중복은 실제로 아직 존재해야 한다 (죽은 예외 방지)', () => {
  // 예외 목록이 현실과 어긋나면 가드가 조용히 무력해진다. 해소된 항목은 목록에서 지운다.
  const byName = new Map<string, number>()
  for (const file of walkFiles('components', ['.tsx'])) {
    for (const name of exportedSymbols(read(file))) {
      if (isComponentName(name)) byName.set(name, (byName.get(name) ?? 0) + 1)
    }
  }
  const stale = KNOWN_REMAINING.filter((n) => (byName.get(n) ?? 0) < 2)
  assert.deepEqual(stale, [], `이미 해소된 예외가 남아 있다. 목록에서 제거할 것: ${stale.join(', ')}`)
})
