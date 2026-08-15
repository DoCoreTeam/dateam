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
import { walkFiles, read, findJsxTags } from './component-scan.ts'

/**
 * 아직 이관하지 못한 곳 — **늘리지 말 것.**
 * 여기 있는 동안 그 화면은 스크린리더에서 대화상자로 안 읽힌다.
 *
 * v0.7.468에서 비었다. GPU 탭 3종(모달 8개)을 .gpu-modal-backdrop/.gpu-modal-card로
 * 이관하면서 role=dialog·aria-modal·이름을 함께 달았다.
 * 다시 채우게 되면, 그건 "나중에 하겠다"는 뜻이고 대개 안 한다 — 그 자리에서 고치는 편이 싸다.
 */
const PENDING = new Set<string>([])

/** 화면을 덮지만 대화상자가 아닌 것 — 로딩·전환 표시. role=status 계열로 밝히면 통과 */
const NON_DIALOG_ROLE = /role=["'](?:status|progressbar|alert|presentation|none)["']/

// ⚠️ 판정은 **덮는 태그 하나**를 보고 한다. 파일 전체에서 문자열을 찾으면 안 된다.
//   예전 판이 그랬고, 그래서 모달 **안에** 있는 `role="status"` 안내문 하나 때문에
//   정작 모달 자신은 검사를 통과했다. v0.7.468에서 5곳이 그렇게 새고 있었다
//   (EventModal · ProjectFormModal · ai-chat 모달 3종 — 전부 스크린리더에 대화상자가 아니었다).

/** 이 태그 하나가 화면을 덮는가 */
function tagCoversScreen(attrs: string): boolean {
  return /position:\s*['"]fixed['"]/.test(attrs) && /inset:\s*0/.test(attrs)
}

/** 파일이 공용 부품을 쓰면 규약이 딸려온다 — 이건 파일 단위가 맞다 */
function usesSharedDialog(src: string): boolean {
  return /\bNbModal\b/.test(src) || /\bSlidePanel\b/.test(src)
}

/** 덮는 태그들 중 대화상자로도, 비-대화상자로도 선언되지 않은 것 */
function undeclaredOverlays(src: string): number {
  if (usesSharedDialog(src)) return 0
  let bad = 0
  for (const tag of findJsxTags(src, ['div', 'aside', 'section', 'dialog'])) {
    if (!tagCoversScreen(tag.attrs)) continue
    if (/role=["']dialog["']/.test(tag.attrs)) continue
    if (NON_DIALOG_ROLE.test(tag.attrs)) continue
    bad++
  }
  return bad
}

function coversScreen(src: string): boolean {
  return findJsxTags(src, ['div', 'aside', 'section', 'dialog']).some((t) => tagCoversScreen(t.attrs))
}

function declaresDialog(src: string): boolean {
  return undeclaredOverlays(src) === 0
}

test('화면을 덮는 오버레이는 대화상자로 선언한다 (role=dialog 또는 NbModal/SlidePanel)', () => {
  const offenders: string[] = []
  for (const file of [...walkFiles('components', ['.tsx']), ...walkFiles('app', ['.tsx'])]) {
    const src = read(file)
    if (PENDING.has(file)) continue
    const bad = undeclaredOverlays(src)
    if (bad === 0) continue
    offenders.push(`${file} (${bad}곳)`)
  }
  assert.deepEqual(offenders, [],
    `화면을 덮는데 role이 없다(스크린리더에 존재하지 않는다):\n  ${offenders.join('\n  ')}`)
})

test('PENDING 항목은 실제로 아직 위반 상태여야 한다 (죽은 예외 방지)', () => {
  const stale = [...PENDING].filter((f) => {
    const src = read(f)
    return !coversScreen(src) || undeclaredOverlays(src) === 0
  })
  assert.deepEqual(stale, [], `이미 해소된 항목이 예외 목록에 남아 있다. 지울 것: ${stale.join(', ')}`)
})
